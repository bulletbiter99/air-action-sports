import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { promoCodeDbId } from '../../lib/ids.js';

const adminPromoCodes = new Hono();
adminPromoCodes.use('*', requireAuth);

function formatPromo(row) {
    return {
        id: row.id,
        code: row.code,
        eventId: row.event_id,
        discountType: row.discount_type,
        discountValue: row.discount_value,
        maxUses: row.max_uses,
        usesCount: row.uses_count || 0,
        minOrderCents: row.min_order_cents,
        startsAt: row.starts_at,
        expiresAt: row.expires_at,
        appliesTo: row.applies_to_json ? JSON.parse(row.applies_to_json) : null,
        active: !!row.active,
        createdAt: row.created_at,
        createdBy: row.created_by,
    };
}

function parseBody(body, { partial = false } = {}) {
    const patch = {};
    if (body.code !== undefined) {
        const c = String(body.code).trim().toUpperCase();
        if (!/^[A-Z0-9_-]{2,32}$/.test(c)) return { error: 'Code must be 2–32 chars, A–Z / 0–9 / - / _' };
        patch.code = c;
    }
    if (body.eventId !== undefined) patch.event_id = body.eventId || null;
    if (body.discountType !== undefined) {
        if (!['percent', 'fixed'].includes(body.discountType)) return { error: "discountType must be 'percent' or 'fixed'" };
        patch.discount_type = body.discountType;
    }
    if (body.discountValue !== undefined) {
        const n = Number(body.discountValue);
        if (!Number.isFinite(n) || n <= 0) return { error: 'discountValue must be a positive number' };
        patch.discount_value = Math.round(n);
    }
    if (body.maxUses !== undefined) {
        if (body.maxUses === null || body.maxUses === '') patch.max_uses = null;
        else {
            const n = Number(body.maxUses);
            if (!Number.isFinite(n) || n < 1) return { error: 'maxUses must be ≥ 1' };
            patch.max_uses = Math.round(n);
        }
    }
    if (body.minOrderCents !== undefined) {
        if (body.minOrderCents === null || body.minOrderCents === '') patch.min_order_cents = null;
        else {
            const n = Number(body.minOrderCents);
            if (!Number.isFinite(n) || n < 0) return { error: 'minOrderCents must be ≥ 0' };
            patch.min_order_cents = Math.round(n);
        }
    }
    if (body.startsAt !== undefined) patch.starts_at = body.startsAt || null;
    if (body.expiresAt !== undefined) patch.expires_at = body.expiresAt || null;
    if (body.appliesTo !== undefined) {
        patch.applies_to_json = body.appliesTo ? JSON.stringify(body.appliesTo) : null;
    }
    if (body.active !== undefined) patch.active = body.active ? 1 : 0;

    if (!partial) {
        if (!patch.code) return { error: 'code is required' };
        if (!patch.discount_type) return { error: 'discountType is required' };
        if (patch.discount_value == null) return { error: 'discountValue is required' };
        if (patch.discount_type === 'percent' && patch.discount_value > 100) {
            return { error: 'percent discountValue cannot exceed 100' };
        }
    }
    return { patch };
}

// GET /api/admin/promo-codes — list (filters: active, event_id, q)
adminPromoCodes.get('/', async (c) => {
    const url = new URL(c.req.url);
    const active = url.searchParams.get('active'); // '1' | '0' | null
    const eventId = url.searchParams.get('event_id');
    const q = url.searchParams.get('q')?.trim();

    const clauses = [];
    const binds = [];
    if (active === '1') clauses.push(`active = 1`);
    else if (active === '0') clauses.push(`active = 0`);
    if (eventId) { clauses.push(`event_id = ?`); binds.push(eventId); }
    if (q) { clauses.push(`code LIKE ?`); binds.push(`%${q.toUpperCase()}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT * FROM promo_codes ${where} ORDER BY active DESC, created_at DESC`
    ).bind(...binds).all();
    return c.json({ promoCodes: (rows.results || []).map(formatPromo) });
});

// GET /api/admin/promo-codes/:id
adminPromoCodes.get('/:id', async (c) => {
    const row = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Promo code not found' }, 404);
    return c.json({ promoCode: formatPromo(row) });
});

// POST /api/admin/promo-codes — create (manager+)
adminPromoCodes.post('/', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const { patch, error } = parseBody(body, { partial: false });
    if (error) return c.json({ error }, 400);

    const dupe = await c.env.DB.prepare(`SELECT id FROM promo_codes WHERE code = ?`).bind(patch.code).first();
    if (dupe) return c.json({ error: 'Code already exists' }, 409);

    const id = promoCodeDbId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO promo_codes (
            id, code, event_id, discount_type, discount_value,
            max_uses, uses_count, min_order_cents, starts_at, expires_at,
            applies_to_json, active, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id, patch.code, patch.event_id ?? null, patch.discount_type, patch.discount_value,
        patch.max_uses ?? null, patch.min_order_cents ?? null,
        patch.starts_at ?? null, patch.expires_at ?? null,
        patch.applies_to_json ?? null, patch.active ?? 1, now, user.id,
    ).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'promo_code.created', 'promo_code', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ code: patch.code, type: patch.discount_type, value: patch.discount_value }), now).run();

    const row = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    return c.json({ promoCode: formatPromo(row) }, 201);
});

// PUT /api/admin/promo-codes/:id — update (manager+)
adminPromoCodes.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Promo code not found' }, 404);

    const { patch, error } = parseBody(body, { partial: true });
    if (error) return c.json({ error }, 400);

    if (patch.code && patch.code !== existing.code) {
        const dupe = await c.env.DB.prepare(`SELECT id FROM promo_codes WHERE code = ? AND id != ?`)
            .bind(patch.code, id).first();
        if (dupe) return c.json({ error: 'Code already exists' }, 409);
    }

    const keys = Object.keys(patch);
    if (!keys.length) return c.json({ error: 'No changes' }, 400);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE promo_codes SET ${sets} WHERE id = ?`).bind(...binds).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'promo_code.updated', 'promo_code', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ fields: keys }), Date.now()).run();

    const row = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    return c.json({ promoCode: formatPromo(row) });
});

// DELETE /api/admin/promo-codes/:id — deactivate if used, else delete (owner)
adminPromoCodes.delete('/:id', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Promo code not found' }, 404);

    const now = Date.now();
    if ((existing.uses_count || 0) > 0) {
        await c.env.DB.prepare(`UPDATE promo_codes SET active = 0 WHERE id = ?`).bind(id).run();
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, 'promo_code.deactivated', 'promo_code', ?, ?, ?)`
        ).bind(user.id, id, JSON.stringify({ reason: 'has_uses', uses: existing.uses_count }), now).run();
        return c.json({ deactivated: true });
    }
    await c.env.DB.prepare(`DELETE FROM promo_codes WHERE id = ?`).bind(id).run();
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'promo_code.deleted', 'promo_code', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ code: existing.code }), now).run();
    return c.json({ deleted: true });
});

export default adminPromoCodes;
