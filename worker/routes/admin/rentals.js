import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { rentalItemId, rentalAssignmentId } from '../../lib/ids.js';

const adminRentals = new Hono();
adminRentals.use('*', requireAuth);

const CATEGORIES = ['rifle', 'mask', 'vest', 'magazine', 'battery', 'other'];
const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'retired'];
const RETURN_CONDITIONS = ['good', 'fair', 'damaged', 'lost'];

function formatItem(r, openAssignment = null) {
    return {
        id: r.id,
        sku: r.sku,
        serialNumber: r.serial_number,
        name: r.name,
        category: r.category,
        condition: r.condition,
        purchaseDate: r.purchase_date,
        purchaseCostCents: r.purchase_cost_cents,
        notes: r.notes,
        active: !!r.active,
        createdAt: r.created_at,
        retiredAt: r.retired_at,
        status: openAssignment ? 'assigned' : (r.active ? 'available' : 'retired'),
        currentAssignment: openAssignment,
    };
}

function formatAssignment(r) {
    return {
        id: r.id,
        rentalItemId: r.rental_item_id,
        itemName: r.item_name,
        itemSku: r.item_sku,
        itemCategory: r.item_category,
        attendeeId: r.attendee_id,
        attendeeName: [r.first_name, r.last_name].filter(Boolean).join(' '),
        bookingId: r.booking_id,
        eventId: r.event_id,
        eventTitle: r.event_title,
        checkedOutAt: r.checked_out_at,
        checkedOutBy: r.checked_out_by,
        checkedInAt: r.checked_in_at,
        checkedInBy: r.checked_in_by,
        conditionOnReturn: r.condition_on_return,
        damageNotes: r.damage_notes,
        replacementFeeCents: r.replacement_fee_cents,
    };
}

// ───── Items ─────

// GET /api/admin/rentals/items
// Filters: category, status (available|assigned|retired), q (name/sku), includeRetired
adminRentals.get('/items', async (c) => {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q')?.trim();
    const includeRetired = url.searchParams.get('includeRetired') === '1';

    const clauses = [];
    const binds = [];
    if (!includeRetired) clauses.push(`ri.active = 1`);
    if (category && CATEGORIES.includes(category)) {
        clauses.push(`ri.category = ?`);
        binds.push(category);
    }
    if (q) {
        clauses.push(`(ri.name LIKE ? OR ri.sku LIKE ? OR ri.serial_number LIKE ?)`);
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT ri.* FROM rental_items ri ${where} ORDER BY ri.active DESC, ri.category, ri.name`
    ).bind(...binds).all();

    const items = rows.results || [];
    if (items.length === 0) return c.json({ items: [] });

    const placeholders = items.map(() => '?').join(',');
    const open = await c.env.DB.prepare(
        `SELECT ra.*, a.first_name, a.last_name
         FROM rental_assignments ra
         JOIN attendees a ON a.id = ra.attendee_id
         WHERE ra.checked_in_at IS NULL AND ra.rental_item_id IN (${placeholders})`
    ).bind(...items.map((i) => i.id)).all();

    const openByItem = {};
    for (const a of (open.results || [])) {
        openByItem[a.rental_item_id] = {
            id: a.id,
            attendeeId: a.attendee_id,
            attendeeName: [a.first_name, a.last_name].filter(Boolean).join(' '),
            checkedOutAt: a.checked_out_at,
        };
    }

    let formatted = items.map((i) => formatItem(i, openByItem[i.id] || null));
    if (status === 'available') formatted = formatted.filter((i) => i.status === 'available');
    else if (status === 'assigned') formatted = formatted.filter((i) => i.status === 'assigned');
    else if (status === 'retired') formatted = formatted.filter((i) => i.status === 'retired');

    return c.json({ items: formatted });
});

// GET /api/admin/rentals/items/:id — single item with full assignment history
adminRentals.get('/items/:id', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM rental_items WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: 'Item not found' }, 404);

    const history = await c.env.DB.prepare(
        `SELECT ra.*, a.first_name, a.last_name, b.event_id, e.title AS event_title
         FROM rental_assignments ra
         JOIN attendees a ON a.id = ra.attendee_id
         JOIN bookings b ON b.id = ra.booking_id
         LEFT JOIN events e ON e.id = b.event_id
         WHERE ra.rental_item_id = ?
         ORDER BY ra.checked_out_at DESC`
    ).bind(id).all();

    const open = (history.results || []).find((r) => !r.checked_in_at);
    return c.json({
        item: formatItem(row, open ? {
            id: open.id,
            attendeeId: open.attendee_id,
            attendeeName: [open.first_name, open.last_name].filter(Boolean).join(' '),
            checkedOutAt: open.checked_out_at,
        } : null),
        history: (history.results || []).map(formatAssignment),
    });
});

// POST /api/admin/rentals/items — create (manager+)
adminRentals.post('/items', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const { sku, serialNumber, name, category, condition, purchaseDate, purchaseCostCents, notes } = body;
    if (!sku || !name) return c.json({ error: 'SKU and name are required' }, 400);
    if (!CATEGORIES.includes(category)) return c.json({ error: `Category must be one of ${CATEGORIES.join(', ')}` }, 400);
    if (condition && !CONDITIONS.includes(condition)) return c.json({ error: `Condition must be one of ${CONDITIONS.join(', ')}` }, 400);

    const id = rentalItemId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO rental_items (id, sku, serial_number, name, category, condition, purchase_date, purchase_cost_cents, notes, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).bind(
        id,
        String(sku).trim(),
        serialNumber ? String(serialNumber).trim() : null,
        String(name).trim(),
        category,
        condition || 'good',
        purchaseDate || null,
        Number.isFinite(purchaseCostCents) ? purchaseCostCents : null,
        notes ? String(notes).trim() : null,
        now,
    ).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'rental_item.created', 'rental_item', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ sku, name, category }), now).run();

    const row = await c.env.DB.prepare(`SELECT * FROM rental_items WHERE id = ?`).bind(id).first();
    return c.json({ item: formatItem(row) }, 201);
});

// PUT /api/admin/rentals/items/:id — update (manager+)
adminRentals.put('/items/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM rental_items WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Item not found' }, 404);

    const fields = [];
    const binds = [];
    const patch = {};
    if (body.sku !== undefined) { fields.push('sku = ?'); binds.push(String(body.sku).trim()); patch.sku = body.sku; }
    if (body.serialNumber !== undefined) { fields.push('serial_number = ?'); binds.push(body.serialNumber ? String(body.serialNumber).trim() : null); }
    if (body.name !== undefined) { fields.push('name = ?'); binds.push(String(body.name).trim()); patch.name = body.name; }
    if (body.category !== undefined) {
        if (!CATEGORIES.includes(body.category)) return c.json({ error: 'Invalid category' }, 400);
        fields.push('category = ?'); binds.push(body.category);
    }
    if (body.condition !== undefined) {
        if (!CONDITIONS.includes(body.condition)) return c.json({ error: 'Invalid condition' }, 400);
        fields.push('condition = ?'); binds.push(body.condition);
    }
    if (body.purchaseDate !== undefined) { fields.push('purchase_date = ?'); binds.push(body.purchaseDate || null); }
    if (body.purchaseCostCents !== undefined) { fields.push('purchase_cost_cents = ?'); binds.push(Number.isFinite(body.purchaseCostCents) ? body.purchaseCostCents : null); }
    if (body.notes !== undefined) { fields.push('notes = ?'); binds.push(body.notes ? String(body.notes).trim() : null); }

    if (!fields.length) return c.json({ error: 'No changes' }, 400);
    binds.push(id);

    await c.env.DB.prepare(`UPDATE rental_items SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'rental_item.updated', 'rental_item', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify(patch), Date.now()).run();

    const row = await c.env.DB.prepare(`SELECT * FROM rental_items WHERE id = ?`).bind(id).first();
    const openRow = await c.env.DB.prepare(
        `SELECT ra.*, a.first_name, a.last_name FROM rental_assignments ra
         JOIN attendees a ON a.id = ra.attendee_id
         WHERE ra.rental_item_id = ? AND ra.checked_in_at IS NULL`
    ).bind(id).first();
    const open = openRow ? {
        id: openRow.id,
        attendeeId: openRow.attendee_id,
        attendeeName: [openRow.first_name, openRow.last_name].filter(Boolean).join(' '),
        checkedOutAt: openRow.checked_out_at,
    } : null;
    return c.json({ item: formatItem(row, open) });
});

// DELETE /api/admin/rentals/items/:id — retire (owner only)
adminRentals.delete('/items/:id', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT * FROM rental_items WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Item not found' }, 404);

    const open = await c.env.DB.prepare(
        `SELECT id FROM rental_assignments WHERE rental_item_id = ? AND checked_in_at IS NULL`
    ).bind(id).first();
    if (open) return c.json({ error: 'Cannot retire: item is currently checked out' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE rental_items SET active = 0, retired_at = ?, condition = 'retired' WHERE id = ?`
    ).bind(now, id).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'rental_item.retired', 'rental_item', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ name: existing.name, sku: existing.sku }), now).run();

    return c.json({ success: true });
});

// ───── Assignments ─────

// GET /api/admin/rentals/assignments
// Filters: status (open|closed|all default open), event_id, attendee_id, item_id
adminRentals.get('/assignments', async (c) => {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status') || 'open';
    const eventId = url.searchParams.get('event_id');
    const attendeeId = url.searchParams.get('attendee_id');
    const itemId = url.searchParams.get('item_id');

    const clauses = [];
    const binds = [];
    if (status === 'open') clauses.push(`ra.checked_in_at IS NULL`);
    else if (status === 'closed') clauses.push(`ra.checked_in_at IS NOT NULL`);
    if (eventId) { clauses.push(`b.event_id = ?`); binds.push(eventId); }
    if (attendeeId) { clauses.push(`ra.attendee_id = ?`); binds.push(attendeeId); }
    if (itemId) { clauses.push(`ra.rental_item_id = ?`); binds.push(itemId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT ra.*, ri.name AS item_name, ri.sku AS item_sku, ri.category AS item_category,
                a.first_name, a.last_name, b.event_id, e.title AS event_title
         FROM rental_assignments ra
         JOIN rental_items ri ON ri.id = ra.rental_item_id
         JOIN attendees a ON a.id = ra.attendee_id
         JOIN bookings b ON b.id = ra.booking_id
         LEFT JOIN events e ON e.id = b.event_id
         ${where}
         ORDER BY ra.checked_out_at DESC
         LIMIT 500`
    ).bind(...binds).all();

    return c.json({ assignments: (rows.results || []).map(formatAssignment) });
});

// POST /api/admin/rentals/assignments — assign an item to an attendee (staff+)
adminRentals.post('/assignments', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const { rentalItemId: itemId, attendeeId } = body;
    if (!itemId || !attendeeId) return c.json({ error: 'rentalItemId and attendeeId are required' }, 400);

    const item = await c.env.DB.prepare(`SELECT * FROM rental_items WHERE id = ?`).bind(itemId).first();
    if (!item) return c.json({ error: 'Item not found' }, 404);
    if (!item.active) return c.json({ error: 'Item is retired and cannot be assigned' }, 409);

    const attendee = await c.env.DB.prepare(`SELECT * FROM attendees WHERE id = ?`).bind(attendeeId).first();
    if (!attendee) return c.json({ error: 'Attendee not found' }, 404);

    const existingOpen = await c.env.DB.prepare(
        `SELECT id FROM rental_assignments WHERE rental_item_id = ? AND checked_in_at IS NULL`
    ).bind(itemId).first();
    if (existingOpen) return c.json({ error: 'Item is already assigned to another player' }, 409);

    const id = rentalAssignmentId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO rental_assignments (id, rental_item_id, attendee_id, booking_id, checked_out_at, checked_out_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, itemId, attendeeId, attendee.booking_id, now, user.id, now).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'rental.assigned', 'rental_assignment', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ item_id: itemId, attendee_id: attendeeId }), now).run();

    return c.json({ assignmentId: id, checkedOutAt: now }, 201);
});

// POST /api/admin/rentals/assignments/:id/return — mark returned (staff+)
adminRentals.post('/assignments/:id/return', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const condition = body.conditionOnReturn || 'good';
    if (!RETURN_CONDITIONS.includes(condition)) {
        return c.json({ error: `Condition must be one of ${RETURN_CONDITIONS.join(', ')}` }, 400);
    }

    const row = await c.env.DB.prepare(`SELECT * FROM rental_assignments WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: 'Assignment not found' }, 404);
    if (row.checked_in_at) return c.json({ error: 'Already returned' }, 409);

    const now = Date.now();
    const damageNotes = body.damageNotes ? String(body.damageNotes).trim() : null;
    const replacementFee = Number.isFinite(body.replacementFeeCents) ? body.replacementFeeCents : null;

    await c.env.DB.prepare(
        `UPDATE rental_assignments
         SET checked_in_at = ?, checked_in_by = ?, condition_on_return = ?, damage_notes = ?, replacement_fee_cents = ?
         WHERE id = ?`
    ).bind(now, user.id, condition, damageNotes, replacementFee, id).run();

    // If returned item is damaged or lost, update the item's condition
    if (condition === 'damaged') {
        await c.env.DB.prepare(`UPDATE rental_items SET condition = 'damaged' WHERE id = ?`).bind(row.rental_item_id).run();
    } else if (condition === 'lost') {
        await c.env.DB.prepare(`UPDATE rental_items SET active = 0, retired_at = ?, condition = 'retired' WHERE id = ?`)
            .bind(now, row.rental_item_id).run();
    }

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'rental.returned', 'rental_assignment', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ condition, damage_notes: damageNotes, fee: replacementFee }), now).run();

    return c.json({ success: true, checkedInAt: now });
});

// GET /api/admin/rentals/lookup/:token
// Generic scanner lookup: recognizes rental item tokens (ri_*) OR attendee qr_tokens.
// Used by the scan page so it can route to the right UI.
adminRentals.get('/lookup/:token', async (c) => {
    const token = c.req.param('token');
    if (token.startsWith('ri_')) {
        const row = await c.env.DB.prepare(`SELECT * FROM rental_items WHERE id = ?`).bind(token).first();
        if (!row) return c.json({ type: 'unknown' }, 404);
        const openRow = await c.env.DB.prepare(
            `SELECT ra.*, a.first_name, a.last_name
             FROM rental_assignments ra
             JOIN attendees a ON a.id = ra.attendee_id
             WHERE ra.rental_item_id = ? AND ra.checked_in_at IS NULL`
        ).bind(token).first();
        const open = openRow ? {
            id: openRow.id,
            attendeeId: openRow.attendee_id,
            attendeeName: [openRow.first_name, openRow.last_name].filter(Boolean).join(' '),
            checkedOutAt: openRow.checked_out_at,
        } : null;
        return c.json({ type: 'item', item: formatItem(row, open) });
    }
    // Fall back to attendee lookup
    const att = await c.env.DB.prepare(`SELECT id FROM attendees WHERE qr_token = ?`).bind(token).first();
    if (att) return c.json({ type: 'attendee', attendeeId: att.id, qrToken: token });
    return c.json({ type: 'unknown' }, 404);
});

export default adminRentals;
