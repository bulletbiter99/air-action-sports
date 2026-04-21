import { Hono } from 'hono';

const taxesFees = new Hono();

// Public: active taxes & fees only, for checkout quote display.
// Returns only safe fields (no description/sort_order internals).
taxesFees.get('/', async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT id, category, percent_bps, fixed_cents, per_unit, applies_to, sort_order
         FROM taxes_fees
         WHERE active = 1
         ORDER BY category, sort_order ASC`
    ).all();
    return c.json({ taxesFees: rows.results || [] });
});

export default taxesFees;
