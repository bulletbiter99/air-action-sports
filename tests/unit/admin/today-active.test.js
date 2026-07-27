// M4 B4b — tests for GET /api/admin/today/active.
//
// Endpoint: worker/routes/admin/dashboard.js — mounted at /api/admin
// in worker/index.js so the full path is /api/admin/today/active.
//
// Response shape contract (consumed by useWidgetData cadence rule, B5
// sidebar, B6 walk-up banner, AdminToday per-event tiles):
//   { activeEventToday: bool, eventId: string|null, checkInOpen: bool,
//     events: [{ id, title }] }   // events added 2026-07 (additive)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const TODAY_ACTIVE_PATH = '/api/admin/today/active';

// "Today" is the DENVER calendar date now, derived in JS — the endpoint no
// longer issues `SELECT date('now')` (which returned the UTC date and made this
// endpoint report no-event-today from 18:00 Mountain onward). Pin the clock to
// midday Denver on 2026-05-08 so the derived date is stable and the existing
// fixtures keep their meaning.
const NOW = Date.parse('2026-05-08T18:00:00Z'); // 12:00 MDT on 2026-05-08

describe('GET /api/admin/today/active', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns activeEventToday=true with single event today', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, {
            results: [{ id: 'evt_today_1' }],
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.activeEventToday).toBe(true);
        expect(json.eventId).toBe('evt_today_1');
        expect(json.checkInOpen).toBe(false);
    });

    it('returns activeEventToday=false when no events today', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, {
            results: [],
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.activeEventToday).toBe(false);
        expect(json.eventId).toBe(null);
        expect(json.checkInOpen).toBe(false);
    });

    it('returns eventId=null when multiple events today (ambiguous)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, {
            results: [{ id: 'evt_a' }, { id: 'evt_b' }],
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.activeEventToday).toBe(true);
        expect(json.eventId).toBe(null);
    });

    it('matches events whose span contains today (date-portion overlap, binds today twice)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        let capturedBinds = null;
        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, (sql, args) => {
            capturedSql = sql;
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        // Span overlap on date portions: start <= today AND end (or start) >= today.
        expect(capturedSql).toMatch(/date\(date_iso\) <= \?/);
        expect(capturedSql).toMatch(/date\(COALESCE\(end_date_iso, date_iso\)\) >= \?/);
        // today is bound twice — once per side of the overlap.
        expect(capturedBinds).toEqual(['2026-05-08', '2026-05-08']);
    });

    it('only counts events with published=1 AND past=0 (filtered in SQL, not in app code)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/FROM events/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(capturedSql).toMatch(/published = 1/);
        expect(capturedSql).toMatch(/past = 0/);
    });

    it('caps the query at LIMIT 6 (bounded scan; enough rows for per-event tiles)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/FROM events/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(capturedSql).toMatch(/LIMIT 6/);
    });

    it('returns an events array with id + title for a single event today (additive shape)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-07-25' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, {
            results: [{ id: 'evt_last_light', title: 'Operation Last Light' }],
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.eventId).toBe('evt_last_light');
        expect(json.events).toEqual([{ id: 'evt_last_light', title: 'Operation Last Light' }]);
    });

    it('returns every active event in events[] on a multi-event day (eventId stays null)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-07-25' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, {
            results: [
                { id: 'evt_last_light', title: 'Operation Last Light' },
                { id: 'evt_fire_storm', title: 'Operation Fire Storm' },
            ],
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.activeEventToday).toBe(true);
        expect(json.eventId).toBe(null);
        expect(json.events).toEqual([
            { id: 'evt_last_light', title: 'Operation Last Light' },
            { id: 'evt_fire_storm', title: 'Operation Fire Storm' },
        ]);
    });

    it('events[] title falls back to null when the row carries none', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-07-25' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, {
            results: [{ id: 'evt_untitled' }],
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.events).toEqual([{ id: 'evt_untitled', title: null }]);
    });

    it('returns 401 when admin cookie is missing', async () => {
        const env = createMockEnv();

        const res = await worker.fetch(makeReq(TODAY_ACTIVE_PATH), env, {});
        expect(res.status).toBe(401);
    });

    it('works for role=manager (any admin tier may read /today/active)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });

        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, { results: [] }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
    });

    it('works for role=staff (any admin tier may read /today/active)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });

        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, { results: [] }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
    });

    it('falls back to JS-side date if SQLite returns no row (defensive)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        // SQLite "today" query returns null / empty result — endpoint must still work.
        env.DB.__on(/SELECT date\('now'\) AS today/, null, 'first');
        let capturedBinds = null;
        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        // JS Date fallback: today's UTC YYYY-MM-DD, exact value depends on
        // when the test runs but format must match.
        expect(capturedBinds[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('checkInOpen is always false in B4b (placeholder; real logic deferred)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, {
            results: [{ id: 'evt_today_1' }],
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.checkInOpen).toBe(false);
    });

    // ── The evening-blindness regression ───────────────────────────────────
    // date_iso is naive Denver wall clock, so `date(date_iso)` is a Denver date.
    // "Today" used to come from SQLite date('now') — the UTC date — which from
    // 18:00 Mountain onward is already TOMORROW. A single-day event then failed
    // the `date(COALESCE(end_date_iso, date_iso)) >= ?` half and the endpoint
    // reported no event today, killing the /admin/today tiles, the check-in
    // banner, the Today sidebar dot and the fast polling cadence during the
    // closing hours of the op.
    it('still reports the event as active at 8:30 PM Mountain, when UTC has rolled over', async () => {
        vi.setSystemTime(Date.parse('2026-05-09T02:30:00Z')); // 20:30 MDT on 2026-05-08
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedBinds = null;
        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, (sql, args) => {
            capturedBinds = args;
            return { results: [{ id: 'evt_today_1', title: 'Op Night' }] };
        }, 'all');

        const res = await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();

        // Denver date, NOT the UTC '2026-05-09' the old code would have bound.
        expect(capturedBinds).toEqual(['2026-05-08', '2026-05-08']);
        expect(json.activeEventToday).toBe(true);
        expect(json.eventId).toBe('evt_today_1');
    });

    it('does not switch on early — 5 PM Mountain the day BEFORE is not "today"', async () => {
        vi.setSystemTime(Date.parse('2026-05-08T23:00:00Z')); // 17:00 MDT on 2026-05-08
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedBinds = null;
        env.DB.__on(/FROM events\s+WHERE date\(date_iso\)/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        // UTC is already 2026-05-09 here; Denver is not.
        expect(capturedBinds).toEqual(['2026-05-08', '2026-05-08']);
    });
});
