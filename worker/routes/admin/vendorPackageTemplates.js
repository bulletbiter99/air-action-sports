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
import { parseSections, normalizeSections, cloneTemplateSections } from '../../lib/vendorPackageTemplates.js';

const adminVendorPackageTemplates = new Hono();
adminVendorPackageTemplates.use('*', requireAuth);

function templateId() { return `vtpl_${randomId(12)}`; }
function evndId() { return `evnd_${randomId(12)}`; }

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

// ───── PUT /:id — update template (B2) ─────
// Partial update: any field omitted is left unchanged. Body shape:
//   { name?, description?, sections?, requiresSignature? }
adminVendorPackageTemplates.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(
        `SELECT * FROM vendor_package_templates WHERE id = ?`
    ).bind(id).first();
    if (!existing) return c.json({ error: 'Template not found' }, 404);
    if (existing.deleted_at) return c.json({ error: 'Cannot edit an archived template' }, 409);

    // Build the partial update — only set the columns the caller provided.
    const sets = [];
    const binds = [];
    const changedFields = [];

    if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) return c.json({ error: 'name cannot be empty' }, 400);
        if (name.length > 200) return c.json({ error: 'name too long (max 200 chars)' }, 400);
        sets.push('name = ?');
        binds.push(name);
        changedFields.push('name');
    }

    if (body.description !== undefined) {
        const description = body.description === null
            ? null
            : String(body.description).trim().slice(0, 2000);
        sets.push('description = ?');
        binds.push(description);
        changedFields.push('description');
    }

    if (body.sections !== undefined) {
        const sections = normalizeSections(body.sections);
        sets.push('sections_json = ?');
        binds.push(JSON.stringify(sections));
        changedFields.push('sections');
    }

    if (body.requiresSignature !== undefined) {
        sets.push('requires_signature = ?');
        binds.push(body.requiresSignature ? 1 : 0);
        changedFields.push('requiresSignature');
    }

    if (sets.length === 0) {
        return c.json({ error: 'No fields to update' }, 400);
    }

    const now = Date.now();
    sets.push('updated_at = ?');
    binds.push(now);
    binds.push(id);

    await c.env.DB.prepare(
        `UPDATE vendor_package_templates SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'vendor_template.updated',
        targetType: 'vendor_package_template',
        targetId: id,
        meta: { changedFields },
    });

    const row = await c.env.DB.prepare(
        `SELECT * FROM vendor_package_templates WHERE id = ?`
    ).bind(id).first();
    return c.json({ template: formatTemplate(row) });
});

// ───── POST /:id/clone-to-event — instantiate template as event_vendor (B2) ─────
// Body: { eventId, vendorId, primaryContactId? }
// Creates a new event_vendors row with template_id + contract_required from
// the template's requires_signature, then INSERTs vendor_package_sections
// for each section in the template's sections_json (via cloneTemplateSections).
// Refuses if a (event, vendor) row already exists — 409 with the existing
// event_vendor id so the caller can deep-link there.
adminVendorPackageTemplates.post('/:id/clone-to-event', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const templateRowId = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const eventId = String(body.eventId || '').trim();
    const vendorId = String(body.vendorId || '').trim();
    if (!eventId) return c.json({ error: 'eventId required' }, 400);
    if (!vendorId) return c.json({ error: 'vendorId required' }, 400);

    // Verify the template exists and isn't archived
    const template = await c.env.DB.prepare(
        `SELECT * FROM vendor_package_templates WHERE id = ?`
    ).bind(templateRowId).first();
    if (!template) return c.json({ error: 'Template not found' }, 404);
    if (template.deleted_at) return c.json({ error: 'Cannot clone an archived template' }, 409);

    // Verify event + vendor exist
    const event = await c.env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(eventId).first();
    if (!event) return c.json({ error: 'Event not found' }, 404);
    const vendor = await c.env.DB.prepare(`SELECT id, deleted_at FROM vendors WHERE id = ?`).bind(vendorId).first();
    if (!vendor) return c.json({ error: 'Vendor not found' }, 404);
    if (vendor.deleted_at) return c.json({ error: 'Vendor is archived' }, 409);

    // event_vendors has UNIQUE(event_id, vendor_id) — preempt the constraint
    // with a clean 409 + the existing id so the UI can route to it.
    const existing = await c.env.DB.prepare(
        `SELECT id FROM event_vendors WHERE event_id = ? AND vendor_id = ?`
    ).bind(eventId, vendorId).first();
    if (existing) {
        return c.json({
            error: 'This vendor is already attached to that event',
            eventVendorId: existing.id,
        }, 409);
    }

    const id = evndId();
    const now = Date.now();
    const primaryContactId = body.primaryContactId ? String(body.primaryContactId).trim() : null;
    const contractRequired = template.requires_signature ? 1 : 0;

    // Create the event_vendor row including template_id (M5.5-era col from
    // migration 0012) + contract_required (also 0012). Status defaults to
    // 'draft' / token_version 1, matching adminEventVendors.post('/') intent.
    await c.env.DB.prepare(
        `INSERT INTO event_vendors
         (id, event_id, vendor_id, primary_contact_id, status, token_version,
          template_id, contract_required, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, NULL, ?, ?)`
    ).bind(id, eventId, vendorId, primaryContactId, templateRowId, contractRequired, now, now).run();

    // Clone the template's sections into per-event-vendor section rows.
    const sections = parseSections(template.sections_json);
    const cloneResult = await cloneTemplateSections(c.env, id, sections, now);

    await writeAudit(c.env, {
        userId: user.id,
        action: 'event_vendor.created_from_template',
        targetType: 'event_vendor',
        targetId: id,
        meta: {
            templateId: templateRowId,
            templateName: template.name,
            eventId,
            vendorId,
            sectionsCloned: cloneResult.inserted,
            contractRequired: !!contractRequired,
        },
    });

    return c.json({
        eventVendorId: id,
        sectionsCloned: cloneResult.inserted,
        contractRequired: !!contractRequired,
    }, 201);
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
