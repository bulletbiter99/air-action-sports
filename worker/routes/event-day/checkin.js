// M5 R13 — Event-day check-in endpoints (Surface 5).
//
// Mounted at /api/event-day/checkin. Routes:
//   POST  /by-qr          — look up an attendee by qr_token; verifies the
//                           attendee's event_id matches the active session's
//                           event (security: Lead Marshal at Event A cannot
//                           check in Event B's attendees)
//   POST  /:attendeeId    — check the attendee in. Idempotent. Waiver-block:
//                           if attendee.waiver_id IS NULL and the body
//                           does not pass `bypassWaiver: true`, returns 409
//                           with `canBypass` reflecting the caller's role.
//                           Bypass is gated on the person being a
//                           lead_marshal or event_director (capability
//                           `event_day.checkin.bypass_waiver` per M5 prompt).
//   POST  /:attendeeId/check-out — undo a check-in (fat-finger recovery;
//                           mirrors admin behavior).
//
// All routes are gated by requireEventDayAuth (R12 lib).

import { Hono } from 'hono';
import {
    requireEventDayAuth,
    bumpActivityCounter,
} from '../../lib/eventDaySession.js';
import { writeAudit } from '../../lib/auditLog.js';

const eventDayCheckin = new Hono();
eventDayCheckin.use('*', requireEventDayAuth);

// ────────────────────────────────────────────────────────────────────
// Internal: capability — bypass missing waiver
// ────────────────────────────────────────────────────────────────────

// Allow-list for the M5 prompt's `event_day.checkin.bypass_waiver`
// capability. Hardcoded against role.key while persons do not have a
// role_preset_key column. Future M5 follow-up may move to a real
// person-capability table; the route's interface (canBypass shape)
// stays stable.
const BYPASS_WAIVER_ROLES = new Set(['lead_marshal', 'event_director']);

/**
 * Returns true iff the person has at least one current (effective_to IS
 * NULL) role assignment whose role.key is in BYPASS_WAIVER_ROLES.
 */
async function personCanBypassWaiver(env, personId) {
    if (!personId) return false;
    const result = await env.DB.prepare(
        `SELECT r.key
         FROM person_roles pr
         INNER JOIN roles r ON r.id = pr.role_id
         WHERE pr.person_id = ?
           AND pr.effective_to IS NULL`,
    ).bind(personId).all();
    for (const row of (result.results || [])) {
        if (BYPASS_WAIVER_ROLES.has(row.key)) return true;
    }
    return false;
}

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checkin/by-qr
// ────────────────────────────────────────────────────────────────────

eventDayCheckin.post('/by-qr', async (c) => {
    const event = c.get('event');
    const body = await c.req.json().catch(() => ({}));
    const qrToken = String(body.qrToken || '').trim();
    if (!qrToken) return c.json({ error: 'qrToken required' }, 400);

    const row = await c.env.DB.prepare(
        `SELECT a.*,
                b.id AS booking_id, b.status AS booking_status, b.event_id,
                b.full_name AS buyer_name, b.email AS buyer_email,
                tt.name AS ticket_type_name,
                w.signed_at AS waiver_signed_at, w.is_minor AS waiver_is_minor
         FROM attendees a
         INNER JOIN bookings b ON b.id = a.booking_id
         LEFT JOIN ticket_types tt ON tt.id = a.ticket_type_id
         LEFT JOIN waivers w ON w.id = a.waiver_id
         WHERE a.qr_token = ?`,
    ).bind(qrToken).first();

    if (!row) return c.json({ error: 'qr_not_recognized' }, 404);

    // Security: attendee must belong to the active event-day session's event.
    if (row.event_id !== event.id) {
        return c.json({
            error: 'wrong_event',
            attendeeEventId: row.event_id,
            activeEventId: event.id,
        }, 404);
    }

    const person = c.get('person');
    const canBypass = await personCanBypassWaiver(c.env, person?.id);

    return c.json({
        attendee: {
            id: row.id,
            qrToken: row.qr_token,
            firstName: row.first_name,
            lastName: row.last_name,
            fullName: [row.first_name, row.last_name].filter(Boolean).join(' '),
            ticketTypeId: row.ticket_type_id,
            ticketTypeName: row.ticket_type_name,
            checkedInAt: row.checked_in_at,
            waiverId: row.waiver_id,
            waiverSignedAt: row.waiver_signed_at,
            waiverIsMinor: row.waiver_is_minor,
        },
        booking: {
            id: row.booking_id,
            status: row.booking_status,
            eventId: row.event_id,
            buyerName: row.buyer_name,
            buyerEmail: row.buyer_email,
        },
        canBypass,
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checkin/:attendeeId
// ────────────────────────────────────────────────────────────────────

eventDayCheckin.post('/:attendeeId', async (c) => {
    const event = c.get('event');
    const session = c.get('eventDaySession');
    const person = c.get('person');
    const attendeeId = c.req.param('attendeeId');
    const body = await c.req.json().catch(() => ({}));

    const row = await c.env.DB.prepare(
        'SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees WHERE id = ?',
    ).bind(attendeeId).first();

    if (!row) return c.json({ error: 'attendee_not_found' }, 404);

    // Security: attendee must belong to the active event.
    if (row.event_id && row.event_id !== event.id) {
        return c.json({ error: 'wrong_event' }, 404);
    }
    // attendees.event_id may be null pre-M3; fall back to bookings.event_id
    if (!row.event_id) {
        const booking = await c.env.DB.prepare(
            'SELECT event_id FROM bookings WHERE id = ?',
        ).bind(row.booking_id).first();
        if (booking?.event_id !== event.id) return c.json({ error: 'wrong_event' }, 404);
    }

    // Idempotent: already checked in returns the existing timestamp.
    if (row.checked_in_at) {
        return c.json({
            attendee: { id: row.id, checkedInAt: row.checked_in_at },
            alreadyCheckedIn: true,
        });
    }

    // Waiver-block enforcement.
    const bypassRequested = body.bypassWaiver === true;
    const bypassReason = String(body.bypassReason || '').trim();
    if (!row.waiver_id) {
        const canBypass = await personCanBypassWaiver(c.env, person?.id);
        if (!bypassRequested) {
            return c.json({ error: 'waiver_required', canBypass }, 409);
        }
        if (!canBypass) {
            return c.json({ error: 'forbidden_bypass', requiresCapability: 'event_day.checkin.bypass_waiver' }, 403);
        }
        if (!bypassReason) {
            return c.json({ error: 'bypass_reason_required' }, 400);
        }
    }

    const now = Date.now();
    await c.env.DB.prepare(
        'UPDATE attendees SET checked_in_at = ?, checked_in_by = ? WHERE id = ?',
    ).bind(now, person?.id || null, attendeeId).run();

    await bumpActivityCounter(c.env, session.id, 'checkin');

    // Distinct audit action for bypass vs normal so investigators can
    // filter the audit log on bypasses specifically.
    if (!row.waiver_id && bypassRequested) {
        await writeAudit(c.env, {
            userId: null,
            action: 'event_day.checkin_bypass_waiver',
            targetType: 'attendee',
            targetId: attendeeId,
            meta: {
                reason: bypassReason,
                personId: person?.id || null,
                eventId: event.id,
                sessionId: session.id,
            },
        });
    } else {
        await writeAudit(c.env, {
            userId: null,
            action: 'event_day.attendee_checked_in',
            targetType: 'attendee',
            targetId: attendeeId,
            meta: {
                personId: person?.id || null,
                eventId: event.id,
                sessionId: session.id,
            },
        });
    }

    return c.json({
        attendee: { id: attendeeId, checkedInAt: now },
        bypassed: !row.waiver_id && bypassRequested,
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checkin/:attendeeId/check-out
// ────────────────────────────────────────────────────────────────────
//
// Fat-finger recovery for accidentally-checked-in attendees. Mirrors
// admin behavior — does NOT decrement the event_day_sessions counter
// (counters are write-once for the day's audit shape; reverting check-in
// is the rare exception and recorded as its own audit action).

eventDayCheckin.post('/:attendeeId/check-out', async (c) => {
    const event = c.get('event');
    const session = c.get('eventDaySession');
    const person = c.get('person');
    const attendeeId = c.req.param('attendeeId');

    const row = await c.env.DB.prepare(
        'SELECT id, event_id, booking_id, checked_in_at FROM attendees WHERE id = ?',
    ).bind(attendeeId).first();

    if (!row) return c.json({ error: 'attendee_not_found' }, 404);
    if (row.event_id && row.event_id !== event.id) return c.json({ error: 'wrong_event' }, 404);
    if (!row.checked_in_at) return c.json({ error: 'not_checked_in' }, 409);

    await c.env.DB.prepare(
        'UPDATE attendees SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?',
    ).bind(attendeeId).run();

    await writeAudit(c.env, {
        userId: null,
        action: 'event_day.attendee_checked_out',
        targetType: 'attendee',
        targetId: attendeeId,
        meta: {
            personId: person?.id || null,
            eventId: event.id,
            sessionId: session.id,
        },
    });

    return c.json({ attendee: { id: attendeeId, checkedInAt: null } });
});

export default eventDayCheckin;
