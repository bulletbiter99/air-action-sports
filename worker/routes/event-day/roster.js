// M5 R14 — Event-day roster lookup endpoint (Surface 5).
//
// Mounted at /api/event-day/roster. Single endpoint:
//   GET /     — list attendees for the active event-day session's
//               event. Optional ?q= substring filter on name/email.
//
// Active-event scoping is server-enforced (no event_id query/body
// override) — Lead Marshal at Event A cannot list Event B's roster.
// Mirrors /api/admin/events/:id/roster's response shape so the
// existing RosterLookup.jsx can swap with minimal edits, but uses
// portal-cookie auth + active-event scope rather than admin auth.

import { Hono } from 'hono';
import { requireEventDayAuth } from '../../lib/eventDaySession.js';

const eventDayRoster = new Hono();
eventDayRoster.use('*', requireEventDayAuth);

eventDayRoster.get('/', async (c) => {
    const event = c.get('event');
    const url = new URL(c.req.url);
    const q = (url.searchParams.get('q') || '').trim();

    // Mirror admin's roster query shape so RosterLookup.jsx receives
    // identical fields. Filters paid+comp bookings only (matches admin
    // convention — pending/abandoned attendees aren't on the roster).
    let sql = `SELECT a.id, a.first_name, a.last_name, a.email, a.phone, a.qr_token, a.checked_in_at, a.waiver_id,
                      b.id AS booking_id, b.status AS booking_status,
                      b.full_name AS buyer_name, b.email AS buyer_email,
                      tt.name AS ticket_type_name,
                      w.signed_at AS waiver_signed_at, w.is_minor AS waiver_is_minor
               FROM attendees a
               INNER JOIN bookings b ON b.id = a.booking_id
               LEFT JOIN ticket_types tt ON tt.id = a.ticket_type_id
               LEFT JOIN waivers w ON w.id = a.waiver_id
               WHERE b.event_id = ? AND b.status IN ('paid', 'comp')`;
    const args = [event.id];

    // Server-side substring filter on attendee first/last/email or
    // buyer name/email. Case-insensitive via LOWER() so SQLite's
    // default LIKE collation behaves consistently across drivers.
    if (q) {
        const needle = `%${q.toLowerCase()}%`;
        sql += ` AND (
            LOWER(a.first_name) LIKE ?
            OR LOWER(a.last_name) LIKE ?
            OR LOWER(a.email) LIKE ?
            OR LOWER(b.full_name) LIKE ?
            OR LOWER(b.email) LIKE ?
        )`;
        args.push(needle, needle, needle, needle, needle);
    }

    sql += ` ORDER BY b.created_at ASC, a.created_at ASC LIMIT 500`;

    const result = await c.env.DB.prepare(sql).bind(...args).all();

    const attendees = (result.results || []).map((a) => {
        const fullName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim();
        return {
            id: a.id,
            fullName: fullName || null,
            firstName: a.first_name,
            lastName: a.last_name,
            email: a.email || a.buyer_email || null,
            phone: a.phone || null,
            qrToken: a.qr_token,
            ticketType: a.ticket_type_name,
            checkedInAt: a.checked_in_at,
            waiverId: a.waiver_id,
            waiverSigned: !!a.waiver_id,
            waiverSignedAt: a.waiver_signed_at,
            isMinor: !!a.waiver_is_minor,
            bookingId: a.booking_id,
            bookingStatus: a.booking_status,
            buyerName: a.buyer_name,
        };
    });

    return c.json({
        eventId: event.id,
        attendees,
        count: attendees.length,
    });
});

export default eventDayRoster;
