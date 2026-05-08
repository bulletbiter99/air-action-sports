// M5 R12 — pure helper + I/O wrapper tests for worker/lib/eventDaySession.js.
//
// requireEventDayAuth middleware is exercised through route tests at
// tests/unit/event-day/session.test.js (it rides on the worker fetch
// pipeline). This file covers the building blocks below the middleware.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    EVENT_DAY_WINDOW_MS,
    ACTIVITY_KINDS,
    randomEventDaySessionId,
    isEventActive,
    eventDayWindowExpired,
    startEventDaySession,
    getActiveEventDaySession,
    getEventDaySessionById,
    endEventDaySession,
    bumpActivityCounter,
    touchActivity,
    parseEventDayCookie,
    setEventDayCookie,
    clearEventDayCookie,
    EVENT_DAY_COOKIE_NAME,
} from '../../../worker/lib/eventDaySession.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

describe('EVENT_DAY_WINDOW_MS', () => {
    it('is 30 hours in milliseconds', () => {
        expect(EVENT_DAY_WINDOW_MS).toBe(30 * 60 * 60 * 1000);
    });
});

describe('ACTIVITY_KINDS', () => {
    it('exposes the four migration-0037 counter names as an immutable list', () => {
        expect(ACTIVITY_KINDS).toEqual(['checkin', 'walkup', 'incident', 'equipment_return']);
        expect(Object.isFrozen(ACTIVITY_KINDS)).toBe(true);
    });
});

describe('randomEventDaySessionId', () => {
    it('produces ids matching `eds_<12 alphanum>`', () => {
        for (let i = 0; i < 50; i++) {
            const id = randomEventDaySessionId();
            expect(id).toMatch(/^eds_[0-9A-Za-z]{12}$/);
        }
    });

    it('produces unique ids across calls', () => {
        const set = new Set();
        for (let i = 0; i < 500; i++) set.add(randomEventDaySessionId());
        expect(set.size).toBe(500);
    });
});

describe('isEventActive', () => {
    const eventDate = '2026-06-15';
    const eventStartUtc = Date.parse(`${eventDate}T00:00:00Z`);

    it('returns false for null/undefined event', () => {
        expect(isEventActive(null, eventStartUtc)).toBe(false);
        expect(isEventActive(undefined, eventStartUtc)).toBe(false);
    });

    it('returns false when date_iso is missing', () => {
        expect(isEventActive({}, eventStartUtc)).toBe(false);
        expect(isEventActive({ date_iso: '' }, eventStartUtc)).toBe(false);
    });

    it('returns false when date_iso is malformed (Date.parse NaN)', () => {
        expect(isEventActive({ date_iso: 'not-a-date' }, eventStartUtc)).toBe(false);
    });

    it('returns false when event.past = 1 (admin override)', () => {
        expect(isEventActive({ date_iso: eventDate, past: 1 }, eventStartUtc)).toBe(false);
    });

    it('returns true at exactly the start of the event-day window', () => {
        expect(isEventActive({ date_iso: eventDate }, eventStartUtc)).toBe(true);
    });

    it('returns true mid-window (12 hours into the event day)', () => {
        const noon = eventStartUtc + 12 * 60 * 60 * 1000;
        expect(isEventActive({ date_iso: eventDate }, noon)).toBe(true);
    });

    it('returns true at exactly the end of the 30-hour window', () => {
        expect(isEventActive({ date_iso: eventDate }, eventStartUtc + EVENT_DAY_WINDOW_MS)).toBe(true);
    });

    it('returns false 1 ms after the window closes', () => {
        expect(isEventActive({ date_iso: eventDate }, eventStartUtc + EVENT_DAY_WINDOW_MS + 1)).toBe(false);
    });

    it('returns false before the event start (1 ms before)', () => {
        expect(isEventActive({ date_iso: eventDate }, eventStartUtc - 1)).toBe(false);
    });
});

describe('eventDayWindowExpired', () => {
    const eventDate = '2026-06-15';
    const eventStartUtc = Date.parse(`${eventDate}T00:00:00Z`);

    it('returns true for null/undefined event', () => {
        expect(eventDayWindowExpired(null, eventStartUtc)).toBe(true);
        expect(eventDayWindowExpired(undefined, eventStartUtc)).toBe(true);
    });

    it('returns true when event.past = 1', () => {
        expect(eventDayWindowExpired({ date_iso: eventDate, past: 1 }, eventStartUtc)).toBe(true);
    });

    it('returns false during the event-day window', () => {
        expect(eventDayWindowExpired({ date_iso: eventDate }, eventStartUtc + 60 * 60 * 1000)).toBe(false);
    });

    it('returns true after the window closes', () => {
        expect(eventDayWindowExpired({ date_iso: eventDate }, eventStartUtc + EVENT_DAY_WINDOW_MS + 1)).toBe(true);
    });

    it('returns true for malformed date_iso', () => {
        expect(eventDayWindowExpired({ date_iso: 'invalid' }, eventStartUtc)).toBe(true);
    });
});

describe('startEventDaySession', () => {
    let env;
    beforeEach(() => {
        env = createMockEnv();
        env.DB.__on(/INSERT INTO event_day_sessions/, { meta: { changes: 1 } }, 'run');
    });

    it('throws if eventId missing', async () => {
        await expect(startEventDaySession(env, { personId: 'prs_1' })).rejects.toThrow(/eventId required/);
    });

    it('throws if personId missing', async () => {
        await expect(startEventDaySession(env, { eventId: 'evt_1' })).rejects.toThrow(/personId required/);
    });

    it('inserts a row and returns the new id + signedInAt', async () => {
        const result = await startEventDaySession(env, {
            portalSessionId: 'ps_abc',
            eventId: 'evt_1',
            personId: 'prs_1',
            ipAddress: '203.0.113.5',
            userAgent: 'Mozilla',
        });
        expect(result.id).toMatch(/^eds_[0-9A-Za-z]{12}$/);
        expect(result.signedInAt).toBeGreaterThan(0);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO event_day_sessions/.test(w.sql));
        expect(insert).toBeDefined();
        // Positional bind shape: id, eventId, personId, portalSessionId, signedInAt, lastActivityAt, ip, ua, createdAt
        expect(insert.args).toContain('evt_1');
        expect(insert.args).toContain('prs_1');
        expect(insert.args).toContain('ps_abc');
        expect(insert.args).toContain('203.0.113.5');
    });

    it('binds null for missing portal_session_id / ip / user_agent', async () => {
        await startEventDaySession(env, { eventId: 'evt_1', personId: 'prs_1' });
        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO event_day_sessions/.test(w.sql));
        expect(insert.args.filter((a) => a === null).length).toBeGreaterThanOrEqual(3);
    });
});

describe('getActiveEventDaySession', () => {
    let env;
    beforeEach(() => { env = createMockEnv(); });

    it('returns null when portalSessionId or eventId missing', async () => {
        expect(await getActiveEventDaySession(env, {})).toBeNull();
        expect(await getActiveEventDaySession(env, { portalSessionId: 'p' })).toBeNull();
        expect(await getActiveEventDaySession(env, { eventId: 'e' })).toBeNull();
    });

    it('returns the row when one exists with signed_out_at IS NULL', async () => {
        const sessionRow = {
            id: 'eds_abc', portal_session_id: 'ps_1', event_id: 'evt_1', person_id: 'prs_1',
            signed_out_at: null,
        };
        env.DB.__on(
            /SELECT \* FROM event_day_sessions[\s\S]*signed_out_at IS NULL/,
            sessionRow,
            'first',
        );
        const result = await getActiveEventDaySession(env, { portalSessionId: 'ps_1', eventId: 'evt_1' });
        expect(result).toEqual(sessionRow);
    });

    it('returns null when no active session exists', async () => {
        env.DB.__on(
            /SELECT \* FROM event_day_sessions[\s\S]*signed_out_at IS NULL/,
            null,
            'first',
        );
        const result = await getActiveEventDaySession(env, { portalSessionId: 'ps_1', eventId: 'evt_1' });
        expect(result).toBeNull();
    });

    it('binds portalSessionId and eventId positionally', async () => {
        env.DB.__on(/SELECT \* FROM event_day_sessions/, null, 'first');
        await getActiveEventDaySession(env, { portalSessionId: 'ps_xyz', eventId: 'evt_xyz' });
        const writes = env.DB.__writes();
        const q = writes.find((w) => /SELECT \* FROM event_day_sessions/.test(w.sql));
        expect(q.args).toEqual(['ps_xyz', 'evt_xyz']);
    });
});

describe('getEventDaySessionById', () => {
    let env;
    beforeEach(() => { env = createMockEnv(); });

    it('returns null for falsy id', async () => {
        expect(await getEventDaySessionById(env, null)).toBeNull();
        expect(await getEventDaySessionById(env, '')).toBeNull();
        expect(await getEventDaySessionById(env, undefined)).toBeNull();
    });

    it('returns the row when one exists', async () => {
        env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, { id: 'eds_x' }, 'first');
        expect(await getEventDaySessionById(env, 'eds_x')).toEqual({ id: 'eds_x' });
    });
});

describe('endEventDaySession', () => {
    let env;
    beforeEach(() => {
        env = createMockEnv();
        env.DB.__on(/UPDATE event_day_sessions SET signed_out_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
    });

    it('updates signed_out_at + writes audit; returns ok + signedOutAt', async () => {
        const result = await endEventDaySession(env, 'eds_xyz');
        expect(result.ok).toBe(true);
        expect(result.signedOutAt).toBeGreaterThan(0);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE event_day_sessions SET signed_out_at/.test(w.sql));
        expect(update.args).toContain('eds_xyz');

        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.session_ended')
        );
        expect(audit).toBeDefined();
    });

    it('binds reason positionally into the audit row meta_json (lessons-learned #3)', async () => {
        await endEventDaySession(env, 'eds_xyz', { reason: 'event_window_closed' });
        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        // meta_json is JSON-encoded — find the arg that is a JSON string containing reason.
        const metaArg = audit.args.find((a) => typeof a === 'string' && a.startsWith('{'));
        expect(metaArg).toBeDefined();
        expect(JSON.parse(metaArg).reason).toBe('event_window_closed');
    });

    it('defaults reason to "manual_signout"', async () => {
        await endEventDaySession(env, 'eds_xyz');
        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        const metaArg = audit.args.find((a) => typeof a === 'string' && a.startsWith('{'));
        expect(JSON.parse(metaArg).reason).toBe('manual_signout');
    });
});

describe('bumpActivityCounter', () => {
    let env;
    beforeEach(() => {
        env = createMockEnv();
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
    });

    it('throws on unknown kind (whitelist enforcement)', async () => {
        await expect(bumpActivityCounter(env, 'eds_x', 'evil_drop_table')).rejects.toThrow(/unknown kind/);
    });

    it('increments checkins_performed for kind="checkin"', async () => {
        await bumpActivityCounter(env, 'eds_x', 'checkin');
        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE event_day_sessions/.test(w.sql));
        expect(update.sql).toContain('checkins_performed = checkins_performed + 1');
        expect(update.args).toContain('eds_x');
    });

    it('increments walkups_created for kind="walkup"', async () => {
        await bumpActivityCounter(env, 'eds_x', 'walkup');
        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE event_day_sessions/.test(w.sql));
        expect(update.sql).toContain('walkups_created = walkups_created + 1');
    });

    it('increments incidents_filed for kind="incident"', async () => {
        await bumpActivityCounter(env, 'eds_x', 'incident');
        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE event_day_sessions/.test(w.sql));
        expect(update.sql).toContain('incidents_filed = incidents_filed + 1');
    });

    it('increments equipment_returns for kind="equipment_return"', async () => {
        await bumpActivityCounter(env, 'eds_x', 'equipment_return');
        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE event_day_sessions/.test(w.sql));
        expect(update.sql).toContain('equipment_returns = equipment_returns + 1');
    });
});

describe('touchActivity', () => {
    let env;
    beforeEach(() => {
        env = createMockEnv();
        env.DB.__on(/UPDATE event_day_sessions SET last_activity_at/, { meta: { changes: 1 } }, 'run');
    });

    it('UPDATEs last_activity_at and returns the new timestamp', async () => {
        const result = await touchActivity(env, 'eds_x');
        expect(result.lastActivityAt).toBeGreaterThan(0);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE event_day_sessions SET last_activity_at/.test(w.sql));
        expect(update.args).toContain('eds_x');
    });
});

describe('parseEventDayCookie', () => {
    it('returns null for empty/null/undefined header', () => {
        expect(parseEventDayCookie(null)).toBeNull();
        expect(parseEventDayCookie('')).toBeNull();
        expect(parseEventDayCookie(undefined)).toBeNull();
    });

    it('extracts the event-day cookie value from a multi-cookie header', () => {
        const header = 'aas_session=abc; aas_event_day_session=eds_xyz; foo=bar';
        expect(parseEventDayCookie(header)).toBe('eds_xyz');
    });

    it('returns null when cookie not present', () => {
        expect(parseEventDayCookie('aas_session=abc; foo=bar')).toBeNull();
    });

    it('returns null for empty cookie value', () => {
        expect(parseEventDayCookie('aas_event_day_session=; foo=bar')).toBeNull();
    });
});

describe('setEventDayCookie / clearEventDayCookie', () => {
    it('setEventDayCookie embeds the session id, HttpOnly + Secure + 12hr Max-Age', () => {
        const cookie = setEventDayCookie('eds_abc');
        expect(cookie).toContain('aas_event_day_session=eds_abc');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('Max-Age=43200');
        expect(cookie).toContain('Path=/api/event-day');
    });

    it('clearEventDayCookie has Max-Age=0 to expire immediately', () => {
        const cookie = clearEventDayCookie();
        expect(cookie).toContain('aas_event_day_session=;');
        expect(cookie).toContain('Max-Age=0');
    });

    it('exposes EVENT_DAY_COOKIE_NAME constant', () => {
        expect(EVENT_DAY_COOKIE_NAME).toBe('aas_event_day_session');
    });
});
