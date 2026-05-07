// M4 Batch 2b — GET /api/admin/bookings rich-filter parameters.
//
// Existing parameters (event_id, status, q, from, to, limit, offset)
// preserved verbatim — Group E tests against POST /manual and POST /:id
// don't exercise the list endpoint, but downstream consumers may rely
// on the existing param names. New params added in B2b:
//
//   payment_method  → exact match
//   has_refund      → 'true' | 'false' against refunded_at
//   waiver_status   → 'complete' | 'missing' | 'partial' subquery on attendees
//   min_amount      → total_cents >= ?
//   max_amount      → total_cents <= ?
//   customer_id     → exact match (M3 B6 column)

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

function buildReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

async function fetchList(env, cookieHeader, query = '') {
    const res = await worker.fetch(
        buildReq(`/api/admin/bookings${query}`, { headers: { cookie: cookieHeader } }),
        env,
        {},
    );
    return res;
}

describe('GET /api/admin/bookings rich filters (M4 B2b)', () => {
    it('payment_method=cash binds the value into the WHERE clause', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '', capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql, args) => {
            capturedSql = sql; capturedBinds = args;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        const res = await fetchList(env, cookieHeader, '?payment_method=cash');
        expect(res.status).toBe(200);
        expect(capturedSql).toMatch(/payment_method = \?/);
        expect(capturedBinds).toContain('cash');
    });

    it('has_refund=true clause uses IS NOT NULL (no bind needed)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?has_refund=true');
        expect(capturedSql).toMatch(/refunded_at IS NOT NULL/);
        expect(capturedSql).not.toMatch(/refunded_at IS NULL/);
    });

    it('has_refund=false clause uses IS NULL (no bind needed)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?has_refund=false');
        expect(capturedSql).toMatch(/refunded_at IS NULL/);
        expect(capturedSql).not.toMatch(/refunded_at IS NOT NULL/);
    });

    it('min_amount + max_amount bind as Number values', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql, args) => {
            capturedBinds = args;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?min_amount=5000&max_amount=20000');
        expect(capturedBinds).toContain(5000);
        expect(capturedBinds).toContain(20000);
        // String "5000" should NOT appear — values must be coerced to Number
        expect(capturedBinds.includes('5000')).toBe(false);
    });

    it('customer_id binds verbatim', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '', capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql, args) => {
            capturedSql = sql; capturedBinds = args;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?customer_id=cus_abc');
        expect(capturedSql).toMatch(/customer_id = \?/);
        expect(capturedBinds).toContain('cus_abc');
    });

    it('waiver_status=complete uses HAVING SUM = 0 AND COUNT > 0', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?waiver_status=complete');
        expect(capturedSql).toMatch(/SELECT booking_id FROM attendees/);
        expect(capturedSql).toMatch(/HAVING SUM\(CASE WHEN waiver_id IS NULL THEN 1 ELSE 0 END\) = 0/);
        expect(capturedSql).toMatch(/COUNT\(\*\) > 0/);
    });

    it('waiver_status=missing uses HAVING SUM = COUNT(*)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?waiver_status=missing');
        expect(capturedSql).toMatch(/HAVING SUM\(CASE WHEN waiver_id IS NULL THEN 1 ELSE 0 END\) = COUNT\(\*\)/);
    });

    it('waiver_status=partial uses HAVING SUM BETWEEN 1 AND COUNT-1', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?waiver_status=partial');
        expect(capturedSql).toMatch(/HAVING SUM\(CASE WHEN waiver_id IS NULL THEN 1 ELSE 0 END\) BETWEEN 1 AND COUNT\(\*\) - 1/);
    });

    it('combines multiple new filters with AND, preserving existing filter names', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '', capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql, args) => {
            capturedSql = sql; capturedBinds = args;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?status=paid&payment_method=card&has_refund=false&min_amount=1000');
        // All four predicates AND'd together
        expect(capturedSql).toMatch(/status = \? AND payment_method = \? AND refunded_at IS NULL AND total_cents >= \?/);
        expect(capturedBinds.slice(0, 3)).toEqual(['paid', 'card', 1000]);
    });

    it('returns total + bookings array with rich filters applied', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, { n: 1 }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, {
            results: [{
                id: 'bk_1', event_id: 'ev_x', full_name: 'Alice',
                email: 'a@b.c', phone: null, player_count: 2,
                line_items_json: '[]', subtotal_cents: 16000, discount_cents: 0,
                tax_cents: 0, fee_cents: 0, total_cents: 16000,
                status: 'paid', payment_method: 'cash', stripe_payment_intent: null,
                created_at: 1000, paid_at: 1000, refunded_at: null,
                customer_id: 'cus_a', notes: null, pending_attendees_json: null,
                stripe_session_id: null, reminder_sent_at: null, reminder_1hr_sent_at: null,
                cancelled_at: null,
            }],
        }, 'all');

        const res = await fetchList(env, cookieHeader, '?status=paid&payment_method=cash');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total).toBe(1);
        expect(json.bookings).toHaveLength(1);
        expect(json.bookings[0].id).toBe('bk_1');
    });

    it('no new params → existing GET behavior preserved (M2 baseline)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM bookings/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM bookings/, { results: [] }, 'all');

        await fetchList(env, cookieHeader, '?status=paid');
        // Should NOT include any of the new filter clauses
        expect(capturedSql).not.toMatch(/payment_method/);
        expect(capturedSql).not.toMatch(/refunded_at/);
        expect(capturedSql).not.toMatch(/waiver_id/);
        expect(capturedSql).not.toMatch(/total_cents/);
        expect(capturedSql).not.toMatch(/customer_id/);
        expect(capturedSql).toMatch(/status = \?/);
    });
});
