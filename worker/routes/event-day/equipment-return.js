// M5 R14 — Event-day equipment return endpoints (Surface 5).
//
// Mounted at /api/event-day/equipment-return. Routes:
//   POST  /lookup            — find a rental_assignment by qr/sku;
//                              returns assignment + linked attendee.
//                              Filters to active event_id (security).
//   POST  /:assignmentId/complete — mark the rental as returned;
//                                   record condition + notes. R14
//                                   only RECORDS the condition. The
//                                   M5 R16 damage-charge fast-path
//                                   creates booking_charges rows
//                                   when condition is damaged/lost.
//
// All endpoints gated by requireEventDayAuth.
//
// Schema: rental_assignments has condition_on_return CHECK constraint
// in ('good', 'fair', 'damaged', 'lost', NULL) — matches our enum.

import { Hono } from 'hono';
import {
    requireEventDayAuth,
    bumpActivityCounter,
} from '../../lib/eventDaySession.js';
import { writeAudit } from '../../lib/auditLog.js';

const eventDayEquipmentReturn = new Hono();
eventDayEquipmentReturn.use('*', requireEventDayAuth);

const CONDITIONS = new Set(['good', 'fair', 'damaged', 'lost']);
const CHARGE_REVIEW_CONDITIONS = new Set(['damaged', 'lost']);

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/equipment-return/lookup
// ────────────────────────────────────────────────────────────────────

eventDayEquipmentReturn.post('/lookup', async (c) => {
    const event = c.get('event');
    const body = await c.req.json().catch(() => ({}));
    const qrToken = String(body.qrToken || '').trim();
    if (!qrToken) return c.json({ error: 'qrToken required' }, 400);

    // Look up an active assignment by joining rental_items.qr_token /
    // rental_items.sku. Active = checked_in_at IS NULL (still out).
    const assignment = await c.env.DB.prepare(
        `SELECT ra.id, ra.rental_item_id, ra.attendee_id, ra.booking_id,
                ra.checked_out_at, ra.checked_in_at,
                ri.name AS item_name, ri.sku AS item_sku, ri.category AS item_category,
                a.first_name AS attendee_first, a.last_name AS attendee_last, a.qr_token AS attendee_qr,
                b.event_id, b.full_name AS buyer_name, b.email AS buyer_email
         FROM rental_assignments ra
         INNER JOIN rental_items ri ON ri.id = ra.rental_item_id
         INNER JOIN attendees a ON a.id = ra.attendee_id
         INNER JOIN bookings b ON b.id = ra.booking_id
         WHERE (ri.qr_token = ? OR ri.sku = ?)
           AND ra.checked_in_at IS NULL
         ORDER BY ra.checked_out_at DESC
         LIMIT 1`,
    ).bind(qrToken, qrToken).first();

    if (!assignment) return c.json({ error: 'assignment_not_found' }, 404);

    // Security: assignment's booking must belong to the active event.
    if (assignment.event_id !== event.id) {
        return c.json({
            error: 'wrong_event',
            assignmentEventId: assignment.event_id,
            activeEventId: event.id,
        }, 404);
    }

    return c.json({
        assignment: {
            id: assignment.id,
            rentalItemId: assignment.rental_item_id,
            attendeeId: assignment.attendee_id,
            bookingId: assignment.booking_id,
            checkedOutAt: assignment.checked_out_at,
            checkedInAt: assignment.checked_in_at,
        },
        item: {
            id: assignment.rental_item_id,
            name: assignment.item_name,
            sku: assignment.item_sku,
            category: assignment.item_category,
        },
        attendee: {
            id: assignment.attendee_id,
            firstName: assignment.attendee_first,
            lastName: assignment.attendee_last,
            fullName: [assignment.attendee_first, assignment.attendee_last].filter(Boolean).join(' '),
            qrToken: assignment.attendee_qr,
        },
        booking: {
            id: assignment.booking_id,
            buyerName: assignment.buyer_name,
            buyerEmail: assignment.buyer_email,
        },
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/equipment-return/:assignmentId/complete
// ────────────────────────────────────────────────────────────────────

eventDayEquipmentReturn.post('/:assignmentId/complete', async (c) => {
    const event = c.get('event');
    const session = c.get('eventDaySession');
    const person = c.get('person');
    const assignmentId = c.req.param('assignmentId');
    const body = await c.req.json().catch(() => ({}));

    const condition = String(body.condition || '').trim();
    const notes = body.notes ? String(body.notes).trim() : null;
    const replacementFeeCents = Number.isInteger(body.replacementFeeCents)
        ? body.replacementFeeCents
        : null;

    if (!CONDITIONS.has(condition)) {
        return c.json({ error: 'invalid_condition', allowed: [...CONDITIONS] }, 400);
    }

    // Look up + scope check.
    const assignment = await c.env.DB.prepare(
        `SELECT ra.id, ra.checked_in_at, ra.attendee_id, ra.booking_id, b.event_id
         FROM rental_assignments ra
         INNER JOIN bookings b ON b.id = ra.booking_id
         WHERE ra.id = ?`,
    ).bind(assignmentId).first();

    if (!assignment) return c.json({ error: 'assignment_not_found' }, 404);
    if (assignment.event_id !== event.id) return c.json({ error: 'wrong_event' }, 404);
    if (assignment.checked_in_at) return c.json({ error: 'already_returned' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE rental_assignments
         SET checked_in_at = ?,
             condition_on_return = ?,
             damage_notes = ?,
             replacement_fee_cents = ?
         WHERE id = ?`,
    ).bind(now, condition, notes, replacementFeeCents, assignmentId).run();

    await bumpActivityCounter(c.env, session.id, 'equipment_return');

    await writeAudit(c.env, {
        userId: null,
        action: 'event_day.equipment_returned',
        targetType: 'rental_assignment',
        targetId: assignmentId,
        meta: {
            condition,
            eventId: event.id,
            personId: person?.id || null,
            sessionId: session.id,
            attendeeId: assignment.attendee_id,
            bookingId: assignment.booking_id,
            replacementFeeCents,
            notes: notes || undefined,
        },
    });

    return c.json({
        ok: true,
        assignmentId,
        condition,
        // Caller (UI + R16's damage-charge flow) reads this flag to
        // decide whether to surface the charge-creation form. R14
        // only records the condition; R16 wires the charge.
        requiresChargeReview: CHARGE_REVIEW_CONDITIONS.has(condition),
    });
});

export default eventDayEquipmentReturn;
