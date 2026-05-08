// M5 R12 — Event-day session helpers + Hono middleware (Surface 5).
//
// "Same magic-link mechanism as portal but scoped to event window" per
// the original M5 prompt. The portal cookie machinery in worker/lib/
// portalSession.js handles authentication; this module layers
// event-window enforcement on top, and writes the event_day_sessions
// audit row that migration 0037 introduced.
//
// Design:
//   - Tier-3 staff already have a portal magic-link from M5 B6 (or
//     receive one as part of being staffed for an event).
//   - When they enter event-day mode for a specific event, the client
//     POSTs /api/event-day/sessions/start. That insert creates an
//     event_day_sessions row keyed on (event_id, person_id, signed_in_at).
//   - All event-day endpoints (R13 check-in, R14 incident/roster/
//     equipment, R15 checklists, R16 damage charge) gate on
//     requireEventDayAuth. The middleware:
//       1. Verifies the portal cookie (delegates to portalSession.js)
//       2. Loads the event_day_sessions row by id (header or query)
//       3. Loads the linked events row
//       4. Enforces isEventActive(event, now) — auto-ends the session
//          and returns 401 with `event_window_closed` if the event is
//          past.
//
// Counters (checkins_performed / walkups_created / incidents_filed /
// equipment_returns) are denormalized on event_day_sessions for the HQ
// dashboard's per-staffer activity column. R13/R14/R16 routes call
// bumpActivityCounter to increment them.

import {
    parsePortalCookieHeader,
    verifyPortalCookie,
} from './portalSession.js';
import { writeAudit } from './auditLog.js';

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

// Event-day window: from 00:00 UTC of the event date to +30 hours.
// 30 hours covers same-UTC-day plus a 6-hour grace for post-event
// teardown spilling past midnight. Events that haven't been parsed
// down to wall-clock time strings still fit (audit pain-point #M4 noted
// time-string parsing was deferred).
export const EVENT_DAY_WINDOW_MS = 30 * 60 * 60 * 1000;

// Allowed values for bumpActivityCounter — bound to the 4 columns the
// migration 0037 schema declares.
export const ACTIVITY_KINDS = Object.freeze([
    'checkin',          // → checkins_performed
    'walkup',           // → walkups_created
    'incident',         // → incidents_filed
    'equipment_return', // → equipment_returns
]);

const COUNTER_COLUMN = {
    checkin: 'checkins_performed',
    walkup: 'walkups_created',
    incident: 'incidents_filed',
    equipment_return: 'equipment_returns',
};

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Generates a fresh event-day session id matching the migration 0037
 * shape: `eds_<12-char alphanumeric>`. Crypto-random — same primitive
 * as portalSession's mintInviteToken / writeAudit ids.
 */
export function randomEventDaySessionId() {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `eds_${out}`;
}

/**
 * True iff `now` falls within the event's active window.
 *
 * Defaults:
 *   - `event.past = 1` → always inactive (admin override).
 *   - `event.date_iso` parsed as YYYY-MM-DD at 00:00 UTC.
 *   - Window = [eventStart, eventStart + EVENT_DAY_WINDOW_MS].
 *
 * Future enhancement: parse `event.check_in` / `event.end_time` when
 * those become tz-aware instants (deferred per M4 audit).
 *
 * @param {object} event - row from `events` (date_iso, past)
 * @param {number} now - epoch ms
 * @returns {boolean}
 */
export function isEventActive(event, now = Date.now()) {
    if (!event || !event.date_iso) return false;
    if (event.past) return false;
    const eventStart = Date.parse(`${event.date_iso}T00:00:00Z`);
    if (Number.isNaN(eventStart)) return false;
    return now >= eventStart && now <= eventStart + EVENT_DAY_WINDOW_MS;
}

/**
 * Companion: returns true iff the event is past its event-day window.
 * Used by requireEventDayAuth to decide whether to auto-end the session.
 */
export function eventDayWindowExpired(event, now = Date.now()) {
    if (!event || !event.date_iso) return true;
    if (event.past) return true;
    const eventStart = Date.parse(`${event.date_iso}T00:00:00Z`);
    if (Number.isNaN(eventStart)) return true;
    return now > eventStart + EVENT_DAY_WINDOW_MS;
}

// ────────────────────────────────────────────────────────────────────
// I/O wrappers
// ────────────────────────────────────────────────────────────────────

/**
 * Inserts an event_day_sessions row. The migration's UNIQUE constraint
 * (event_id, person_id, signed_in_at) prevents duplicates only by exact
 * timestamp; callers should call getActiveEventDaySession first to
 * avoid creating a parallel session for the same person+event.
 *
 * @returns {Promise<{id: string, signedInAt: number}>}
 */
export async function startEventDaySession(env, opts) {
    const { portalSessionId, eventId, personId, ipAddress, userAgent } = opts;
    if (!eventId) throw new Error('startEventDaySession: eventId required');
    if (!personId) throw new Error('startEventDaySession: personId required');

    const id = randomEventDaySessionId();
    const now = Date.now();
    await env.DB.prepare(
        `INSERT INTO event_day_sessions (
            id, event_id, person_id, portal_session_id,
            checkins_performed, walkups_created, incidents_filed, equipment_returns,
            signed_in_at, last_activity_at, signed_out_at,
            ip_address, user_agent, created_at
         ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, NULL, ?, ?, ?)`,
    ).bind(
        id, eventId, personId, portalSessionId || null,
        now, now,
        ipAddress || null, userAgent || null, now,
    ).run();

    return { id, signedInAt: now };
}

/**
 * Returns the active session row for a (portal, event) pair — the one
 * with signed_out_at IS NULL. Returns null if no active session exists.
 */
export async function getActiveEventDaySession(env, { portalSessionId, eventId }) {
    if (!portalSessionId || !eventId) return null;
    return env.DB.prepare(
        `SELECT * FROM event_day_sessions
         WHERE portal_session_id = ? AND event_id = ? AND signed_out_at IS NULL
         ORDER BY signed_in_at DESC
         LIMIT 1`,
    ).bind(portalSessionId, eventId).first();
}

/**
 * Returns a session row by id (any state — caller decides).
 */
export async function getEventDaySessionById(env, id) {
    if (!id) return null;
    return env.DB.prepare(
        'SELECT * FROM event_day_sessions WHERE id = ?',
    ).bind(id).first();
}

/**
 * UPDATEs signed_out_at + writes an audit row. `reason` is bound
 * positionally (lessons-learned #3) so route + middleware tests can
 * assert via writeLog inspection.
 */
export async function endEventDaySession(env, sessionId, opts = {}) {
    const { reason = 'manual_signout', userId = null } = opts;
    const now = Date.now();
    await env.DB.prepare(
        'UPDATE event_day_sessions SET signed_out_at = ?, last_activity_at = ? WHERE id = ?',
    ).bind(now, now, sessionId).run();

    await writeAudit(env, {
        userId,
        action: 'event_day.session_ended',
        targetType: 'event_day_session',
        targetId: sessionId,
        meta: { reason },
    });

    return { ok: true, signedOutAt: now };
}

/**
 * Increments one of the 4 activity counters AND touches last_activity_at.
 * `kind` is validated against ACTIVITY_KINDS — anything else throws.
 *
 * @param {object} env
 * @param {string} sessionId
 * @param {'checkin'|'walkup'|'incident'|'equipment_return'} kind
 */
export async function bumpActivityCounter(env, sessionId, kind) {
    if (!ACTIVITY_KINDS.includes(kind)) {
        throw new Error(`bumpActivityCounter: unknown kind "${kind}"`);
    }
    const column = COUNTER_COLUMN[kind];
    const now = Date.now();
    // Column name is from the constant table — safe to interpolate. The
    // dynamic value (sessionId) is bound, not interpolated.
    await env.DB.prepare(
        `UPDATE event_day_sessions
         SET ${column} = ${column} + 1, last_activity_at = ?
         WHERE id = ?`,
    ).bind(now, sessionId).run();
    return { ok: true };
}

/**
 * UPDATE last_activity_at (heartbeat).
 */
export async function touchActivity(env, sessionId) {
    const now = Date.now();
    await env.DB.prepare(
        'UPDATE event_day_sessions SET last_activity_at = ? WHERE id = ?',
    ).bind(now, sessionId).run();
    return { lastActivityAt: now };
}

// ────────────────────────────────────────────────────────────────────
// Hono middleware
// ────────────────────────────────────────────────────────────────────

/**
 * Hono middleware that gates an event-day route on:
 *   1. Valid portal cookie (verified against SESSION_SECRET)
 *   2. An event_day_sessions row id supplied via either:
 *        - X-Event-Day-Session header
 *        - cookie value `aas_event_day_session`
 *   3. The session is not yet ended (signed_out_at IS NULL)
 *   4. The linked event is currently within its event-day window
 *      (isEventActive). If past — auto-ends the session, returns 401
 *      with `{ error: 'event_window_closed' }`.
 *
 * On success, sets `c.set('eventDaySession', row)` and
 * `c.set('person', { id, full_name?, email? })` so downstream handlers
 * can assume both present.
 */
export async function requireEventDayAuth(c, next) {
    const cookieHeader = c.req.header('cookie');
    const portalCookieValue = parsePortalCookieHeader(cookieHeader);
    const portalSession = await verifyPortalCookie(portalCookieValue, c.env.SESSION_SECRET);
    if (!portalSession) return c.json({ error: 'Not authenticated' }, 401);

    const sessionId = c.req.header('x-event-day-session') || parseEventDayCookie(cookieHeader);
    if (!sessionId) return c.json({ error: 'event_day_session_required' }, 401);

    const session = await getEventDaySessionById(c.env, sessionId);
    if (!session) return c.json({ error: 'event_day_session_not_found' }, 401);
    if (session.portal_session_id !== portalSession.psi) {
        return c.json({ error: 'event_day_session_mismatch' }, 401);
    }
    if (session.signed_out_at) {
        return c.json({ error: 'event_day_session_ended' }, 401);
    }

    const event = await c.env.DB.prepare(
        'SELECT id, date_iso, past FROM events WHERE id = ?',
    ).bind(session.event_id).first();
    if (!event) return c.json({ error: 'event_not_found' }, 404);

    const now = Date.now();
    if (eventDayWindowExpired(event, now)) {
        // Auto-end the session so subsequent requests don't keep paying
        // the lookup cost. The user must restart for a different event.
        await endEventDaySession(c.env, sessionId, { reason: 'event_window_closed' }).catch(() => {});
        return c.json({ error: 'event_window_closed' }, 401);
    }
    if (!isEventActive(event, now)) {
        return c.json({ error: 'event_not_active_yet' }, 401);
    }

    c.set('eventDaySession', session);
    c.set('event', event);
    // The person link is via the persons row joined through the session.
    const person = await c.env.DB.prepare(
        'SELECT id, full_name, email FROM persons WHERE id = ?',
    ).bind(session.person_id).first();
    c.set('person', person || { id: session.person_id });
    await next();
}

// ────────────────────────────────────────────────────────────────────
// Cookie helper (for the optional aas_event_day_session client cookie)
// ────────────────────────────────────────────────────────────────────

const EVENT_DAY_COOKIE_NAME = 'aas_event_day_session';

export function parseEventDayCookie(header) {
    if (!header) return null;
    const parts = header.split(';').map((p) => p.trim());
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq === -1) continue;
        if (p.slice(0, eq) === EVENT_DAY_COOKIE_NAME) return p.slice(eq + 1) || null;
    }
    return null;
}

export function setEventDayCookie(sessionId) {
    // Session ends when either the event window closes (auto-ended in
    // requireEventDayAuth) or the user signs out. The cookie itself
    // expires in 12 hours — a soft cap that aligns with EVENT_DAY_WINDOW_MS.
    return `${EVENT_DAY_COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/api/event-day; Max-Age=${12 * 60 * 60}`;
}

export function clearEventDayCookie() {
    return `${EVENT_DAY_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/api/event-day; Max-Age=0`;
}

export { EVENT_DAY_COOKIE_NAME };
