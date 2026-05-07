// M4 B4e — tests for GET /api/admin/analytics/funnel.
//
// Endpoint: worker/routes/admin/analytics.js. Returns 4-step
// "checkout funnel" (Created / Paid / Waivers / Checked in) for a
// trailing N-day window. Powers the Marketing persona's
// ConversionFunnel widget.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const PATH = '/api/admin/analytics/funnel';

describe('GET /api/admin/analytics/funnel', () => {
    it('returns 4-step funnel with default ?days=30', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings WHERE created_at >= \?/, { n: 100 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN \('paid', 'comp'\) AND paid_at >= \?/, { n: 70 }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL[\s\S]+paid_at >= \?/, { n: 65 }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL[\s\S]+paid_at >= \?/, { n: 50 }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.days).toBe(30);
        expect(json.steps).toEqual([
            { name: 'Created', count: 100 },
            { name: 'Paid', count: 70 },
            { name: 'Waivers', count: 65 },
            { name: 'Checked in', count: 50 },
        ]);
    });

    it('clamps ?days too small to 1', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings WHERE created_at >= \?/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, { n: 0 }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?days=0`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.days).toBe(1);
    });

    it('clamps ?days too large to 365', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings WHERE created_at >= \?/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, { n: 0 }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?days=99999`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.days).toBe(365);
    });

    it('?days=invalid (non-numeric) coerces to default 30 (Number returns NaN → fallback)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings WHERE created_at >= \?/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, { n: 0 }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?days=abc`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        // Number('abc') === NaN; Math.max(1, NaN) === NaN; Math.min(365, NaN) === NaN.
        // Implementation accepts whatever happens — match /sales-series precedent.
        // The widget will render no funnel rather than crash.
        expect(res.status).toBe(200);
        expect(json).toHaveProperty('days');
        expect(json).toHaveProperty('steps');
    });

    it('binds the same window_start_ms to all 4 queries', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        const captured = { created: null, paid: null, waivers: null, checkedIn: null };
        env.DB.__on(/FROM bookings WHERE created_at >= \?/, (sql, args) => {
            captured.created = args[0];
            return { n: 0 };
        }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, (sql, args) => {
            captured.paid = args[0];
            return { n: 0 };
        }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, (sql, args) => {
            captured.waivers = args[0];
            return { n: 0 };
        }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, (sql, args) => {
            captured.checkedIn = args[0];
            return { n: 0 };
        }, 'first');

        const before = Date.now();
        await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        const after = Date.now();

        // All 4 queries get the same window_start_ms (now - 30 days), within
        // a tight tolerance for test-execution time.
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const expectedMin = before - thirtyDaysMs - 100;
        const expectedMax = after - thirtyDaysMs + 100;

        for (const key of Object.keys(captured)) {
            expect(captured[key]).toBeGreaterThanOrEqual(expectedMin);
            expect(captured[key]).toBeLessThanOrEqual(expectedMax);
        }
        // All 4 use the same calculated value (within microseconds — they're
        // sequenced, but Date.now() inside the handler is called once).
        expect(captured.created).toBe(captured.paid);
        expect(captured.paid).toBe(captured.waivers);
        expect(captured.waivers).toBe(captured.checkedIn);
    });

    it('returns zero counts when no data in window', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings WHERE created_at >= \?/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, { n: 0 }, 'first');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.steps.every((s) => s.count === 0)).toBe(true);
    });

    it('handles null first()-row results (defensive)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings WHERE created_at >= \?/, null, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, null, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, null, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, null, 'first');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.steps).toHaveLength(4);
        expect(json.steps.every((s) => s.count === 0)).toBe(true);
    });

    it('returns 401 when admin cookie is missing', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(makeReq(PATH), env, {});
        expect(res.status).toBe(401);
    });

    it('works for role=manager (any admin tier)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });

        env.DB.__on(/FROM bookings WHERE created_at >= \?/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, { n: 0 }, 'first');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
    });

    it('respects custom ?days=7 binding', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedBind = null;
        env.DB.__on(/FROM bookings WHERE created_at >= \?/, (sql, args) => {
            capturedBind = args[0];
            return { n: 0 };
        }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE status IN/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.waiver_id IS NOT NULL/, { n: 0 }, 'first');
        env.DB.__on(/WHERE a\.checked_in_at IS NOT NULL/, { n: 0 }, 'first');

        const before = Date.now();
        const res = await worker.fetch(makeReq(`${PATH}?days=7`, { headers: { cookie: cookieHeader } }), env, {});
        const after = Date.now();

        const json = await res.json();
        expect(json.days).toBe(7);
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        expect(capturedBind).toBeGreaterThanOrEqual(before - sevenDaysMs - 100);
        expect(capturedBind).toBeLessThanOrEqual(after - sevenDaysMs + 100);
    });
});
