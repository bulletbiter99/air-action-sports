// Marketing milestone Batch 1 — admin customer-segments CRUD + preview.
//
// Backs the segments table (migration 0022) for type='customer_segment'.
// Saved views ride the same table with type='saved_view' (M4 substrate);
// these routes REFUSE to touch rows where type != 'customer_segment' so
// the two surfaces stay isolated.
//
// Endpoints:
//   GET    /api/admin/segments           list (owner=me|all filter; default all-shared)
//   GET    /api/admin/segments/:id       detail (parsed query JSON)
//   POST   /api/admin/segments           create (validates spec; audit)
//   PUT    /api/admin/segments/:id       update name / query / shared
//   DELETE /api/admin/segments/:id       hard delete (B1 only; B2 may add archived_at)
//   POST   /api/admin/segments/preview   ad-hoc count for unsaved spec
//   POST   /api/admin/segments/:id/preview  count for saved spec
//
// Gating: requireAuth only in B1. The B6 closing batch swaps each route to
// requireCapability('marketing.segments.{read,write,delete}') once those
// caps are seeded. The TODO comment block below documents the swap surface.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { randomId } from '../../lib/ids.js';
import {
    validateFilterSpec,
    previewSegmentCount,
    resolveSegmentToCustomerList,
} from '../../lib/segments.js';

const adminSegments = new Hono();
adminSegments.use('*', requireAuth);
// Marketing-capability gating (migration 0070 seeds marketing.* caps + owner /
// marketing_manager bindings). requireAuth above sets the user; this picks the
// cap by method: reads (incl. preview counts) → .read, deletes → .delete,
// create/update → .write. requireCapability lazy-loads + checks the set.
adminSegments.use('*', (c, next) => {
    const m = c.req.method;
    const cap = (m === 'GET' || c.req.path.endsWith('/preview'))
        ? 'marketing.segments.read'
        : m === 'DELETE'
            ? 'marketing.segments.delete'
            : 'marketing.segments.write';
    return requireCapability(cap)(c, next);
});

function segmentId() {
    return `seg_${randomId(14)}`;
}

function parseStoredSpec(jsonStr) {
    try { return JSON.parse(jsonStr); }
    catch { return null; }
}

function summarizeQuery(spec) {
    if (!spec || typeof spec !== 'object') return null;
    const parts = [];
    const tagsAny = spec.tags?.any || [];
    const tagsAll = spec.tags?.all || [];
    const tagsNone = spec.tags?.none || [];
    if (tagsAny.length) parts.push(`tags(any: ${tagsAny.join(', ')})`);
    if (tagsAll.length) parts.push(`tags(all: ${tagsAll.join(', ')})`);
    if (tagsNone.length) parts.push(`!tags(${tagsNone.join(', ')})`);
    if (spec.ltvCents?.min != null) parts.push(`LTV ≥ $${(spec.ltvCents.min / 100).toFixed(0)}`);
    if (spec.ltvCents?.max != null) parts.push(`LTV ≤ $${(spec.ltvCents.max / 100).toFixed(0)}`);
    if (spec.totalBookings?.min != null) parts.push(`bookings ≥ ${spec.totalBookings.min}`);
    if (spec.totalBookings?.max != null) parts.push(`bookings ≤ ${spec.totalBookings.max}`);
    return parts.join(' · ') || '(no filters)';
}

function formatSegmentRow(row) {
    const parsedQuery = parseStoredSpec(row.query_json) || {};
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        ownerId: row.owner_id,
        shared: row.shared === 1,
        query: parsedQuery,
        querySummary: summarizeQuery(parsedQuery),
        lastPreviewCount: parsedQuery._cache?.count ?? null,
        lastPreviewAt: parsedQuery._cache?.at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/segments — list
// ────────────────────────────────────────────────────────────────────
adminSegments.get('/', async (c) => {
    const user = c.get('user');
    const url = new URL(c.req.url);
    const owner = url.searchParams.get('owner') || 'all';

    const where = ["type = 'customer_segment'"];
    const binds = [];
    if (owner === 'me') {
        where.push('owner_id = ?');
        binds.push(user.id);
    } else {
        // 'all': owned by me OR shared by anyone
        where.push('(owner_id = ? OR shared = 1)');
        binds.push(user.id);
    }

    let rows;
    try {
        const result = await c.env.DB.prepare(
            `SELECT * FROM segments WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`,
        ).bind(...binds).all();
        rows = result.results || [];
    } catch {
        // segments table missing on local dev — graceful empty
        rows = [];
    }

    return c.json({ segments: rows.map(formatSegmentRow) });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/segments/:id — detail
// ────────────────────────────────────────────────────────────────────
adminSegments.get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
        "SELECT * FROM segments WHERE id = ? AND type = 'customer_segment'",
    ).bind(id).first();
    if (!row) return c.json({ error: 'Segment not found' }, 404);
    return c.json({ segment: formatSegmentRow(row) });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/segments — create
// ────────────────────────────────────────────────────────────────────
adminSegments.post('/', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
        return c.json({ error: 'name is required' }, 400);
    }
    const v = validateFilterSpec(body.query);
    if (!v.valid) return c.json({ error: v.error }, 400);

    const id = segmentId();
    const now = Date.now();
    const shared = body.shared ? 1 : 0;

    await c.env.DB.prepare(
        `INSERT INTO segments (id, name, type, query_json, owner_id, shared, created_at, updated_at)
         VALUES (?, ?, 'customer_segment', ?, ?, ?, ?, ?)`,
    ).bind(id, body.name.trim(), JSON.stringify(v.normalized), user.id, shared, now, now).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'segment.created',
        targetType: 'segment',
        targetId: id,
        meta: { name: body.name.trim(), shared: !!shared },
    });

    const created = await c.env.DB.prepare('SELECT * FROM segments WHERE id = ?').bind(id).first();
    return c.json({ segment: formatSegmentRow(created) }, 201);
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/segments/:id — update
// ────────────────────────────────────────────────────────────────────
adminSegments.put('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(
        'SELECT id, type FROM segments WHERE id = ?',
    ).bind(id).first();
    if (!existing) return c.json({ error: 'Segment not found' }, 404);
    if (existing.type !== 'customer_segment') {
        return c.json({ error: 'Refusing to edit a saved_view via the segments route' }, 409);
    }

    const updates = {};
    if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim()) {
            return c.json({ error: 'name must be a non-empty string' }, 400);
        }
        updates.name = body.name.trim();
    }
    if (body.query !== undefined) {
        const v = validateFilterSpec(body.query);
        if (!v.valid) return c.json({ error: v.error }, 400);
        updates.query_json = JSON.stringify(v.normalized);
    }
    if (body.shared !== undefined) {
        updates.shared = body.shared ? 1 : 0;
    }

    if (Object.keys(updates).length === 0) {
        return c.json({ error: 'No fields to update' }, 400);
    }

    const now = Date.now();
    updates.updated_at = now;
    const keys = Object.keys(updates);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => updates[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE segments SET ${sets} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'segment.updated',
        targetType: 'segment',
        targetId: id,
        meta: { fields: keys.filter((k) => k !== 'updated_at') },
    });

    const updated = await c.env.DB.prepare('SELECT * FROM segments WHERE id = ?').bind(id).first();
    return c.json({ segment: formatSegmentRow(updated) });
});

// ────────────────────────────────────────────────────────────────────
// DELETE /api/admin/segments/:id — hard delete (B1)
// ────────────────────────────────────────────────────────────────────
adminSegments.delete('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
        'SELECT id, type FROM segments WHERE id = ?',
    ).bind(id).first();
    if (!existing) return c.json({ error: 'Segment not found' }, 404);
    if (existing.type !== 'customer_segment') {
        return c.json({ error: 'Refusing to delete a saved_view via the segments route' }, 409);
    }
    await c.env.DB.prepare('DELETE FROM segments WHERE id = ?').bind(id).run();
    await writeAudit(c.env, {
        userId: user.id,
        action: 'segment.deleted',
        targetType: 'segment',
        targetId: id,
        meta: {},
    });
    return c.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/segments/preview — count for unsaved spec
// ────────────────────────────────────────────────────────────────────
adminSegments.post('/preview', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const v = validateFilterSpec(body.query);
    if (!v.valid) return c.json({ error: v.error }, 400);

    const count = await previewSegmentCount(c.env.DB, v.normalized);
    const sample = await resolveSegmentToCustomerList(c.env.DB, v.normalized, { limit: 10 });
    return c.json({
        count,
        sampleCustomers: sample.customers,
        computedAt: Date.now(),
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/segments/:id/preview — count for saved spec
// ────────────────────────────────────────────────────────────────────
adminSegments.post('/:id/preview', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
        "SELECT * FROM segments WHERE id = ? AND type = 'customer_segment'",
    ).bind(id).first();
    if (!row) return c.json({ error: 'Segment not found' }, 404);

    const spec = parseStoredSpec(row.query_json);
    if (!spec) return c.json({ error: 'Stored query_json is malformed' }, 500);

    const count = await previewSegmentCount(c.env.DB, spec);
    const sample = await resolveSegmentToCustomerList(c.env.DB, spec, { limit: 10 });
    return c.json({
        count,
        sampleCustomers: sample.customers,
        computedAt: Date.now(),
    });
});

export default adminSegments;
