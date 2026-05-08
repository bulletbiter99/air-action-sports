// M5 R12 — Event-day session lifecycle endpoints (Surface 5).
//
// Mounted at /api/event-day/sessions. Routes:
//   POST   /start       — create an event_day_sessions row for the
//                         signed-in person + given eventId; sets the
//                         aas_event_day_session cookie. Validates that
//                         the caller is staffed for that event (joins
//                         event_staffing from M5 B9) and that the event
//                         is currently active.
//   POST   /heartbeat   — touch last_activity_at (used by the client to
//                         extend the soft 12-hour cookie lifetime).
//   POST   /end         — set signed_out_at and clear the cookie.
//   GET    /me          — return the active session shape (id, counters,
//                         signed_in_at, event_id).
//
// All routes other than /start require requireEventDayAuth (portal
// cookie + active event-day session + active event window). /start
// only requires the portal cookie because it is the bootstrap.

import { Hono } from 'hono';
import {
    parsePortalCookieHeader,
    verifyPortalCookie,
} from '../../lib/portalSession.js';
import {
    startEventDaySession,
    getActiveEventDaySession,
    endEventDaySession,
    touchActivity,
    requireEventDayAuth,
    setEventDayCookie,
    clearEventDayCookie,
    isEventActive,
} from '../../lib/eventDaySession.js';
import { writeAudit } from '../../lib/auditLog.js';

const eventDaySessions = new Hono();

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/sessions/start
// ────────────────────────────────────────────────────────────────────
eventDaySessions.post('/start', async (c) => {
    const cookieHeader = c.req.header('cookie');
    const portalCookieValue = parsePortalCookieHeader(cookieHeader);
    const portalSession = await verifyPortalCookie(portalCookieValue, c.env.SESSION_SECRET);
    if (!portalSession) return c.json({ error: 'Not authenticated' }, 401);

    const body = await c.req.json().catch(() => ({}));
    const eventId = body.eventId;
    if (!eventId) return c.json({ error: 'eventId required' }, 400);

    // Look up the portal_sessions row to get person_id.
    const portalRow = await c.env.DB.prepare(
        `SELECT id, person_id FROM portal_sessions WHERE id = ?`,
    ).bind(portalSession.psi).first();
    if (!portalRow) return c.json({ error: 'portal_session_not_found' }, 401);

    // Look up event row.
    const event = await c.env.DB.prepare(
        'SELECT id, title, date_iso, past FROM events WHERE id = ?',
    ).bind(eventId).first();
    if (!event) return c.json({ error: 'event_not_found' }, 404);

    if (!isEventActive(event, Date.now())) {
        return c.json({ error: 'event_not_active' }, 409);
    }

    // Ensure the caller is staffed for the event (event_staffing from
    // M5 B9). Bypass for owners is intentionally absent — even owners
    // sign in to event-day mode through an event_staffing row when
    // they're working a shift.
    const staffing = await c.env.DB.prepare(
        `SELECT id, rsvp FROM event_staffing
         WHERE event_id = ? AND person_id = ?
         LIMIT 1`,
    ).bind(eventId, portalRow.person_id).first();
    if (!staffing) {
        return c.json({ error: 'not_staffed_for_event' }, 403);
    }

    // If a session is already active for this person+event, return that
    // one rather than creating a duplicate. The unique constraint on
    // the table is (event_id, person_id, signed_in_at) so technically
    // we could create another, but the operating model is one active
    // session per person per event.
    const existing = await getActiveEventDaySession(c.env, {
        portalSessionId: portalSession.psi,
        eventId,
    });
    if (existing) {
        return c.json({
            ok: true,
            sessionId: existing.id,
            event: { id: event.id, title: event.title },
            reused: true,
        }, 200, { 'Set-Cookie': setEventDayCookie(existing.id) });
    }

    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
    const userAgent = c.req.header('user-agent') || null;
    const { id, signedInAt } = await startEventDaySession(c.env, {
        portalSessionId: portalSession.psi,
        eventId,
        personId: portalRow.person_id,
        ipAddress,
        userAgent,
    });

    await writeAudit(c.env, {
        userId: null,
        action: 'event_day.session_started',
        targetType: 'event_day_session',
        targetId: id,
        meta: { eventId, personId: portalRow.person_id, signedInAt },
    });

    return c.json(
        {
            ok: true,
            sessionId: id,
            event: { id: event.id, title: event.title },
            signedInAt,
        },
        200,
        { 'Set-Cookie': setEventDayCookie(id) },
    );
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/sessions/heartbeat
// ────────────────────────────────────────────────────────────────────
eventDaySessions.post('/heartbeat', requireEventDayAuth, async (c) => {
    const session = c.get('eventDaySession');
    const result = await touchActivity(c.env, session.id);
    return c.json({ ok: true, ...result });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/sessions/end
// ────────────────────────────────────────────────────────────────────
eventDaySessions.post('/end', requireEventDayAuth, async (c) => {
    const session = c.get('eventDaySession');
    const result = await endEventDaySession(c.env, session.id, { reason: 'manual_signout' });
    return c.json(result, 200, { 'Set-Cookie': clearEventDayCookie() });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/event-day/sessions/me
// ────────────────────────────────────────────────────────────────────
eventDaySessions.get('/me', requireEventDayAuth, (c) => {
    const session = c.get('eventDaySession');
    const event = c.get('event');
    const person = c.get('person');
    return c.json({
        sessionId: session.id,
        eventId: session.event_id,
        personId: session.person_id,
        person: { id: person?.id, fullName: person?.full_name, email: person?.email },
        event: { id: event.id, dateIso: event.date_iso },
        signedInAt: session.signed_in_at,
        lastActivityAt: session.last_activity_at,
        counters: {
            checkinsPerformed: session.checkins_performed,
            walkupsCreated: session.walkups_created,
            incidentsFiled: session.incidents_filed,
            equipmentReturns: session.equipment_returns,
        },
    });
});

export default eventDaySessions;
