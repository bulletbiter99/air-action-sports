// Cash-flow forecast route tests (GET /api/admin/cash-flow). Gated on
// finances.read. The 3 D1 reads (trailing earned revenue, FR payments,
// budgets) are mocked; the helper math is covered in cashFlow.test.js.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';

let env;
let cookieHeader;

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
    bindCapabilities(env.DB, 'u_owner', ['finances.read']);
    // Default data: no FR payments, no budgets.
    env.DB.__on(/FROM field_rental_payments/, { results: [] }, 'all');
    env.DB.__on(/FROM budgets WHERE period/, { results: [] }, 'all');
});

describe('GET /api/admin/cash-flow', () => {
    it('403 without finances.read', async () => {
        const e2 = createMockEnv();
        const s2 = await createAdminSession(e2, { id: 'u_owner', role: 'owner' });
        bindCapabilities(e2.DB, 'u_owner', ['reports.read']);
        const res = await worker.fetch(req('/api/admin/cash-flow', { headers: { cookie: s2.cookieHeader } }), e2, {});
        expect(res.status).toBe(403);
    });

    it('returns 13 weekly rows + a derived run-rate from trailing revenue', async () => {
        // Trailing 8wk earned = $800 → run-rate $100/week.
        env.DB.__on(/AS earned\s+FROM bookings/, { earned: 80000 }, 'first');
        const res = await worker.fetch(req('/api/admin/cash-flow?opening_cents=500000', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.horizonWeeks).toBe(13);
        expect(data.rows).toHaveLength(13);
        expect(data.openingCents).toBe(500000);
        expect(data.assumptions.revenueDerived).toBe(true);
        expect(data.assumptions.weeklyRevenueCents).toBe(10000); // 80000 / 8
        // With no budgets/FR, each week just adds the run-rate.
        expect(data.rows[0].openingCents).toBe(500000);
        expect(data.rows[0].receiptsCents).toBe(10000);
        expect(data.rows[12].closingCents).toBe(500000 + 13 * 10000);
        expect(typeof data.minClosingCents).toBe('number');
    });

    it('honors a weekly_revenue_cents override (no trailing query needed)', async () => {
        let trailingQueried = false;
        env.DB.__on(/AS earned\s+FROM bookings/, () => { trailingQueried = true; return { earned: 999999 }; }, 'first');
        const res = await worker.fetch(req('/api/admin/cash-flow?opening_cents=0&weekly_revenue_cents=25000', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.assumptions.revenueDerived).toBe(false);
        expect(data.assumptions.weeklyRevenueCents).toBe(25000);
        expect(trailingQueried).toBe(false);
        expect(data.rows[0].receiptsCents).toBe(25000);
    });

    it('401 without an admin session', async () => {
        const res = await worker.fetch(req('/api/admin/cash-flow'), env, {});
        expect(res.status).toBe(401);
    });
});
