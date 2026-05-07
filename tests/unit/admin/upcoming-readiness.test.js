// M4 B4d — tests for GET /api/admin/dashboard/upcoming-readiness.
//
// Endpoint: worker/routes/admin/dashboard.js. Returns top-3 upcoming
// events (date_iso > today, published=1, past=0) with capacity + waiver
// readiness percentages. Consumer: UpcomingEventsReadiness widget on
// the owner persona dashboard.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const PATH = '/api/admin/dashboard/upcoming-readiness';

describe('GET /api/admin/dashboard/upcoming-readiness', () => {
    it('returns top 3 upcoming events with capacity + waiver percentages', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso > \? AND published = 1 AND past = 0/, {
            results: [
                { id: 'evt_a', title: 'Spring Showdown', date_iso: '2026-05-15', total_slots: 80 },
            ],
        }, 'all');
        env.DB.__on(/FROM bookings\s+WHERE event_id IN \(\?\) AND status = 'paid'/, {
            results: [{ event_id: 'evt_a', paid_count: 42 }],
        }, 'all');
        env.DB.__on(/FROM attendees a\s+JOIN bookings b ON b.id = a.booking_id\s+WHERE b.event_id IN/, {
            results: [{ event_id: 'evt_a', attendees: 58, waivers_signed: 50 }],
        }, 'all');

        const res = await worker.fetch(
            makeReq(PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.events).toHaveLength(1);
        expect(json.events[0]).toMatchObject({
            eventId: 'evt_a',
            title: 'Spring Showdown',
            dateIso: '2026-05-15',
            totalSlots: 80,
            paidCount: 42,
            attendeeCount: 58,
            waiverSignedCount: 50,
            capacityPct: 53,  // 42/80 = 0.525 → 53
            waiverPct: 86,    // 50/58 = 0.862 → 86
        });
    });

    it('filters to date_iso > today (excludes today and past)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/date_iso > \?/);
        expect(capturedSql).toMatch(/published = 1/);
        expect(capturedSql).toMatch(/past = 0/);
    });

    it('caps query at LIMIT 3', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/LIMIT 3/);
    });

    it('returns empty array when no upcoming events (no second-stage queries fired)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events/, { results: [] }, 'all');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.events).toEqual([]);
    });

    it('caps capacityPct at 100 when paidCount > totalSlots (oversold)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso > \?/, {
            results: [{ id: 'evt_x', title: 'Sold Out Plus', date_iso: '2026-05-20', total_slots: 50 }],
        }, 'all');
        env.DB.__on(/FROM bookings\s+WHERE event_id IN/, {
            results: [{ event_id: 'evt_x', paid_count: 60 }],
        }, 'all');
        env.DB.__on(/FROM attendees a/, {
            results: [{ event_id: 'evt_x', attendees: 0, waivers_signed: 0 }],
        }, 'all');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.events[0].capacityPct).toBe(100);
        expect(json.events[0].waiverPct).toBe(0); // 0 attendees → 0 instead of NaN
    });

    it('handles event with totalSlots=0 (no division by zero)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events\s+WHERE date_iso > \?/, {
            results: [{ id: 'evt_z', title: 'Unlimited Capacity', date_iso: '2026-06-01', total_slots: 0 }],
        }, 'all');
        env.DB.__on(/FROM bookings\s+WHERE event_id IN/, {
            results: [{ event_id: 'evt_z', paid_count: 5 }],
        }, 'all');
        env.DB.__on(/FROM attendees a/, {
            results: [{ event_id: 'evt_z', attendees: 5, waivers_signed: 5 }],
        }, 'all');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.events[0].capacityPct).toBe(0);
        expect(json.events[0].waiverPct).toBe(100);
    });

    it('returns 401 when admin cookie is missing', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(makeReq(PATH), env, {});
        expect(res.status).toBe(401);
    });

    it('works for role=manager (any admin tier)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });

        env.DB.__on(/SELECT date\('now'\) AS today/, { today: '2026-05-08' }, 'first');
        env.DB.__on(/FROM events/, { results: [] }, 'all');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
    });
});
