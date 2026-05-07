// M4 B4d — tests for GET /api/admin/dashboard/action-queue.
//
// Endpoint: worker/routes/admin/dashboard.js. Returns 4 aggregated
// counts of items needing owner attention. Consumer: ActionQueue widget
// on the owner persona dashboard.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const PATH = '/api/admin/dashboard/action-queue';

describe('GET /api/admin/dashboard/action-queue', () => {
    it('returns the 4-key shape with counts populated', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings b\s+JOIN attendees a ON a.booking_id = b.id\s+WHERE b.status = 'paid' AND a.waiver_id IS NULL/, { n: 12 }, 'first');
        env.DB.__on(/FROM vendor_signatures\s+WHERE countersigned_at IS NULL/, { n: 1 }, 'first');
        env.DB.__on(/FROM feedback WHERE status = 'new'/, { n: 5 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE refunded_at IS NOT NULL AND refunded_at >= \?/, { n: 3 }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({
            missingWaiversCount: 12,
            pendingVendorCountersignsCount: 1,
            feedbackUntriagedCount: 5,
            recentRefundsCount: 3,
        });
    });

    it('returns zeros when all queries return empty results', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings b\s+JOIN attendees a/, { n: 0 }, 'first');
        env.DB.__on(/FROM vendor_signatures/, { n: 0 }, 'first');
        env.DB.__on(/FROM feedback/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE refunded_at/, { n: 0 }, 'first');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json).toEqual({
            missingWaiversCount: 0,
            pendingVendorCountersignsCount: 0,
            feedbackUntriagedCount: 0,
            recentRefundsCount: 0,
        });
    });

    it('handles null first()-row results (defensive)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings b\s+JOIN attendees a/, null, 'first');
        env.DB.__on(/FROM vendor_signatures/, null, 'first');
        env.DB.__on(/FROM feedback/, null, 'first');
        env.DB.__on(/FROM bookings\s+WHERE refunded_at/, null, 'first');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.missingWaiversCount).toBe(0);
        expect(json.pendingVendorCountersignsCount).toBe(0);
        expect(json.feedbackUntriagedCount).toBe(0);
        expect(json.recentRefundsCount).toBe(0);
    });

    it('binds a 7-days-ago timestamp to the recent-refunds query', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedBinds = null;
        env.DB.__on(/FROM bookings b\s+JOIN attendees a/, { n: 0 }, 'first');
        env.DB.__on(/FROM vendor_signatures/, { n: 0 }, 'first');
        env.DB.__on(/FROM feedback/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE refunded_at IS NOT NULL AND refunded_at >= \?/, (sql, args) => {
            capturedBinds = args;
            return { n: 0 };
        }, 'first');

        const before = Date.now();
        await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        const after = Date.now();

        // Should bind a timestamp ~7 days before now (allowing for test
        // execution time fluctuation).
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        expect(capturedBinds[0]).toBeGreaterThanOrEqual(before - sevenDaysMs - 100);
        expect(capturedBinds[0]).toBeLessThanOrEqual(after - sevenDaysMs + 100);
    });

    it('returns 401 when admin cookie is missing', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(makeReq(PATH), env, {});
        expect(res.status).toBe(401);
    });

    it('works for role=staff (any admin tier reads /action-queue)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });

        env.DB.__on(/FROM bookings b\s+JOIN attendees a/, { n: 0 }, 'first');
        env.DB.__on(/FROM vendor_signatures/, { n: 0 }, 'first');
        env.DB.__on(/FROM feedback/, { n: 0 }, 'first');
        env.DB.__on(/FROM bookings\s+WHERE refunded_at/, { n: 0 }, 'first');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
    });
});
