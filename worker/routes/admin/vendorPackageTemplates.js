// M6 Batch 1 — Admin CRUD for vendor_package_templates (the reusable
// template library used as starting points for per-event-vendor packages).
//
// The table itself ships in migration 0012 (vendor_v1); previously this
// table was insertable only via SQL per docs/audit/07-admin-surface-map.md
// line 38 + line 55 "Vendor package templates UI — deferred."
//
// Routes mounted at /api/admin/vendor-package-templates by worker/index.js.
// Read operations require auth; mutations require owner or manager (same
// gating as worker/routes/admin/vendors.js).
//
// sections_json shape (snapshot at clone time into vendor_package_sections):
//   [{kind, title, body_html, sort_order}, ...]
//
// B1 ships: GET list, GET :id, POST create, DELETE soft-delete.
// B2 will add: PUT edit + the detail/composer UI.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminVendorPackageTemplates = new Hono();
adminVendorPackageTemplates.use('*', requireAuth);

function templateId() { return `vtpl_${randomId(12)}`; }

function parseSections(json) {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatTemplate(r) {
    if (!r) return null;
    const sections = parseSections(r.sections_json);
    return {
        id: r.id,
        name: r.name,
        description: r.description,
        sections,
        sectionsCount: sections.length,
        requiresSignature: !!r.requires_signature,
        deletedAt: r.deleted_at,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function isValidSection(s) {
    return s && typeof s === 'object'
        && typeof s.title === 'string';
}

function normalizeSections(input) {
    if (!Array.isArray(input)) return [];
    return input
        .filter(isValidSection)
        .map((s, idx) => ({
            kind: typeof s.kind === 'string' ? s.kind : 'text',
            title: String(s.title).slice(0, 200),
            body_html: typeof s.body_html === 'string' ? s.body_html : '',
            sort_order: Number.isFinite(s.sort_order) ? s.sort_order : idx,
        }));
}

// ───── GET / — list templates ─────
// Query: ?q=<search>, ?include_deleted=1
adminVendorPackageTemplates.get('/', async (c) => {
    const url = new URL(c.req.url);
    const q = url.searchParams.get('q')?.trim();
    const includeDeleted = url.searchParams.get('include_deleted') === '1';

    const clauses = [];
    const binds = [];
    if (!includeDeleted) clauses.push('deleted_at IS NULL');
    if (q) {
        clauses.push('(name LIKE ? OR description LIKE ?)');
        binds.push(`%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT * FROM vendor_package_templates ${where} ORDER BY name ASC`
    ).bind(...binds).all();

    return c.json({
        templates: (rows.results || []).map((r) => formatTemplate(r)),
    });
});

// ───── GET /:id — single template (used by B2's detail page) ─────
adminVendorPackageTemplates.get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
        `SELECT * FROM vendor_package_templates WHERE id = ?`
    ).bind(id).first();

    if (!row) return c.json({ error: 'Template not found' }, 404);
    return c.json({ template: formatTemplate(row) });
});

// ───── POST / — create template ─────
// Body: { name, description?, sections?, requiresSignature? }
adminVendorPackageTemplates.post('/', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const name = String(body.name || '').trim();
    if (!name) return c.json({ error: 'name required' }, 400);
    if (name.length > 200) return c.json({ error: 'name too long (max 200 chars)' }, 400);

    const description = body.description ? String(body.description).trim().slice(0, 2000) : null;
    const sections = normalizeSections(body.sections);
    const requiresSignature = body.requiresSignature ? 1 : 0;

    const id = templateId();
    const now = Date.now();

    await c.env.DB.prepare(
        `INSERT INTO vendor_package_templates
         (id, name, description, sections_json, requires_signature, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        name,
        description,
        JSON.stringify(sections),
        requiresSignature,
        user.id,
        now,
        now,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'vendor_template.created',
        targetType: 'vendor_package_template',
        targetId: id,
        meta: { name, sectionsCount: sections.length, requiresSignature: !!requiresSignature },
    });

    const row = await c.env.DB.prepare(
        `SELECT * FROM vendor_package_templates WHERE id = ?`
    ).bind(id).first();

    return c.json({ template: formatTemplate(row) }, 201);
});

// ───── DELETE /:id — soft-delete template ─────
// Sets deleted_at; preserves the row so previously-cloned event_vendor
// packages still reference a valid FK target.
adminVendorPackageTemplates.delete('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const row = await c.env.DB.prepare(
        `SELECT id, name, deleted_at FROM vendor_package_templates WHERE id = ?`
    ).bind(id).first();
    if (!row) return c.json({ error: 'Template not found' }, 404);
    if (row.deleted_at) return c.json({ error: 'Template already archived' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE vendor_package_templates SET deleted_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'vendor_template.archived',
        targetType: 'vendor_package_template',
        targetId: id,
        meta: { name: row.name },
    });

    return c.json({ archived: true });
});

export default adminVendorPackageTemplates;
