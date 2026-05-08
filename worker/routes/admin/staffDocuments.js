// M5 Batch 5 — admin staff document library (Surface 4a part 3).
//
// Versioned JD/SOP/Checklist/Policy/Training documents. Mirrors
// waiver_documents pattern (migration 0011 / waiverDocuments.js):
// new version retires previous; past acknowledgments stay pinned to
// whatever version was acknowledged.
//
// Endpoints:
//   GET  /api/admin/staff-documents                    list (filter by kind)
//   GET  /api/admin/staff-documents/:id                detail
//   POST /api/admin/staff-documents                    new doc / new version
//   POST /api/admin/staff-documents/:id/retire         retire without replacement
//   POST /api/admin/staff-documents/:id/role-tag       attach to role with required flag
//   DELETE /api/admin/staff-documents/:id/role-tag/:tagId  detach

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminStaffDocuments = new Hono();
adminStaffDocuments.use('*', requireAuth);

const KINDS = ['jd', 'sop', 'checklist', 'policy', 'training'];

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomDocId(prefix) {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let out = '';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `${prefix}_${out}`;
}

function format(row) {
    if (!row) return null;
    return {
        id: row.id,
        kind: row.kind,
        slug: row.slug,
        title: row.title,
        bodyHtml: row.body_html,
        bodySha256: row.body_sha256,
        version: row.version,
        primaryRoleId: row.primary_role_id,
        description: row.description,
        retiredAt: row.retired_at,
        createdAt: row.created_at,
    };
}

// GET /api/admin/staff-documents
adminStaffDocuments.get('/', requireCapability('staff.documents.read'), async (c) => {
    const url = new URL(c.req.url);
    const kind = url.searchParams.get('kind');
    const includeRetired = url.searchParams.get('include_retired') === '1';
    const roleId = url.searchParams.get('role_id');

    const where = [];
    const binds = [];
    if (kind && KINDS.includes(kind)) {
        where.push('kind = ?');
        binds.push(kind);
    }
    if (!includeRetired) {
        where.push('retired_at IS NULL');
    }
    if (roleId) {
        where.push('primary_role_id = ?');
        binds.push(roleId);
    }

    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT * FROM staff_documents ${whereSQL} ORDER BY kind, slug, version DESC`
    ).bind(...binds).all();
    return c.json({ documents: (rows.results || []).map(format) });
});

// GET /api/admin/staff-documents/:id
adminStaffDocuments.get('/:id', requireCapability('staff.documents.read'), async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM staff_documents WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);

    const tagsResult = await c.env.DB.prepare(
        `SELECT sdr.id, sdr.role_id, r.key, r.name, sdr.required, sdr.created_at
         FROM staff_document_roles sdr
         INNER JOIN roles r ON r.id = sdr.role_id
         WHERE sdr.staff_document_id = ?
         ORDER BY r.tier, r.name`
    ).bind(id).all();

    return c.json({
        document: format(row),
        roleTags: (tagsResult.results || []).map((t) => ({
            id: t.id,
            roleId: t.role_id,
            key: t.key,
            name: t.name,
            required: t.required === 1,
            createdAt: t.created_at,
        })),
    });
});

// POST /api/admin/staff-documents
adminStaffDocuments.post('/', requireCapability('staff.documents.write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const { kind, slug, title, bodyHtml, version, primaryRoleId, description } = body;
    if (!KINDS.includes(kind)) return c.json({ error: `kind must be one of ${KINDS.join(',')}` }, 400);
    if (!slug || !title || !bodyHtml || !version) {
        return c.json({ error: 'slug, title, bodyHtml, version required' }, 400);
    }
    if (bodyHtml.length > 500000) return c.json({ error: 'bodyHtml too long (max 500,000 chars)' }, 400);

    const dup = await c.env.DB.prepare(
        `SELECT id FROM staff_documents WHERE slug = ? AND version = ?`
    ).bind(slug, version).first();
    if (dup) return c.json({ error: `Version ${version} already exists for slug=${slug}` }, 409);

    const now = Date.now();
    const id = randomDocId('sd');
    const hash = await sha256Hex(bodyHtml);

    // Retire previous live version of the same slug (if any)
    await c.env.DB.prepare(
        `UPDATE staff_documents SET retired_at = ?, retired_by_user_id = ?
         WHERE slug = ? AND retired_at IS NULL`
    ).bind(now, user.id, slug).run();

    await c.env.DB.prepare(
        `INSERT INTO staff_documents (id, kind, slug, title, body_html, body_sha256, version,
                                      primary_role_id, description, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, kind, slug, title, bodyHtml, hash, version, primaryRoleId || null, description || null, user.id, now).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff_document.created',
        targetType: 'staff_document',
        targetId: id,
        meta: { kind, slug, version, body_sha256: hash },
    });

    const row = await c.env.DB.prepare('SELECT * FROM staff_documents WHERE id = ?').bind(id).first();
    return c.json({ document: format(row) }, 201);
});

// POST /api/admin/staff-documents/:id/retire
adminStaffDocuments.post('/:id/retire', requireCapability('staff.documents.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM staff_documents WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.retired_at) return c.json({ error: 'Already retired' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE staff_documents SET retired_at = ?, retired_by_user_id = ? WHERE id = ?`
    ).bind(now, user.id, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff_document.retired',
        targetType: 'staff_document',
        targetId: id,
    });
    return c.json({ ok: true });
});

// POST /api/admin/staff-documents/:id/role-tag  { roleId, required }
adminStaffDocuments.post('/:id/role-tag', requireCapability('staff.documents.assign'), async (c) => {
    const user = c.get('user');
    const docId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { roleId, required } = body || {};
    if (!roleId) return c.json({ error: 'roleId required' }, 400);

    const role = await c.env.DB.prepare('SELECT id FROM roles WHERE id = ?').bind(roleId).first();
    if (!role) return c.json({ error: 'Unknown roleId' }, 400);

    const tagId = randomDocId('sdr');
    const now = Date.now();
    try {
        await c.env.DB.prepare(
            `INSERT INTO staff_document_roles (id, staff_document_id, role_id, required, created_at)
             VALUES (?, ?, ?, ?, ?)`
        ).bind(tagId, docId, roleId, required ? 1 : 0, now).run();
    } catch {
        return c.json({ error: 'Tag already exists for this doc + role' }, 409);
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff_document.role_tagged',
        targetType: 'staff_document',
        targetId: docId,
        meta: { roleId, required: Boolean(required) },
    });

    return c.json({ ok: true, id: tagId });
});

// DELETE /api/admin/staff-documents/:id/role-tag/:tagId
adminStaffDocuments.delete('/:id/role-tag/:tagId', requireCapability('staff.documents.assign'), async (c) => {
    const user = c.get('user');
    const docId = c.req.param('id');
    const tagId = c.req.param('tagId');
    const result = await c.env.DB.prepare(
        `DELETE FROM staff_document_roles WHERE id = ? AND staff_document_id = ?`
    ).bind(tagId, docId).run();

    if (!result?.meta?.changes) return c.json({ error: 'Not found' }, 404);

    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff_document.role_untagged',
        targetType: 'staff_document',
        targetId: docId,
        meta: { tagId },
    });
    return c.json({ ok: true });
});

export default adminStaffDocuments;
