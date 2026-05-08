// M5 R16 — Event-day damage-charge endpoint (Surface 5).
//
// Mounted at /api/event-day/damage-charge. Single endpoint:
//   POST /  — Lead Marshal creates a charge linked to a rental_assignment
//             that R14's EquipmentReturn flow recorded as damaged/lost.
//             Within-cap charges immediately email the customer; above-
//             cap charges enter the admin review queue.
//
// Gated by R12's requireEventDayAuth + active-event scope check.

import { Hono } from 'hono';
import { requireEventDayAuth } from '../../lib/eventDaySession.js';
import {
    REASON_KINDS,
    createDamageCharge,
    getChargeCapForPerson,
} from '../../lib/bookingCharges.js';

const eventDayDamageCharge = new Hono();
eventDayDamageCharge.use('*', requireEventDayAuth);

eventDayDamageCharge.post('/', async (c) => {
    const event = c.get('event');
    const session = c.get('eventDaySession');
    const person = c.get('person');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const assignmentId = String(body.assignmentId || '').trim();
    const reasonKind = String(body.reasonKind || '').trim();
    const amountCents = Number.isFinite(Number(body.amountCents)) ? Math.round(Number(body.amountCents)) : null;
    const description = body.description ? String(body.description).trim() : null;

    if (!assignmentId) return c.json({ error: 'assignment_id_required' }, 400);
    if (!REASON_KINDS.includes(reasonKind)) {
        return c.json({ error: 'invalid_reason_kind', allowed: [...REASON_KINDS] }, 400);
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        return c.json({ error: 'amount_required', message: 'amountCents must be a positive integer' }, 400);
    }

    // Look up assignment + scope check.
    const assignment = await c.env.DB.prepare(
        `SELECT ra.id, ra.attendee_id, ra.booking_id, ra.condition_on_return, ra.checked_in_at,
                b.event_id
         FROM rental_assignments ra
         INNER JOIN bookings b ON b.id = ra.booking_id
         WHERE ra.id = ?`,
    ).bind(assignmentId).first();

    if (!assignment) return c.json({ error: 'assignment_not_found' }, 404);
    if (assignment.event_id !== event.id) {
        return c.json({ error: 'wrong_event', activeEventId: event.id }, 404);
    }
    // R14 must have recorded the return + damaged/lost condition before
    // the charge is created. R14's POST /complete handler records both.
    if (!assignment.checked_in_at) return c.json({ error: 'not_returned' }, 409);
    if (!['damaged', 'lost'].includes(assignment.condition_on_return)) {
        return c.json({
            error: 'condition_not_chargeable',
            currentCondition: assignment.condition_on_return,
            chargeable: ['damaged', 'lost'],
        }, 409);
    }

    // Resolve the operator's role cap for the approval gate.
    const operatorRoleCap = await getChargeCapForPerson(c.env, person?.id);

    const result = await createDamageCharge(c.env, {
        assignmentId,
        bookingId: assignment.booking_id,
        attendeeId: assignment.attendee_id,
        eventId: event.id,
        reasonKind,
        amountCents,
        description,
        operatorPersonId: person?.id || null,
        operatorRoleCap,
        sessionId: session.id,
    });

    return c.json({
        ok: true,
        chargeId: result.id,
        status: result.status,
        approvalRequired: result.approvalRequired,
        operatorRoleCap,
    });
});

export default eventDayDamageCharge;
