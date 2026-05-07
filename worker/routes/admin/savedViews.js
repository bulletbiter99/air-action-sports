// M4 Batch 2a — admin saved-views route.
//
// Backs the rewritten useSavedViews hook (src/hooks/useSavedViews.js).
// Per-user, per-page filter/sort presets. Migrated from M2's localStorage
// backing to D1 (migration 0026_saved_views.sql) so views sync across
// devices.
//
// Endpoints (all requireAuth — no special capability; saved views are
// personal and the route enforces user_id ownership on all mutations):
//
//   GET    /?page=<page_key>            list calling user's views for the page
//   POST   /                             body: { pageKey, name, filters, sort? }
//                                        upserts by (user_id, page_key, name)
//   PUT    /:id                          body: { name }
//                                        rename; verifies user_id ownership
//   DELETE /:id                          delete; verifies user_id ownership
//
// Defensive: GET handles "no such table" gracefully (returns { views: [] })
// to cover the operator-applies-remote window between Worker deploy and
// `wrangler d1 migrations apply --remote`. POST/PUT/DELETE error normally
// so the operator notices the migration is unapplied.
//
// Mirrors the worker/lib/featureFlags.js pattern (M2 B5a) for table-missing
// handling.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';

const savedViews = new Hono();

savedViews.use('*', requireAuth);

function isTableMissingError(err) {
    if (!err || typeof err.message !== 'string') return false;
    return err.message.includes('no such table');
}

function newSavedViewId() {
    return `sv_${randomId(14)}`;
}

function formatRow(row) {
    return {
        id: row.id,
        pageKey: row.page_key,
        name: row.name,
        filters: safeParseJson(row.filter_json) ?? {},
        sort: safeParseJson(row.sort_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function safeParseJson(value) {
    if (value == null || value === '') return null;
    try { return JSON.parse(value); } catch { return null; }
}

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/saved-views?page=<page_key>
// ────────────────────────────────────────────────────────────────────
savedViews.get('/', async (c) => {
    const user = c.get('user');
    const url = new URL(c.req.url);
    const pageKey = url.searchParams.get('page');
    if (!pageKey) return c.json({ error: 'page query parameter is required' }, 400);

    let result;
    try {
        result = await c.env.DB.prepare(
            `SELECT id, user_id, page_key, name, filter_json, sort_json, created_at, updated_at
             FROM saved_views
             WHERE user_id = ? AND page_key = ?
             ORDER BY name`,
        ).bind(user.id, pageKey).all();
    } catch (err) {
        if (isTableMissingError(err)) return c.json({ views: [] });
        throw err;
    }

    return c.json({
        views: (result.results || []).map(formatRow),
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/saved-views
// Body: { pageKey, name, filters, sort? }
// Upserts by (user_id, page_key, name) — second POST with same name updates.
// ────────────────────────────────────────────────────────────────────
savedViews.post('/', async (c) => {
    const user = c.get('user');
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

    const pageKey = String(body.pageKey || '').trim();
    const name = String(body.name || '').trim();
    if (!pageKey) return c.json({ error: 'pageKey is required' }, 400);
    if (!name) return c.json({ error: 'name is required' }, 400);
    if (name.length > 80) return c.json({ error: 'name too long (max 80 chars)' }, 400);

    const filterJson = JSON.stringify(body.filters ?? {});
    const sortJson = body.sort != null ? JSON.stringify(body.sort) : null;
    const now = Date.now();

    // Upsert: delete-then-insert keeps updated_at semantics clean and
    // avoids needing INSERT OR REPLACE which would lose the prior id.
    const existing = await c.env.DB.prepare(
        `SELECT id FROM saved_views WHERE user_id = ? AND page_key = ? AND name = ?`,
    ).bind(user.id, pageKey, name).first();

    if (existing) {
        await c.env.DB.prepare(
            `UPDATE saved_views
             SET filter_json = ?, sort_json = ?, updated_at = ?
             WHERE id = ?`,
        ).bind(filterJson, sortJson, now, existing.id).run();
        return c.json({ id: existing.id, pageKey, name, filters: body.filters ?? {}, sort: body.sort ?? null, createdAt: existing.created_at ?? now, updatedAt: now });
    }

    const id = newSavedViewId();
    await c.env.DB.prepare(
        `INSERT INTO saved_views
            (id, user_id, page_key, name, filter_json, sort_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, pageKey, name, filterJson, sortJson, now, now).run();

    return c.json({
        id, pageKey, name, filters: body.filters ?? {}, sort: body.sort ?? null,
        createdAt: now, updatedAt: now,
    }, 201);
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/saved-views/:id — rename
// Body: { name }
// ────────────────────────────────────────────────────────────────────
savedViews.put('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

    const newName = String(body.name || '').trim();
    if (!newName) return c.json({ error: 'name is required' }, 400);
    if (newName.length > 80) return c.json({ error: 'name too long (max 80 chars)' }, 400);

    const existing = await c.env.DB.prepare(
        `SELECT id, user_id FROM saved_views WHERE id = ?`,
    ).bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

    await c.env.DB.prepare(
        `UPDATE saved_views SET name = ?, updated_at = ? WHERE id = ?`,
    ).bind(newName, Date.now(), id).run();

    return c.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// DELETE /api/admin/saved-views/:id
// ────────────────────────────────────────────────────────────────────
savedViews.delete('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare(
        `SELECT id, user_id FROM saved_views WHERE id = ?`,
    ).bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

    await c.env.DB.prepare(`DELETE FROM saved_views WHERE id = ?`).bind(id).run();

    return c.json({ ok: true });
});

export default savedViews;
