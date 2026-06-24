// Expenses + Budgets admin route tests (migration 0074 / finances.js).
// Capability-gated on finances.read / finances.write — tests bind those
// caps via bindCapabilities (per the post-M7 requireCapability lesson).

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
function jsonReq(path, method, body) {
    return req(path, {
        method,
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
    bindCapabilities(env.DB, 'u_owner', ['finances.read', 'finances.write']);
});

describe('GET /api/admin/expenses', () => {
    it('403 without finances.read', async () => {
        const e2 = createMockEnv();
        const s2 = await createAdminSession(e2, { id: 'u_owner', role: 'owner' });
        bindCapabilities(e2.DB, 'u_owner', ['bookings.read']); // no finances.*
        const res = await worker.fetch(req('/api/admin/expenses', { headers: { cookie: s2.cookieHeader } }), e2, {});
        expect(res.status).toBe(403);
    });

    it('lists expenses with a totalCents sum + category catalog', async () => {
        env.DB.__on(/FROM expenses/, {
            results: [
                { id: 'exp_1', category: 'field_rent', description: 'July field lease', amount_cents: 120000, incurred_at: 100, vendor: 'Ghost Town', event_id: null, notes: null, created_by: 'u_owner', created_at: 1, updated_at: 1 },
                { id: 'exp_2', category: 'consumables', description: 'BBs', amount_cents: 5000, incurred_at: 200, vendor: null, event_id: 'ev_x', notes: null, created_by: 'u_owner', created_at: 1, updated_at: 1 },
            ],
        }, 'all');

        const res = await worker.fetch(req('/api/admin/expenses', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.expenses).toHaveLength(2);
        expect(data.expenses[0].amountCents).toBe(120000);
        expect(data.totalCents).toBe(125000);
        expect(data.categories.some((c) => c.key === 'field_rent')).toBe(true);
    });

    it('passes incurred_at + category filters as binds', async () => {
        let captured = null;
        env.DB.__on(/FROM expenses/, (sql, args) => { captured = { sql, args }; return { results: [] }; }, 'all');
        await worker.fetch(req('/api/admin/expenses?start=1000&end=2000&category=marketing', { headers: { cookie: cookieHeader } }), env, {});
        expect(captured.sql).toMatch(/incurred_at >= \?/);
        expect(captured.sql).toMatch(/category = \?/);
        expect(captured.args).toEqual([1000, 2000, 'marketing']);
    });
});

describe('POST /api/admin/expenses', () => {
    it('creates an expense (201) and returns it', async () => {
        env.DB.__on(/FROM expenses WHERE id = \?/, (sql, args) => ({
            id: args[0], category: 'consumables', description: 'Green gas', amount_cents: 4200,
            incurred_at: 5, vendor: 'Evike', event_id: null, notes: null, created_by: 'u_owner', created_at: 5, updated_at: 5,
        }), 'first');

        const res = await worker.fetch(
            jsonReq('/api/admin/expenses', 'POST', { category: 'consumables', description: 'Green gas', amountCents: 4200, vendor: 'Evike' }),
            env, {},
        );
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.expense.category).toBe('consumables');
        expect(data.expense.amountCents).toBe(4200);
        // An INSERT INTO expenses was issued.
        expect(env.DB.__writes().some((w) => /INSERT INTO expenses/.test(w.sql))).toBe(true);
    });

    it('rejects an unknown category (400)', async () => {
        const res = await worker.fetch(
            jsonReq('/api/admin/expenses', 'POST', { category: 'snacks', amountCents: 100 }), env, {},
        );
        expect(res.status).toBe(400);
    });

    it('rejects a non-positive / non-integer amount (400)', async () => {
        const bad = await worker.fetch(jsonReq('/api/admin/expenses', 'POST', { category: 'other', amountCents: 0 }), env, {});
        expect(bad.status).toBe(400);
        const neg = await worker.fetch(jsonReq('/api/admin/expenses', 'POST', { category: 'other', amountCents: -5 }), env, {});
        expect(neg.status).toBe(400);
    });

    it('403 when the viewer only has finances.read (write required)', async () => {
        const e2 = createMockEnv();
        const s2 = await createAdminSession(e2, { id: 'u_owner', role: 'owner' });
        bindCapabilities(e2.DB, 'u_owner', ['finances.read']); // read but not write
        const res = await worker.fetch(
            req('/api/admin/expenses', { method: 'POST', headers: { cookie: s2.cookieHeader, 'content-type': 'application/json' }, body: JSON.stringify({ category: 'other', amountCents: 100 }) }),
            e2, {},
        );
        expect(res.status).toBe(403);
    });
});

describe('PUT / DELETE /api/admin/expenses/:id', () => {
    it('404 on update of a missing expense', async () => {
        env.DB.__on(/FROM expenses WHERE id = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/expenses/exp_missing', 'PUT', { amountCents: 999 }), env, {});
        expect(res.status).toBe(404);
    });

    it('deletes an existing expense (200) and 404 when missing', async () => {
        env.DB.__on(/FROM expenses WHERE id = \?/, { id: 'exp_1', category: 'other', amount_cents: 100 }, 'first');
        const ok = await worker.fetch(req('/api/admin/expenses/exp_1', { method: 'DELETE', headers: { cookie: cookieHeader } }), env, {});
        expect(ok.status).toBe(200);
        expect((await ok.json()).deleted).toBe(true);

        const e2 = createMockEnv();
        const s2 = await createAdminSession(e2, { id: 'u_owner', role: 'owner' });
        bindCapabilities(e2.DB, 'u_owner', ['finances.read', 'finances.write']);
        e2.DB.__on(/FROM expenses WHERE id = \?/, null, 'first');
        const miss = await worker.fetch(req('/api/admin/expenses/exp_x', { method: 'DELETE', headers: { cookie: s2.cookieHeader } }), e2, {});
        expect(miss.status).toBe(404);
    });
});

describe('budgets — GET / PUT upsert / DELETE', () => {
    it('lists budgets', async () => {
        env.DB.__on(/FROM budgets/, {
            results: [{ id: 'bud_1', period: '2026-07', category: 'payroll', budgeted_cents: 300000, notes: null, created_at: 1, updated_at: 1 }],
        }, 'all');
        const res = await worker.fetch(req('/api/admin/budgets?period=2026-07', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.budgets[0].budgetedCents).toBe(300000);
    });

    it('creates a new budget (201) when none exists for (period, category)', async () => {
        env.DB.__on(/FROM budgets WHERE period = \? AND category = \?/, null, 'first');
        env.DB.__on(/FROM budgets WHERE id = \?/, (sql, args) => ({
            id: args[0], period: '2026-07', category: 'marketing', budgeted_cents: 50000, notes: null, created_at: 1, updated_at: 1,
        }), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/budgets', 'PUT', { period: '2026-07', category: 'marketing', budgetedCents: 50000 }), env, {});
        expect(res.status).toBe(201);
        expect((await res.json()).budget.budgetedCents).toBe(50000);
    });

    it('updates the existing budget (200) when one exists', async () => {
        env.DB.__on(/FROM budgets WHERE period = \? AND category = \?/, { id: 'bud_9', period: '2026-07', category: 'marketing', budgeted_cents: 40000 }, 'first');
        env.DB.__on(/FROM budgets WHERE id = \?/, { id: 'bud_9', period: '2026-07', category: 'marketing', budgeted_cents: 60000, notes: null, created_at: 1, updated_at: 2 }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/budgets', 'PUT', { period: '2026-07', category: 'marketing', budgetedCents: 60000 }), env, {});
        expect(res.status).toBe(200);
        expect((await res.json()).budget.budgetedCents).toBe(60000);
        expect(env.DB.__writes().some((w) => /UPDATE budgets SET/.test(w.sql))).toBe(true);
    });

    it('rejects a malformed period (400)', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/budgets', 'PUT', { period: 'July', category: 'marketing', budgetedCents: 100 }), env, {});
        expect(res.status).toBe(400);
    });

    it('rejects an unknown category (400)', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/budgets', 'PUT', { period: '2026-07', category: 'snacks', budgetedCents: 100 }), env, {});
        expect(res.status).toBe(400);
    });

    it('404 on delete of a missing budget', async () => {
        env.DB.__on(/FROM budgets WHERE id = \?/, null, 'first');
        const res = await worker.fetch(req('/api/admin/budgets/bud_x', { method: 'DELETE', headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(404);
    });
});
