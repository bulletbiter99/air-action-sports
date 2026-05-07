// M4 B4d — tests for the ?period=mtd query param on
// GET /api/admin/analytics/overview.
//
// Pre-B4d behavior (lifetime aggregation across all bookings) is
// preserved when ?period is omitted or set to 'lifetime'. ?period=mtd
// filters bookings.paid_at >= month_start_ms (UTC month start).

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const PATH = '/api/admin/analytics/overview';

describe('GET /api/admin/analytics/overview — ?period filter', () => {
    it('?period omitted defaults to lifetime (no paid_at filter binding)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedByStatusBinds = null;
        let capturedByStatusSql = '';
        env.DB.__on(/FROM bookings\s+(?:WHERE [^ ]+\s+)?GROUP BY status/, (sql, args) => {
            capturedByStatusBinds = args;
            capturedByStatusSql = sql;
            return { results: [{ status: 'paid', n: 10, gross_cents: 100000 }] };
        }, 'all');
        env.DB.__on(/FROM attendees a\s+JOIN bookings b/, {
            n: 10, checked_in: 5, waivers_signed: 7,
        }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        // No bind should be passed (no eventId, no MTD)
        expect(capturedByStatusBinds).toEqual([]);
        // SQL should not include paid_at filter
        expect(capturedByStatusSql).not.toMatch(/paid_at >=/);
    });

    it('?period=lifetime explicit also returns no paid_at filter', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedSql = '';
        env.DB.__on(/FROM bookings\s+(?:WHERE [^ ]+\s+)?GROUP BY status/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 0, checked_in: 0, waivers_signed: 0 }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?period=lifetime`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(capturedSql).not.toMatch(/paid_at >=/);
    });

    it('?period=mtd adds paid_at >= bind for byStatus query', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedByStatusBinds = null;
        let capturedByStatusSql = '';
        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY status/, (sql, args) => {
            capturedByStatusSql = sql;
            capturedByStatusBinds = args;
            return { results: [{ status: 'paid', n: 5, gross_cents: 50000 }] };
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 5, checked_in: 2, waivers_signed: 3 }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?period=mtd`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(capturedByStatusSql).toMatch(/paid_at >= \?/);
        expect(capturedByStatusBinds).toHaveLength(1);
        // The bind should be a UTC month-start ms value (1st of current month, midnight UTC)
        const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
        expect(capturedByStatusBinds[0]).toBe(monthStart);
    });

    it('?period=mtd also scopes the attendee join via b.paid_at filter', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedAttSql = '';
        let capturedAttBinds = null;
        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY status/, { results: [] }, 'all');
        env.DB.__on(/FROM attendees a/, (sql, args) => {
            capturedAttSql = sql;
            capturedAttBinds = args;
            return { n: 0, checked_in: 0, waivers_signed: 0 };
        }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?period=mtd`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(capturedAttSql).toMatch(/b\.paid_at >= \?/);
        expect(capturedAttBinds).toHaveLength(1);
    });

    it('?period=invalid returns 400', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        const res = await worker.fetch(
            makeReq(`${PATH}?period=ytd`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });

    it('?period=mtd combined with ?event_id binds both filters', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        let capturedBinds = null;
        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY status/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 0, checked_in: 0, waivers_signed: 0 }, 'first');

        await worker.fetch(
            makeReq(`${PATH}?event_id=evt_1&period=mtd`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        // event_id + month_start
        expect(capturedBinds).toHaveLength(2);
        expect(capturedBinds[0]).toBe('evt_1');
        const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
        expect(capturedBinds[1]).toBe(monthStart);
    });

    it('returns the same response shape regardless of period', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings[\s\S]*?GROUP BY status/, {
            results: [{ status: 'paid', n: 3, gross_cents: 30000, tax_cents: 0, fee_cents: 0 }],
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 3, checked_in: 1, waivers_signed: 2 }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?period=mtd`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json).toHaveProperty('byStatus');
        expect(json).toHaveProperty('totals');
        expect(json.totals).toHaveProperty('bookings');
        expect(json.totals).toHaveProperty('paidCount');
        expect(json.totals).toHaveProperty('netRevenueCents');
        expect(json.totals).toHaveProperty('grossRevenueCents');
        expect(json.totals).toHaveProperty('refundedCents');
        expect(json.totals).toHaveProperty('avgOrderCents');
        expect(json.totals).toHaveProperty('refundRate');
        expect(json.totals).toHaveProperty('attendees');
        expect(json.totals).toHaveProperty('checkedIn');
        expect(json.totals).toHaveProperty('waiversSigned');
        // M4 B4f — tax + fee totals added to the response
        expect(json.totals).toHaveProperty('taxCents');
        expect(json.totals).toHaveProperty('feeCents');
    });
});

describe('GET /api/admin/analytics/overview — tax + fee totals (M4 B4f)', () => {
    it('aggregates taxCents + feeCents from paid + comp byStatus rows', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings[\s\S]*?GROUP BY status/, {
            results: [
                { status: 'paid', n: 10, gross_cents: 100000, tax_cents: 8500, fee_cents: 2900 },
                { status: 'comp', n: 2, gross_cents: 0, tax_cents: 0, fee_cents: 0 },
                { status: 'refunded', n: 1, gross_cents: 5000, tax_cents: 425, fee_cents: 145 },
            ],
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 12, checked_in: 0, waivers_signed: 8 }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        // taxCents = paid.tax_cents + comp.tax_cents (refunded excluded)
        expect(json.totals.taxCents).toBe(8500);
        expect(json.totals.feeCents).toBe(2900);
    });

    it('returns taxCents=0 + feeCents=0 when no paid/comp bookings exist', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings[\s\S]*?GROUP BY status/, {
            results: [{ status: 'pending', n: 3, gross_cents: 0, tax_cents: 0, fee_cents: 0 }],
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 0, checked_in: 0, waivers_signed: 0 }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.totals.taxCents).toBe(0);
        expect(json.totals.feeCents).toBe(0);
    });

    it('byStatus rows include taxCents + feeCents per status (extended shape)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings[\s\S]*?GROUP BY status/, {
            results: [{ status: 'paid', n: 5, gross_cents: 50000, tax_cents: 4250, fee_cents: 1450 }],
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 5, checked_in: 0, waivers_signed: 0 }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.byStatus.paid).toMatchObject({
            count: 5,
            grossCents: 50000,
            taxCents: 4250,
            feeCents: 1450,
        });
    });

    it('?period=mtd response also includes taxCents + feeCents totals', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM bookings\s+WHERE[\s\S]+?GROUP BY status/, {
            results: [{ status: 'paid', n: 3, gross_cents: 30000, tax_cents: 2550, fee_cents: 870 }],
        }, 'all');
        env.DB.__on(/FROM attendees a/, { n: 3, checked_in: 0, waivers_signed: 0 }, 'first');

        const res = await worker.fetch(
            makeReq(`${PATH}?period=mtd`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const json = await res.json();
        expect(json.totals.taxCents).toBe(2550);
        expect(json.totals.feeCents).toBe(870);
    });
});
