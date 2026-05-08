// M5 R12 — event-day session route tests.
//
// Covers the four endpoints mounted at /api/event-day/sessions:
//   POST /start       — bootstrap; portal-cookie + event-staffed gates
//   POST /heartbeat   — gated by requireEventDayAuth
//   POST /end         — gated by requireEventDayAuth
//   GET  /me          — gated by requireEventDayAuth

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createPortalCookie } from '../../../worker/lib/portalSession.js';

let env;

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';
const PORTAL_SESSION_ID = 'ps_test_001';
const PERSON_ID = 'prs_test_001';
const EVENT_ID = 'evt_test_001';
const EVENT_DAY_SESSION_ID = 'eds_aBcDeF012345';

// Build a date_iso for "today" in UTC so isEventActive returns true
// without time-warping the test runner. The 30-hour grace window keeps
// the call-site forgiving even if a test runs at 23:55 UTC.
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

async function buildPortalCookie() {
    const value = await createPortalCookie(PORTAL_SESSION_ID, 1, SECRET);
    return `aas_portal_session=${value}`;
}

beforeEach(() => {
    env = createMockEnv();
});

describe('POST /api/event-day/sessions/start', () => {
    it('returns 401 when portal cookie is missing', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: EVENT_ID }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 400 when eventId is missing from body', async () => {
        const cookie = await buildPortalCookie();
        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 401 when portal_session row not found in DB', async () => {
        const cookie = await buildPortalCookie();
        // Default mockD1 returns null for first(). portal_sessions lookup fails → 401.
        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: EVENT_ID }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 404 when event_id does not exist', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT id, person_id FROM portal_sessions/, {
            id: PORTAL_SESSION_ID, person_id: PERSON_ID,
        }, 'first');
        env.DB.__on(/SELECT id, title, date_iso, past FROM events WHERE id = \?/, null, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: 'evt_nope' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when event is not currently active (past date)', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT id, person_id FROM portal_sessions/, {
            id: PORTAL_SESSION_ID, person_id: PERSON_ID,
        }, 'first');
        env.DB.__on(/SELECT id, title, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, title: 'Old', date_iso: '2020-01-01', past: 1,
        }, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: EVENT_ID }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
    });

    it('returns 403 when caller is not staffed for the event', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT id, person_id FROM portal_sessions/, {
            id: PORTAL_SESSION_ID, person_id: PERSON_ID,
        }, 'first');
        env.DB.__on(/SELECT id, title, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, title: 'Today', date_iso: todayIso(), past: 0,
        }, 'first');
        env.DB.__on(/FROM event_staffing[\s\S]+person_id = \?/, null, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: EVENT_ID }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 200 + sets cookie on happy-path bootstrap', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT id, person_id FROM portal_sessions/, {
            id: PORTAL_SESSION_ID, person_id: PERSON_ID,
        }, 'first');
        env.DB.__on(/SELECT id, title, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, title: 'Operation Nightfall', date_iso: todayIso(), past: 0,
        }, 'first');
        env.DB.__on(/FROM event_staffing[\s\S]+person_id = \?/, {
            id: 'esa_1', rsvp: 'accepted',
        }, 'first');
        env.DB.__on(/SELECT \* FROM event_day_sessions[\s\S]*signed_out_at IS NULL/, null, 'first');
        env.DB.__on(/INSERT INTO event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: EVENT_ID }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toContain('aas_event_day_session=eds_');

        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.sessionId).toMatch(/^eds_/);
        expect(body.event).toMatchObject({ id: EVENT_ID, title: 'Operation Nightfall' });
    });

    it('returns the existing session id (reused: true) when one already active for person+event', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT id, person_id FROM portal_sessions/, {
            id: PORTAL_SESSION_ID, person_id: PERSON_ID,
        }, 'first');
        env.DB.__on(/SELECT id, title, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, title: 'Today', date_iso: todayIso(), past: 0,
        }, 'first');
        env.DB.__on(/FROM event_staffing[\s\S]+person_id = \?/, {
            id: 'esa_1', rsvp: 'accepted',
        }, 'first');
        env.DB.__on(/SELECT \* FROM event_day_sessions[\s\S]*signed_out_at IS NULL/, {
            id: EVENT_DAY_SESSION_ID,
            event_id: EVENT_ID,
            person_id: PERSON_ID,
            portal_session_id: PORTAL_SESSION_ID,
            signed_in_at: Date.now() - 60_000,
        }, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/sessions/start', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: EVENT_ID }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.reused).toBe(true);
        expect(body.sessionId).toBe(EVENT_DAY_SESSION_ID);
    });
});

describe('POST /api/event-day/sessions/heartbeat', () => {
    function bindActiveSession() {
        env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, {
            id: EVENT_DAY_SESSION_ID,
            event_id: EVENT_ID,
            person_id: PERSON_ID,
            portal_session_id: PORTAL_SESSION_ID,
            signed_out_at: null,
            checkins_performed: 0,
            walkups_created: 0,
            incidents_filed: 0,
            equipment_returns: 0,
            signed_in_at: Date.now() - 60_000,
            last_activity_at: Date.now() - 60_000,
        }, 'first');
        env.DB.__on(/SELECT id, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, date_iso: todayIso(), past: 0,
        }, 'first');
        env.DB.__on(/SELECT id, full_name, email FROM persons WHERE id = \?/, {
            id: PERSON_ID, full_name: 'Test Person', email: 'p@e.com',
        }, 'first');
    }

    it('returns 401 without portal cookie', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/sessions/heartbeat', {
            method: 'POST',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 401 without event-day session cookie/header', async () => {
        const cookie = await buildPortalCookie();
        const req = new Request('https://airactionsport.com/api/event-day/sessions/heartbeat', {
            method: 'POST',
            headers: { cookie },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 401 when event-day session cannot be found', async () => {
        const cookie = await buildPortalCookie();
        const req = new Request('https://airactionsport.com/api/event-day/sessions/heartbeat', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=eds_nope_no_match`, 'X-Event-Day-Session': 'eds_nope_no_match' },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 401 when event-day session belongs to a different portal session', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, {
            id: EVENT_DAY_SESSION_ID,
            portal_session_id: 'ps_someone_else',
            event_id: EVENT_ID,
            signed_out_at: null,
        }, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/sessions/heartbeat', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe('event_day_session_mismatch');
    });

    it('returns 401 + auto-ends session when event window has expired', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, {
            id: EVENT_DAY_SESSION_ID,
            event_id: EVENT_ID,
            person_id: PERSON_ID,
            portal_session_id: PORTAL_SESSION_ID,
            signed_out_at: null,
        }, 'first');
        env.DB.__on(/SELECT id, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, date_iso: '2020-01-01', past: 1,
        }, 'first');
        env.DB.__on(/UPDATE event_day_sessions SET signed_out_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/sessions/heartbeat', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe('event_window_closed');

        // Verify the auto-end happened.
        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE event_day_sessions SET signed_out_at/.test(w.sql));
        expect(update).toBeDefined();
    });

    it('returns 200 and updates last_activity_at on happy-path heartbeat', async () => {
        const cookie = await buildPortalCookie();
        bindActiveSession();
        env.DB.__on(/UPDATE event_day_sessions SET last_activity_at/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/sessions/heartbeat', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.lastActivityAt).toBeGreaterThan(0);
    });
});

describe('POST /api/event-day/sessions/end', () => {
    it('returns 200 + writes audit + clears cookie on signed-in caller', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, {
            id: EVENT_DAY_SESSION_ID,
            event_id: EVENT_ID,
            person_id: PERSON_ID,
            portal_session_id: PORTAL_SESSION_ID,
            signed_out_at: null,
        }, 'first');
        env.DB.__on(/SELECT id, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, date_iso: todayIso(), past: 0,
        }, 'first');
        env.DB.__on(/SELECT id, full_name, email FROM persons WHERE id = \?/, {
            id: PERSON_ID, full_name: 'Test', email: 't@e.com',
        }, 'first');
        env.DB.__on(/UPDATE event_day_sessions SET signed_out_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/sessions/end', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toContain('aas_event_day_session=;');
        expect(setCookie).toContain('Max-Age=0');

        const writes = env.DB.__writes();
        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.session_ended')
        );
        expect(audit).toBeDefined();
    });
});

describe('GET /api/event-day/sessions/me', () => {
    it('returns counters + identifiers on happy path', async () => {
        const cookie = await buildPortalCookie();
        env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, {
            id: EVENT_DAY_SESSION_ID,
            event_id: EVENT_ID,
            person_id: PERSON_ID,
            portal_session_id: PORTAL_SESSION_ID,
            signed_out_at: null,
            checkins_performed: 12,
            walkups_created: 3,
            incidents_filed: 1,
            equipment_returns: 2,
            signed_in_at: 1700000000000,
            last_activity_at: 1700001000000,
        }, 'first');
        env.DB.__on(/SELECT id, date_iso, past FROM events WHERE id = \?/, {
            id: EVENT_ID, date_iso: todayIso(), past: 0,
        }, 'first');
        env.DB.__on(/SELECT id, full_name, email FROM persons WHERE id = \?/, {
            id: PERSON_ID, full_name: 'Jane Marshal', email: 'jane@aas.com',
        }, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/sessions/me', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.sessionId).toBe(EVENT_DAY_SESSION_ID);
        expect(body.eventId).toBe(EVENT_ID);
        expect(body.counters).toEqual({
            checkinsPerformed: 12,
            walkupsCreated: 3,
            incidentsFiled: 1,
            equipmentReturns: 2,
        });
        expect(body.person.fullName).toBe('Jane Marshal');
    });
});
