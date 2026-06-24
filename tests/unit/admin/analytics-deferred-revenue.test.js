// Tests for GET /api/admin/analytics/deferred-revenue.
//
// Splits EARNED revenue (total − tax − fee, the income-card basis) on
// paid bookings into:
//   - deferred   = event date still in the future (unearned liability)
//   - recognized = event already occurred / undated
// deferred + recognized == /overview's netRevenueCents, so the cards
// reconcile. events.date_iso carries a time component, so the endpoint
// must normalize with date() before comparing to date('now').

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const PATH = '/api/admin/analytics/deferred-revenue';

// The two queries the handler runs:
//   totals   — .first(),  FROM bookings b LEFT JOIN events e
//   upcoming — .all(),    FROM events e JOIN bookings b ... GROUP BY e.id
const TOTALS_Q = /FROM bookings b\s+LEFT JOIN events/;
const UPCOMING_Q = /FROM events e\s+JOIN bookings b/;

describe('GET /api/admin/analytics/deferred-revenue', () => {
    it('returns deferred + recognized + upcoming breakdown; total reconciles', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(TOTALS_Q, { deferred_cents: 50000, recognized_cents: 120000 }, 'first');
        env.DB.__on(UPCOMING_Q, {
            results: [
                { id: 'evt_aug', title: 'August Op', date_iso: '2026-08-15T07:00:00', paid_bookings: 10, seats_sold: 18, deferred_cents: 50000 },
            ],
        }, 'all');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.deferredCents).toBe(50000);
        expect(json.recognizedCents).toBe(120000);
        expect(json.totalPaidEarnedCents).toBe(170000); // == deferred + recognized
        expect(json.upcomingEvents).toHaveLength(1);
        expect(json.upcomingEvents[0]).toMatchObject({
            eventId: 'evt_aug',
            title: 'August Op',
            dateIso: '2026-08-15T07:00:00',
            deferredCents: 50000,
            paidBookings: 10,
            seatsSold: 18,
        });
    });

    it('all-past scenario: deferred = 0 and upcomingEvents = []', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(TOTALS_Q, { deferred_cents: 0, recognized_cents: 201000 }, 'first');
        env.DB.__on(UPCOMING_Q, { results: [] }, 'all');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.deferredCents).toBe(0);
        expect(json.recognizedCents).toBe(201000);
        expect(json.totalPaidEarnedCents).toBe(201000);
        expect(json.upcomingEvents).toEqual([]);
    });

    it('normalizes date_iso with date() and filters status=paid (regression guard)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let totalsSql = '';
        let upcomingSql = '';
        env.DB.__on(TOTALS_Q, (sql) => { totalsSql = sql; return { deferred_cents: 0, recognized_cents: 0 }; }, 'first');
        env.DB.__on(UPCOMING_Q, (sql) => { upcomingSql = sql; return { results: [] }; }, 'all');

        const res = await worker.fetch(makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        // Date comparison must be on the calendar date, not the raw datetime string.
        expect(totalsSql).toMatch(/date\(e\.date_iso\)\s*>\s*date\('now'\)/);
        expect(totalsSql).toMatch(/b\.status = 'paid'/);
        // earned basis excludes tax + fee.
        expect(totalsSql).toMatch(/b\.total_cents - COALESCE\(b\.tax_cents/);
        // upcoming list is future-only, soonest first.
        expect(upcomingSql).toMatch(/date\(e\.date_iso\)\s*>\s*date\('now'\)/);
        expect(upcomingSql).toMatch(/ORDER BY date\(e\.date_iso\) ASC/);
    });

    it('requires authentication (401 without a session cookie)', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(makeReq(PATH), env, {});
        expect(res.status).toBe(401);
    });
});
