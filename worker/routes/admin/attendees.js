import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { formatEvent } from '../../lib/formatters.js';
import { sendWaiverRequest } from '../../lib/emailSender.js';

const adminAttendees = new Hono();
adminAttendees.use('*', requireAuth);

// GET /api/admin/attendees/by-qr/:qrToken — scanner lookup
// Returns a full snapshot for the scan screen: attendee, booking, event,
// waiver status, and any open rental assignments.
adminAttendees.get('/by-qr/:qrToken', async (c) => {
    const qrToken = c.req.param('qrToken');
    const row = await c.env.DB.prepare(
        `SELECT a.*,
                b.id AS booking_id, b.status AS booking_status, b.event_id,
                b.full_name AS buyer_name, b.email AS buyer_email, b.phone AS buyer_phone,
                tt.name AS ticket_type_name,
                w.signed_at AS waiver_signed_at, w.is_minor
         FROM attendees a
         JOIN bookings b ON b.id = a.booking_id
         LEFT JOIN ticket_types tt ON tt.id = a.ticket_type_id
         LEFT JOIN waivers w ON w.id = a.waiver_id
         WHERE a.qr_token = ?`
    ).bind(qrToken).first();

    if (!row) return c.json({ error: 'QR code not recognized' }, 404);

    const eventRow = await c.env.DB.prepare(
        `SELECT * FROM events WHERE id = ?`
    ).bind(row.event_id).first();

    const assignments = await c.env.DB.prepare(
        `SELECT ra.*, ri.name AS item_name, ri.sku AS item_sku, ri.category AS item_category
         FROM rental_assignments ra
         JOIN rental_items ri ON ri.id = ra.rental_item_id
         WHERE ra.attendee_id = ?
         ORDER BY ra.checked_out_at DESC`
    ).bind(row.id).all();

    return c.json({
        attendee: {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email || row.buyer_email,
            phone: row.phone || row.buyer_phone,
            ticketType: row.ticket_type_name,
            qrToken: row.qr_token,
            checkedInAt: row.checked_in_at,
            waiverSigned: !!row.waiver_id,
            waiverSignedAt: row.waiver_signed_at,
            isMinor: !!row.is_minor,
            customAnswers: row.custom_answers_json ? JSON.parse(row.custom_answers_json) : {},
        },
        booking: {
            id: row.booking_id,
            status: row.booking_status,
            buyerName: row.buyer_name,
            buyerEmail: row.buyer_email,
            buyerPhone: row.buyer_phone,
        },
        event: eventRow ? formatEvent(eventRow) : null,
        rentalAssignments: (assignments.results || []).map((a) => ({
            id: a.id,
            rentalItemId: a.rental_item_id,
            itemName: a.item_name,
            itemSku: a.item_sku,
            itemCategory: a.item_category,
            checkedOutAt: a.checked_out_at,
            checkedInAt: a.checked_in_at,
            conditionOnReturn: a.condition_on_return,
            damageNotes: a.damage_notes,
            replacementFeeCents: a.replacement_fee_cents,
        })),
    });
});

// POST /api/admin/attendees/:id/check-in — mark attendee as checked in.
// Idempotent: if already checked in, returns the existing timestamp.
adminAttendees.post('/:id/check-in', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM attendees WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: 'Attendee not found' }, 404);
    if (row.checked_in_at) {
        return c.json({ attendee: { id, checkedInAt: row.checked_in_at }, alreadyCheckedIn: true });
    }
    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE attendees SET checked_in_at = ?, checked_in_by = ? WHERE id = ?`
    ).bind(now, user.id, id).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'attendee.checked_in', 'attendee', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ booking_id: row.booking_id }), now).run();

    return c.json({ attendee: { id, checkedInAt: now } });
});

// POST /api/admin/attendees/:id/check-out — undo a check-in (fat-finger recovery).
adminAttendees.post('/:id/check-out', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM attendees WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: 'Attendee not found' }, 404);
    if (!row.checked_in_at) return c.json({ error: 'Not checked in' }, 409);

    await c.env.DB.prepare(
        `UPDATE attendees SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?`
    ).bind(id).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'attendee.checked_out', 'attendee', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ booking_id: row.booking_id }), Date.now()).run();

    return c.json({ attendee: { id, checkedInAt: null } });
});

// PUT /api/admin/attendees/:id — edit name/email/phone
// Any field omitted from body is left unchanged. If the attendee has already
// signed a waiver, editing the name is allowed but logged — the waiver's
// stored signature is not mutated (it still reflects what the player typed).
adminAttendees.put('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM attendees WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Attendee not found' }, 404);

    const patch = {};
    if (body.firstName !== undefined) {
        const v = String(body.firstName).trim();
        if (!v) return c.json({ error: 'firstName cannot be empty' }, 400);
        patch.first_name = v;
    }
    if (body.lastName !== undefined) patch.last_name = body.lastName ? String(body.lastName).trim() : null;
    if (body.email !== undefined) patch.email = body.email ? String(body.email).trim() : null;
    if (body.phone !== undefined) patch.phone = body.phone ? String(body.phone).trim() : null;

    const keys = Object.keys(patch);
    if (!keys.length) return c.json({ error: 'No changes' }, 400);

    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE attendees SET ${sets} WHERE id = ?`).bind(...binds).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'attendee.updated', 'attendee', ?, ?, ?)`
    ).bind(
        user.id, id,
        JSON.stringify({
            fields: keys,
            waiver_signed: !!existing.waiver_id,
            booking_id: existing.booking_id,
        }),
        Date.now(),
    ).run();

    const row = await c.env.DB.prepare(`SELECT * FROM attendees WHERE id = ?`).bind(id).first();
    return c.json({
        attendee: {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email,
            phone: row.phone,
            waiverSigned: !!row.waiver_id,
        },
    });
});

// POST /api/admin/attendees/:id/send-waiver — email the waiver link to this attendee
adminAttendees.post('/:id/send-waiver', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
        `SELECT a.*, b.event_id, b.email AS buyer_email
         FROM attendees a JOIN bookings b ON b.id = a.booking_id
         WHERE a.id = ?`
    ).bind(id).first();
    if (!row) return c.json({ error: 'Attendee not found' }, 404);
    if (row.waiver_id) return c.json({ error: 'Waiver already signed' }, 409);

    const eventRow = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(row.event_id).first();
    if (!eventRow) return c.json({ error: 'Event not found' }, 404);

    // Fall back to buyer email if attendee has none
    const attendeeForEmail = { ...row, email: row.email || row.buyer_email };
    if (!attendeeForEmail.email) return c.json({ error: 'No email on file for this attendee' }, 400);

    try {
        const result = await sendWaiverRequest(c.env, { attendee: attendeeForEmail, event: eventRow });
        if (result?.skipped) return c.json({ error: `Not sent: ${result.skipped}` }, 500);
    } catch (err) {
        console.error('sendWaiverRequest failed', err);
        return c.json({ error: 'Email send failed' }, 502);
    }

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'waiver.resent', 'attendee', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ to: attendeeForEmail.email, booking_id: row.booking_id }), Date.now()).run();

    return c.json({ success: true, sentTo: attendeeForEmail.email });
});

export default adminAttendees;
