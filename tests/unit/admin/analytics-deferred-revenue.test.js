// Tests for GET /api/admin/analytics/deferred-revenue.
//
// Splits EARNED revenue (total − tax − fee, the income-card basis) on
// paid bookings into:
//   - deferred   = event span not yet fully ended (unearned liability)
//   - recognized = event fully delivered (span end passed) / undated
// deferred + recognized == /overview's netRevenueCents, so the cards
// reconcile. events.date_iso carries a time component, so the endpoint
// must normalize with date() before comparing to today's DENVER date
// (bound as a parameter — date('now') would be the UTC date, which is already
// tomorrow from 18:00 Mountain and flipped undelivered events into recognized).

import { describe, it, expect, vi } from 'vitest';
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
        // Recognition keys off the END of the span (end_date_iso when set,
        // else date_iso) so a multi-day op stays deferred until fully delivered;
        // date() normalizes a timed date_iso.
        expect(totalsSql).toMatch(/date\(COALESCE\(e\.end_date_iso, e\.date_iso\)\)\s*>\s*\?/);
        expect(totalsSql).toMatch(/b\.status = 'paid'/);
        // earned basis excludes tax + fee.
        expect(totalsSql).toMatch(/b\.total_cents - COALESCE\(b\.tax_cents/);
        // upcoming list is span-not-ended only, soonest-by-start first.
        expect(upcomingSql).toMatch(/date\(COALESCE\(e\.end_date_iso, e\.date_iso\)\)\s*>\s*\?/);
        expect(upcomingSql).toMatch(/ORDER BY date\(e\.date_iso\) ASC/);
    });

    it('requires authentication (401 without a session cookie)', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(makeReq(PATH), env, {});
        expect(res.status).toBe(401);
    });

    // ── The evening recognition-flip regression ────────────────────────────
    // recogDay is a DENVER calendar date (date_iso is naive Denver wall clock).
    // It used to be compared against SQLite date('now') — the UTC date — which
    // from 18:00 Mountain is already tomorrow. An event happening TOMORROW then
    // satisfied `recogDay <= today` and its prepaid cash moved out of deferred
    // into recognized, so the owner saw undelivered money booked as earned.
    it('binds the DENVER date, not the UTC date, in the evening band', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            // 20:30 MDT on 2026-07-25 — UTC has already rolled to the 26th.
            vi.setSystemTime(Date.parse('2026-07-26T02:30:00Z'));
            const env = createMockEnv();
            const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

            let totalsBinds = null;
            let upcomingBinds = null;
            env.DB.__on(/FROM bookings b\s+LEFT JOIN events e/, (sql, args) => {
                totalsBinds = args;
                return { deferred_cents: 0, recognized_cents: 0 };
            }, 'first');
            env.DB.__on(/FROM events e\s+JOIN bookings b/, (sql, args) => {
                upcomingBinds = args;
                return { results: [] };
            }, 'all');

            const res = await worker.fetch(
                makeReq(PATH, { headers: { cookie: cookieHeader } }), env, {},
            );
            expect(res.status).toBe(200);

            // Both slots of the totals CASE plus the upcoming filter.
            expect(totalsBinds).toEqual(['2026-07-25', '2026-07-25']);
            expect(upcomingBinds).toEqual(['2026-07-25']);
            // Guard the point: UTC would have said the 26th.
            expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-26');
        } finally {
            vi.useRealTimers();
        }
    });
});
