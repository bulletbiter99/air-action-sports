// Tests for GET /api/admin/analytics/sales-series.
//
// Endpoint: worker/routes/admin/analytics.js. Returns per-day
// bookings + players + gross revenue for a trailing N-day window.
// Powers the AdminAnalytics "Sales velocity" panel chart.
//
// Regression: refunded bookings used to be filtered out entirely
// (status IN ('paid','comp')), which silently erased their day's
// bar from the chart when a booking was refunded after the fact.
// They're now included, matching the bookkeeping convention from
// the overview/per-event fix (gross = lifetime received).

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const PATH = '/api/admin/analytics/sales-series';

describe('GET /api/admin/analytics/sales-series — refund accounting', () => {
    it('SQL filter includes refunded status so refunded days do not vanish', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY d/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        const res = await worker.fetch(
            makeReq(`${PATH}?days=30`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        // Filter should accept refunded rows…
        expect(capturedSql).toMatch(/status IN \('paid', 'comp', 'refunded'\)/);
        // …and gross_cents should count refunded total_cents (preserving
        // money-actually-received on the original paid_at day).
        expect(capturedSql).toMatch(/CASE WHEN status IN \('paid', 'refunded'\) THEN total_cents/);
    });

    it('refunded day still reports its original gross + bookings count', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        // A day safely inside the trailing 30-day window no matter when the
        // suite runs, derived the same way the endpoint keys its series days
        // (local midnight → toISOString date). A hardcoded date here rots:
        // the original '2026-05-09' fell out of the window on 2026-06-08 and
        // the test started failing on pure calendar time.
        const target = new Date();
        target.setDate(target.getDate() - 2);
        target.setHours(0, 0, 0, 0);
        const refundedDay = target.toISOString().slice(0, 10);

        // Simulate a window where that day had 2 refunded bookings ($320
        // total). Without the fix it would be a $0 day; with the fix it
        // shows its lifetime gross.
        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY d/, {
            results: [
                { d: refundedDay, bookings: 2, players: 4, gross_cents: 32000 },
            ],
        }, 'all');

        const res = await worker.fetch(
            makeReq(`${PATH}?days=30`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        const day = json.series.find((d) => d.date === refundedDay);
        expect(day).toBeDefined();
        expect(day.bookings).toBe(2);
        expect(day.players).toBe(4);
        expect(day.grossCents).toBe(32000);
    });

    it('event_id filter still scopes by event', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedBinds = null;
        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY d/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(`${PATH}?event_id=evt_abc&days=7`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        // 3 binds: start_ms, end_ms, event_id
        expect(capturedBinds).toHaveLength(3);
        expect(capturedBinds[2]).toBe('evt_abc');
    });

    it('returns a continuous series with zero-filled missing days', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY d/, { results: [] }, 'all');

        const res = await worker.fetch(
            makeReq(`${PATH}?days=7`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.days).toBe(7);
        expect(json.series).toHaveLength(7);
        expect(json.series.every((d) => d.grossCents === 0 && d.bookings === 0)).toBe(true);
    });
});
