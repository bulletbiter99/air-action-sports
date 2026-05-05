// Versioned immutable waiver documents. Same pattern as vendor_contract_documents:
// create a new row, retire the previous. Never edit body_html in place — it
// would invalidate every past waivers row whose body_sha256 was computed
// against the old text (and the public /api/waivers/:qrToken route refuses
// to serve when the integrity check fails — see worker/routes/waivers.js).

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { clientIp } from '../../lib/rateLimit.js';

const adminWaiverDocuments = new Hono();
adminWaiverDocuments.use('*', requireAuth);

function wdId() { return `wd_${randomId(12)}`; }

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function format(r) {
    if (!r) return null;
    return {
        id: r.id,
        version: r.version,
        bodyHtml: r.body_html,
        bodySha256: r.body_sha256,
        effectiveFrom: r.effective_from,
        retiredAt: r.retired_at,
        createdBy: r.created_by,
        createdAt: r.created_at,
    };
}

async function writeAudit(env, userId, action, targetId, meta, ip) {
    await env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (?, ?, 'waiver_document', ?, ?, ?, ?)`
    ).bind(userId, action, targetId, meta ? JSON.stringify(meta) : null, ip, Date.now()).run();
}

// GET /api/admin/waiver-documents — every version, newest first
adminWaiverDocuments.get('/', async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT * FROM waiver_documents ORDER BY version DESC`
    ).all();
    return c.json({ waivers: (rows.results || []).map(format) });
});

// POST /api/admin/waiver-documents  { bodyHtml }
// Creates a new version, retires the previously-live one at the same instant.
// Past signers stay pinned to their original signed version (snapshot on the
// waivers row preserves body + hash + version at sign time).
adminWaiverDocuments.post('/', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const bodyHtml = String(body.bodyHtml || '').trim();
    if (!bodyHtml) return c.json({ error: 'bodyHtml required' }, 400);
    if (bodyHtml.length > 200000) return c.json({ error: 'bodyHtml too long (max 200,000 chars)' }, 400);

    const latest = await c.env.DB.prepare(
        `SELECT MAX(version) AS v FROM waiver_documents`
    ).first();
    const newVersion = (latest?.v ?? 0) + 1;

    const id = wdId();
    const now = Date.now();
    const hash = await sha256Hex(bodyHtml);

    // Retire the currently-live doc (if any) at the same timestamp this one
    // takes effect, so there's never a moment with zero or two live docs.
    await c.env.DB.prepare(
        `UPDATE waiver_documents SET retired_at = ? WHERE retired_at IS NULL`
    ).bind(now).run();

    await c.env.DB.prepare(
        `INSERT INTO waiver_documents (id, version, body_html, body_sha256, effective_from, retired_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
    ).bind(id, newVersion, bodyHtml, hash, now, user.id, now).run();

    await writeAudit(c.env, user.id, 'waiver_document.created', id, { version: newVersion, body_sha256: hash }, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM waiver_documents WHERE id = ?').bind(id).first();
    return c.json({ waiver: format(row) }, 201);
});

// GET /api/admin/waiver-documents/current — the active live document, or null
adminWaiverDocuments.get('/current', async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT * FROM waiver_documents WHERE retired_at IS NULL ORDER BY version DESC LIMIT 1`
    ).first();
    return c.json({ waiver: format(row) });
});

// POST /api/admin/waiver-documents/:id/retire — owner-only emergency retire
// without a replacement. Use sparingly — leaves the public waiver page with
// no live doc to serve and incoming waiver signers will see a 500 until a
// replacement is created.
adminWaiverDocuments.post('/:id/retire', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM waiver_documents WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.retired_at) return c.json({ error: 'Already retired' }, 409);
    await c.env.DB.prepare(
        `UPDATE waiver_documents SET retired_at = ? WHERE id = ?`
    ).bind(Date.now(), id).run();
    await writeAudit(c.env, user.id, 'waiver_document.retired', id, null, clientIp(c));
    return c.json({ ok: true });
});

export default adminWaiverDocuments;
