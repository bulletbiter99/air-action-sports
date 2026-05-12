// M5.5 Batch 6.5 — admin sites + site_fields + site_blackouts CRUD
//
// Backs the AdminSites UI (B6.5). Endpoints:
//
//   GET    /api/admin/sites                              — List sites with stats
//   GET    /api/admin/sites/:id                          — Site detail + fields + blackouts
//   POST   /api/admin/sites                              — Create site
//   PUT    /api/admin/sites/:id                          — Update site metadata
//   DELETE /api/admin/sites/:id                          — Archive site (refuses if upcoming events/rentals)
//   POST   /api/admin/sites/:id/fields                   — Add field to site
//   PUT    /api/admin/sites/:id/fields/:fieldId          — Update field
//   DELETE /api/admin/sites/:id/fields/:fieldId          — Archive field
//   POST   /api/admin/sites/:id/blackouts                — Create blackout
//   DELETE /api/admin/sites/:id/blackouts/:blackoutId    — Delete blackout (hard delete; no archive)
//
// Capability gating per route:
//   sites.read           — GET endpoints
//   sites.write          — POST/PUT for sites + all field endpoints + POST/DELETE blackouts
//   sites.archive        — DELETE /:id (site archive only; field archive is sites.write)
//   sites.blackout_create — additional gate on POST blackouts (in addition to sites.write)

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { siteId as newSiteId, fieldId as newFieldId, blackoutId as newBlackoutId, slugify } from '../../lib/ids.js';

const adminSites = new Hono();
adminSites.use('*', requireAuth);

// ────────────────────────────────────────────────────────────────────
// Format helpers — DB row → JSON response shape (camelCase)
// ────────────────────────────────────────────────────────────────────

function formatSite(row) {
    if (!row) return null;
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        address: row.address,
        city: row.city,
        state: row.state,
        postalCode: row.postal_code,
        totalAcreage: row.total_acreage,
        notes: row.notes,
        active: !!row.active,
        archivedAt: row.archived_at,
        defaultArrivalBufferMinutes: row.default_arrival_buffer_minutes,
        defaultCleanupBufferMinutes: row.default_cleanup_buffer_minutes,
        defaultBlackoutWindow: row.default_blackout_window,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function formatField(row) {
    if (!row) return null;
    return {
        id: row.id,
        siteId: row.site_id,
        slug: row.slug,
        name: row.name,
        approximateAcreage: row.approximate_acreage,
        notes: row.notes,
        active: !!row.active,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
    };
}

function formatBlackout(row) {
    if (!row) return null;
    return {
        id: row.id,
        siteId: row.site_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        reason: row.reason,
        createdBy: row.created_by,
        createdAt: row.created_at,
    };
}

// ────────────────────────────────────────────────────────────────────
// Body parsers
// ────────────────────────────────────────────────────────────────────

function parseSiteBody(body, { partial = false } = {}) {
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.slug !== undefined) patch.slug = body.slug === null ? null : slugify(body.slug);
    if (body.address !== undefined) patch.address = body.address === null ? null : String(body.address).trim();
    if (body.city !== undefined) patch.city = body.city === null ? null : String(body.city).trim();
    if (body.state !== undefined) patch.state = body.state === null ? null : String(body.state).trim();
    if (body.postalCode !== undefined) patch.postal_code = body.postalCode === null ? null : String(body.postalCode).trim();
    if (body.totalAcreage !== undefined) {
        const n = body.totalAcreage === null ? null : Number(body.totalAcreage);
        if (n !== null && !Number.isFinite(n)) return { error: 'totalAcreage must be a number' };
        patch.total_acreage = n;
    }
    if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes);
    if (body.defaultArrivalBufferMinutes !== undefined) {
        const n = Number(body.defaultArrivalBufferMinutes);
        if (!Number.isFinite(n) || n < 0) return { error: 'defaultArrivalBufferMinutes must be a non-negative number' };
        patch.default_arrival_buffer_minutes = Math.round(n);
    }
    if (body.defaultCleanupBufferMinutes !== undefined) {
        const n = Number(body.defaultCleanupBufferMinutes);
        if (!Number.isFinite(n) || n < 0) return { error: 'defaultCleanupBufferMinutes must be a non-negative number' };
        patch.default_cleanup_buffer_minutes = Math.round(n);
    }
    if (body.defaultBlackoutWindow !== undefined) {
        patch.default_blackout_window = body.defaultBlackoutWindow === null ? null : String(body.defaultBlackoutWindow);
    }

    if (!partial) {
        if (!patch.name) return { error: 'name is required' };
        // Auto-slug from name when omitted on create
        if (!patch.slug) patch.slug = slugify(patch.name);
    }
    return { patch };
}

function parseFieldBody(body, { partial = false } = {}) {
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.slug !== undefined) patch.slug = body.slug === null ? null : slugify(body.slug);
    if (body.approximateAcreage !== undefined) {
        const n = body.approximateAcreage === null ? null : Number(body.approximateAcreage);
        if (n !== null && !Number.isFinite(n)) return { error: 'approximateAcreage must be a number' };
        patch.approximate_acreage = n;
    }
    if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes);

    if (!partial) {
        if (!patch.name) return { error: 'name is required' };
        if (!patch.slug) patch.slug = slugify(patch.name);
    }
    return { patch };
}

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/sites — list with stats
// ────────────────────────────────────────────────────────────────────

adminSites.get('/', requireCapability('sites.read'), async (c) => {
    const url = new URL(c.req.url);
    const includeArchived = url.searchParams.get('archived') === 'true';

    const whereClause = includeArchived ? '' : 'WHERE s.archived_at IS NULL';

    // Subqueries for stats:
    //   active_field_count: site_fields where archived_at IS NULL
    //   upcoming_event_count: events where date_iso >= today's UTC date
    //   upcoming_rental_count: field_rentals where scheduled_starts_at >= now
    const todayIso = new Date().toISOString().slice(0, 10);
    const nowMs = Date.now();

    const sql = `
        SELECT s.*,
          (SELECT COUNT(*) FROM site_fields f WHERE f.site_id = s.id AND f.archived_at IS NULL) AS active_field_count,
          (SELECT COUNT(*) FROM events e WHERE e.site_id = s.id AND e.date_iso >= ?) AS upcoming_event_count,
          (SELECT COUNT(*) FROM field_rentals fr WHERE fr.site_id = s.id AND fr.scheduled_starts_at >= ? AND fr.cancelled_at IS NULL) AS upcoming_rental_count
        FROM sites s
        ${whereClause}
        ORDER BY s.archived_at IS NOT NULL ASC, s.name ASC
    `;

    const result = await c.env.DB.prepare(sql).bind(todayIso, nowMs).all();
    const rows = result.results || [];

    return c.json({
        sites: rows.map((r) => ({
            ...formatSite(r),
            activeFieldCount: r.active_field_count || 0,
            upcomingEventCount: r.upcoming_event_count || 0,
            upcomingRentalCount: r.upcoming_rental_count || 0,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/sites/:id — site detail + fields + blackouts
// ────────────────────────────────────────────────────────────────────

adminSites.get('/:id', requireCapability('sites.read'), async (c) => {
    const id = c.req.param('id');
    const url = new URL(c.req.url);
    const includeArchivedFields = url.searchParams.get('archivedFields') === 'true';

    const site = await c.env.DB.prepare(`SELECT * FROM sites WHERE id = ?`).bind(id).first();
    if (!site) return c.json({ error: 'Site not found' }, 404);

    const fieldsWhereArchive = includeArchivedFields ? '' : 'AND archived_at IS NULL';
    const fieldsRes = await c.env.DB.prepare(
        `SELECT * FROM site_fields WHERE site_id = ? ${fieldsWhereArchive} ORDER BY archived_at IS NOT NULL ASC, name ASC`,
    ).bind(id).all();

    const blackoutsRes = await c.env.DB.prepare(
        `SELECT * FROM site_blackouts WHERE site_id = ? ORDER BY starts_at DESC`,
    ).bind(id).all();

    // Stats for the detail page (separate from list)
    const todayIso = new Date().toISOString().slice(0, 10);
    const nowMs = Date.now();
    const upcomingEvents = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND date_iso >= ?`,
    ).bind(id, todayIso).first();
    const upcomingRentals = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM field_rentals WHERE site_id = ? AND scheduled_starts_at >= ? AND cancelled_at IS NULL`,
    ).bind(id, nowMs).first();

    return c.json({
        site: formatSite(site),
        fields: (fieldsRes.results || []).map(formatField),
        blackouts: (blackoutsRes.results || []).map(formatBlackout),
        stats: {
            upcomingEventCount: upcomingEvents?.n || 0,
            upcomingRentalCount: upcomingRentals?.n || 0,
        },
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/sites — create site
// ────────────────────────────────────────────────────────────────────

adminSites.post('/', requireCapability('sites.write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const { patch, error } = parseSiteBody(body, { partial: false });
    if (error) return c.json({ error }, 400);

    // Check slug uniqueness before insert
    const existing = await c.env.DB.prepare(`SELECT id FROM sites WHERE slug = ?`).bind(patch.slug).first();
    if (existing) return c.json({ error: `Slug "${patch.slug}" already in use`, conflictingId: existing.id }, 409);

    const id = newSiteId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO sites (id, slug, name, address, city, state, postal_code, total_acreage, notes, active, archived_at, default_arrival_buffer_minutes, default_cleanup_buffer_minutes, default_blackout_window, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?)`,
    )
        .bind(
            id,
            patch.slug,
            patch.name,
            patch.address ?? null,
            patch.city ?? null,
            patch.state ?? null,
            patch.postal_code ?? null,
            patch.total_acreage ?? null,
            patch.notes ?? null,
            patch.default_arrival_buffer_minutes ?? 30,
            patch.default_cleanup_buffer_minutes ?? 30,
            patch.default_blackout_window ?? null,
            now,
            now,
        )
        .run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site.created',
        targetType: 'site',
        targetId: id,
        meta: { slug: patch.slug, name: patch.name },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM sites WHERE id = ?`).bind(id).first();
    return c.json({ site: formatSite(row) }, 201);
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/sites/:id — update site metadata
// ────────────────────────────────────────────────────────────────────

adminSites.put('/:id', requireCapability('sites.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT id, slug FROM sites WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Site not found' }, 404);

    const { patch, error } = parseSiteBody(body, { partial: true });
    if (error) return c.json({ error }, 400);

    // Slug uniqueness check on change
    if (patch.slug && patch.slug !== existing.slug) {
        const conflict = await c.env.DB.prepare(`SELECT id FROM sites WHERE slug = ? AND id != ?`).bind(patch.slug, id).first();
        if (conflict) return c.json({ error: `Slug "${patch.slug}" already in use`, conflictingId: conflict.id }, 409);
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) return c.json({ error: 'No changes' }, 400);

    keys.push('updated_at');
    patch.updated_at = Date.now();
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE sites SET ${sets} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site.updated',
        targetType: 'site',
        targetId: id,
        meta: { fields: keys.filter((k) => k !== 'updated_at') },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM sites WHERE id = ?`).bind(id).first();
    return c.json({ site: formatSite(row) });
});

// ────────────────────────────────────────────────────────────────────
// DELETE /api/admin/sites/:id — archive site (soft delete)
// Refuses with 409 if upcoming events OR upcoming field_rentals reference the site.
// ────────────────────────────────────────────────────────────────────

adminSites.delete('/:id', requireCapability('sites.archive'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare(`SELECT id, name, archived_at FROM sites WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Site not found' }, 404);
    if (existing.archived_at) return c.json({ error: 'Site already archived' }, 409);

    // Archive guard — upcoming events OR upcoming rentals block
    const todayIso = new Date().toISOString().slice(0, 10);
    const nowMs = Date.now();
    const upcomingEvents = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND date_iso >= ?`,
    ).bind(id, todayIso).first();
    const upcomingRentals = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM field_rentals WHERE site_id = ? AND scheduled_starts_at >= ? AND cancelled_at IS NULL`,
    ).bind(id, nowMs).first();
    if ((upcomingEvents?.n || 0) > 0 || (upcomingRentals?.n || 0) > 0) {
        return c.json({
            error: 'Cannot archive: site has upcoming events or rentals. Cancel or move them first.',
            upcomingEventCount: upcomingEvents?.n || 0,
            upcomingRentalCount: upcomingRentals?.n || 0,
        }, 409);
    }

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE sites SET archived_at = ?, active = 0, updated_at = ? WHERE id = ?`,
    ).bind(now, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site.archived',
        targetType: 'site',
        targetId: id,
        meta: { name: existing.name },
    });

    return c.json({ archived: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/sites/:id/fields — add field
// ────────────────────────────────────────────────────────────────────

adminSites.post('/:id/fields', requireCapability('sites.write'), async (c) => {
    const user = c.get('user');
    const siteIdParam = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const site = await c.env.DB.prepare(`SELECT id, archived_at FROM sites WHERE id = ?`).bind(siteIdParam).first();
    if (!site) return c.json({ error: 'Site not found' }, 404);
    if (site.archived_at) return c.json({ error: 'Cannot add field to archived site' }, 409);

    const { patch, error } = parseFieldBody(body, { partial: false });
    if (error) return c.json({ error }, 400);

    // Slug uniqueness within site (UNIQUE constraint covers this; check early for friendly error)
    const existingField = await c.env.DB.prepare(
        `SELECT id FROM site_fields WHERE site_id = ? AND slug = ?`,
    ).bind(siteIdParam, patch.slug).first();
    if (existingField) return c.json({ error: `Field slug "${patch.slug}" already in use on this site`, conflictingId: existingField.id }, 409);

    const id = newFieldId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO site_fields (id, site_id, slug, name, approximate_acreage, notes, active, archived_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`,
    ).bind(id, siteIdParam, patch.slug, patch.name, patch.approximate_acreage ?? null, patch.notes ?? null, now).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site_field.created',
        targetType: 'site_field',
        targetId: id,
        meta: { siteId: siteIdParam, slug: patch.slug, name: patch.name },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM site_fields WHERE id = ?`).bind(id).first();
    return c.json({ field: formatField(row) }, 201);
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/sites/:id/fields/:fieldId — update field
// ────────────────────────────────────────────────────────────────────

adminSites.put('/:id/fields/:fieldId', requireCapability('sites.write'), async (c) => {
    const user = c.get('user');
    const siteIdParam = c.req.param('id');
    const fieldIdParam = c.req.param('fieldId');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(
        `SELECT id, slug FROM site_fields WHERE id = ? AND site_id = ?`,
    ).bind(fieldIdParam, siteIdParam).first();
    if (!existing) return c.json({ error: 'Field not found' }, 404);

    const { patch, error } = parseFieldBody(body, { partial: true });
    if (error) return c.json({ error }, 400);

    if (patch.slug && patch.slug !== existing.slug) {
        const conflict = await c.env.DB.prepare(
            `SELECT id FROM site_fields WHERE site_id = ? AND slug = ? AND id != ?`,
        ).bind(siteIdParam, patch.slug, fieldIdParam).first();
        if (conflict) return c.json({ error: `Field slug "${patch.slug}" already in use on this site`, conflictingId: conflict.id }, 409);
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) return c.json({ error: 'No changes' }, 400);

    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(fieldIdParam);
    await c.env.DB.prepare(`UPDATE site_fields SET ${sets} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site_field.updated',
        targetType: 'site_field',
        targetId: fieldIdParam,
        meta: { siteId: siteIdParam, fields: keys },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM site_fields WHERE id = ?`).bind(fieldIdParam).first();
    return c.json({ field: formatField(row) });
});

// ────────────────────────────────────────────────────────────────────
// DELETE /api/admin/sites/:id/fields/:fieldId — archive field
// ────────────────────────────────────────────────────────────────────

adminSites.delete('/:id/fields/:fieldId', requireCapability('sites.write'), async (c) => {
    const user = c.get('user');
    const siteIdParam = c.req.param('id');
    const fieldIdParam = c.req.param('fieldId');

    const existing = await c.env.DB.prepare(
        `SELECT id, name, archived_at FROM site_fields WHERE id = ? AND site_id = ?`,
    ).bind(fieldIdParam, siteIdParam).first();
    if (!existing) return c.json({ error: 'Field not found' }, 404);
    if (existing.archived_at) return c.json({ error: 'Field already archived' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE site_fields SET archived_at = ?, active = 0 WHERE id = ?`,
    ).bind(now, fieldIdParam).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site_field.archived',
        targetType: 'site_field',
        targetId: fieldIdParam,
        meta: { siteId: siteIdParam, name: existing.name },
    });

    return c.json({ archived: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/sites/:id/blackouts — create blackout
// ────────────────────────────────────────────────────────────────────

adminSites.post('/:id/blackouts', requireCapability('sites.blackout_create'), async (c) => {
    const user = c.get('user');
    const siteIdParam = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const site = await c.env.DB.prepare(`SELECT id, archived_at FROM sites WHERE id = ?`).bind(siteIdParam).first();
    if (!site) return c.json({ error: 'Site not found' }, 404);
    if (site.archived_at) return c.json({ error: 'Cannot add blackout to archived site' }, 409);

    const startsAt = Number(body.startsAt);
    const endsAt = Number(body.endsAt);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
        return c.json({ error: 'startsAt and endsAt are required (epoch ms)' }, 400);
    }
    if (endsAt <= startsAt) {
        return c.json({ error: 'endsAt must be after startsAt' }, 400);
    }
    const reason = body.reason ? String(body.reason).trim() : null;

    const id = newBlackoutId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO site_blackouts (id, site_id, starts_at, ends_at, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, siteIdParam, startsAt, endsAt, reason, user.id, now).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site_blackout.created',
        targetType: 'site_blackout',
        targetId: id,
        meta: { siteId: siteIdParam, startsAt, endsAt, reason },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM site_blackouts WHERE id = ?`).bind(id).first();
    return c.json({ blackout: formatBlackout(row) }, 201);
});

// ────────────────────────────────────────────────────────────────────
// DELETE /api/admin/sites/:id/blackouts/:blackoutId — delete blackout
// Hard delete (no archived_at column on site_blackouts).
// ────────────────────────────────────────────────────────────────────

adminSites.delete('/:id/blackouts/:blackoutId', requireCapability('sites.write'), async (c) => {
    const user = c.get('user');
    const siteIdParam = c.req.param('id');
    const blackoutIdParam = c.req.param('blackoutId');

    const existing = await c.env.DB.prepare(
        `SELECT id FROM site_blackouts WHERE id = ? AND site_id = ?`,
    ).bind(blackoutIdParam, siteIdParam).first();
    if (!existing) return c.json({ error: 'Blackout not found' }, 404);

    await c.env.DB.prepare(`DELETE FROM site_blackouts WHERE id = ?`).bind(blackoutIdParam).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'site_blackout.deleted',
        targetType: 'site_blackout',
        targetId: blackoutIdParam,
        meta: { siteId: siteIdParam },
    });

    return c.json({ deleted: true });
});

export default adminSites;
