import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';

const taxesFees = new Hono();
taxesFees.use('*', requireAuth);

function formatRow(r) {
    return {
        id: r.id,
        name: r.name,
        shortLabel: r.short_label,
        category: r.category,
        percentBps: r.percent_bps,
        percentDisplay: r.percent_bps ? `${(r.percent_bps / 100).toFixed(2)}%` : null,
        fixedCents: r.fixed_cents,
        fixedDisplay: r.fixed_cents ? `$${(r.fixed_cents / 100).toFixed(2)}` : null,
        perUnit: r.per_unit,
        appliesTo: r.applies_to,
        active: !!r.active,
        sortOrder: r.sort_order,
        description: r.description,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

taxesFees.get('/', async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT * FROM taxes_fees ORDER BY category, sort_order ASC`
    ).all();
    return c.json({ taxesFees: (rows.results || []).map(formatRow) });
});

taxesFees.post('/', requireRole('owner', 'manager'), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.name?.trim()) return c.json({ error: 'name required' }, 400);
    if (!['tax', 'fee'].includes(body.category)) return c.json({ error: 'category must be tax or fee' }, 400);
    if (!['all', 'tickets', 'addons'].includes(body.appliesTo || 'all')) return c.json({ error: 'invalid appliesTo' }, 400);
    if (!['booking', 'ticket', 'attendee'].includes(body.perUnit || 'booking')) return c.json({ error: 'invalid perUnit' }, 400);

    const id = `tf_${randomId(12)}`;
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO taxes_fees (id, name, short_label, category, percent_bps, fixed_cents, per_unit, applies_to, active, sort_order, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        body.name.trim(),
        body.shortLabel?.trim() || null,
        body.category,
        Math.max(0, Math.round(body.percentBps || 0)),
        Math.max(0, Math.round(body.fixedCents || 0)),
        body.perUnit || 'booking',
        body.appliesTo || 'all',
        body.active ? 1 : 0,
        Math.max(0, Math.round(body.sortOrder || 0)),
        body.description?.trim() || null,
        now, now,
    ).run();
    const row = await c.env.DB.prepare(`SELECT * FROM taxes_fees WHERE id = ?`).bind(id).first();
    return c.json({ taxFee: formatRow(row) });
});

taxesFees.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const existing = await c.env.DB.prepare(`SELECT * FROM taxes_fees WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const updates = [];
    const binds = [];
    const setIf = (k, col, val) => {
        if (val !== undefined) { updates.push(`${col} = ?`); binds.push(val); }
    };
    setIf('name',        'name',        body.name?.trim());
    setIf('shortLabel',  'short_label', body.shortLabel === undefined ? undefined : (body.shortLabel?.trim() || null));
    setIf('category',    'category',    body.category);
    setIf('percentBps',  'percent_bps', body.percentBps === undefined ? undefined : Math.max(0, Math.round(body.percentBps)));
    setIf('fixedCents',  'fixed_cents', body.fixedCents === undefined ? undefined : Math.max(0, Math.round(body.fixedCents)));
    setIf('perUnit',     'per_unit',    body.perUnit);
    setIf('appliesTo',   'applies_to',  body.appliesTo);
    setIf('active',      'active',      body.active === undefined ? undefined : (body.active ? 1 : 0));
    setIf('sortOrder',   'sort_order',  body.sortOrder === undefined ? undefined : Math.max(0, Math.round(body.sortOrder)));
    setIf('description', 'description', body.description === undefined ? undefined : (body.description?.trim() || null));

    if (updates.length === 0) return c.json({ taxFee: formatRow(existing) });

    updates.push('updated_at = ?');
    binds.push(Date.now());
    binds.push(id);

    await c.env.DB.prepare(
        `UPDATE taxes_fees SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    const row = await c.env.DB.prepare(`SELECT * FROM taxes_fees WHERE id = ?`).bind(id).first();
    return c.json({ taxFee: formatRow(row) });
});

taxesFees.delete('/:id', requireRole('owner'), async (c) => {
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM taxes_fees WHERE id = ?`).bind(id).run();
    return c.json({ ok: true });
});

export default taxesFees;
