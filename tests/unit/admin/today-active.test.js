// M4 B4b — tests for GET /api/admin/today/active.
//
// Endpoint: worker/routes/admin/dashboard.js — mounted at /api/admin
// in worker/index.js so the full path is /api/admin/today/active.
//
// Response shape contract (consumed by useWidgetData cadence rule, B5
// sidebar, B6 walk-up banner):
//   { activeEventToday: bool, eventId: string|null, checkInOpen: bool }

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const TODAY_ACTIVE_PATH = '/api/admin/today/active';

describe('GET /api/admin/today/active', () => {
    it('returns activeEventToday=true with single event today', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso = \? AND published = 1 AND past = 0/, {
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

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso = \? AND published = 1 AND past = 0/, {
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

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso = \? AND published = 1 AND past = 0/, {
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

    it('binds today date to events query (so the query is parameterized, not interpolated)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedBinds = null;
        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso = \? AND published = 1 AND past = 0/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(capturedBinds).toEqual(['2026-05-08']);
    });

    it('only counts events with published=1 AND past=0 (filtered in SQL, not in app code)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
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

    it('caps the query at LIMIT 2 (so multi-event detection scans the minimum needed)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(TODAY_ACTIVE_PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(capturedSql).toMatch(/LIMIT 2/);
    });

    it('returns 401 when admin cookie is missing', async () => {
        const env = createMockEnv();

        const res = await worker.fetch(makeReq(TODAY_ACTIVE_PATH), env, {});
        expect(res.status).toBe(401);
    });

    it('works for role=manager (any admin tier may read /today/active)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso/, { results: [] }, 'all');

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

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso/, { results: [] }, 'all');

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
        env.DB.__on(/FROM events\s+WHERE date_iso/, (sql, args) => {
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

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso/, {
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
});
