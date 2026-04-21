// Versioned immutable contract documents. Same pattern as waiver_documents:
// create a new row, retire the previous. Never edit body_html in place —
// it would invalidate every past vendor_signatures row whose body_sha256
// was computed against the old text.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { clientIp } from '../../lib/rateLimit.js';

const adminVendorContracts = new Hono();
adminVendorContracts.use('*', requireAuth);

function vcdId() { return `vcd_${randomId(12)}`; }

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
        title: r.title,
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
         VALUES (?, ?, 'vendor_contract_document', ?, ?, ?, ?)`
    ).bind(userId, action, targetId, meta ? JSON.stringify(meta) : null, ip, Date.now()).run();
}

// GET /api/admin/vendor-contracts
adminVendorContracts.get('/', async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT * FROM vendor_contract_documents ORDER BY version DESC`
    ).all();
    return c.json({ contracts: (rows.results || []).map(format) });
});

// POST /api/admin/vendor-contracts  { title, bodyHtml }
// Creates a new version, retires the previous live one.
adminVendorContracts.post('/', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const title = String(body.title || '').trim();
    const bodyHtml = String(body.bodyHtml || '').trim();
    if (!title || !bodyHtml) return c.json({ error: 'title and bodyHtml required' }, 400);
    if (bodyHtml.length > 200000) return c.json({ error: 'bodyHtml too long' }, 400);

    const latest = await c.env.DB.prepare(
        `SELECT MAX(version) AS v FROM vendor_contract_documents`
    ).first();
    const newVersion = (latest?.v ?? 0) + 1;

    const id = vcdId();
    const now = Date.now();
    const hash = await sha256Hex(bodyHtml);

    // Retire the currently-live doc (if any) at the same timestamp this one
    // takes effect, so there's never a moment with zero or two live docs.
    await c.env.DB.prepare(
        `UPDATE vendor_contract_documents SET retired_at = ? WHERE retired_at IS NULL`
    ).bind(now).run();

    await c.env.DB.prepare(
        `INSERT INTO vendor_contract_documents (id, version, title, body_html, body_sha256, effective_from, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, newVersion, title, bodyHtml, hash, now, user.id, now).run();

    await writeAudit(c.env, user.id, 'vendor_contract.created', id, { version: newVersion, body_sha256: hash }, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM vendor_contract_documents WHERE id = ?').bind(id).first();
    return c.json({ contract: format(row) }, 201);
});

// GET /api/admin/vendor-contracts/current — the active live document, or null
adminVendorContracts.get('/current', async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT * FROM vendor_contract_documents WHERE retired_at IS NULL ORDER BY version DESC LIMIT 1`
    ).first();
    return c.json({ contract: format(row) });
});

// POST /api/admin/vendor-contracts/:id/retire — owner-only emergency retire
// without a replacement (use sparingly; leaves package composer with no live
// doc to attach until a new one is created).
adminVendorContracts.post('/:id/retire', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM vendor_contract_documents WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.retired_at) return c.json({ error: 'Already retired' }, 409);
    await c.env.DB.prepare(
        `UPDATE vendor_contract_documents SET retired_at = ? WHERE id = ?`
    ).bind(Date.now(), id).run();
    await writeAudit(c.env, user.id, 'vendor_contract.retired', id, null, clientIp(c));
    return c.json({ ok: true });
});

export default adminVendorContracts;
