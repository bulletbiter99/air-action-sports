// M5 R10 — admin labor entries route tests.
// POST /api/admin/labor-entries with the $200 self-approval cap from
// decision register #54. Tax-year-lock blocks entries against locked
// years. PUT/POST mark-paid/dispute/resolve transitions verified.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

// C9 — approve/reject/mark-paid/PUT now SELECT the entry first (they need its
// tax_year for the lock check). Default: a pending-approval manual entry in an
// unlocked year (tax_year_locks SELECT falls through to mockD1's null default).
function bindEntry(extra = {}) {
    env.DB.__on(/SELECT \* FROM labor_entries WHERE id = \?/, {
        id: 'le_001', person_id: 'prs_1', source: 'manual_entry',
        worked_at: Date.UTC(2026, 5, 15), hours: null,
        pay_kind: '1099_hourly', amount_cents: 50000, notes: null,
        approval_required: 1, approved_at: null, rejected_at: null, paid_at: null,
        tax_year: 2026,
        ...extra,
    }, 'first');
}

describe('GET /api/admin/labor-entries', () => {
    it('returns 400 when neither person_id nor tax_year is provided', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.read']);

        const req = new Request('https://airactionsport.com/api/admin/labor-entries', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 403 when caller lacks staff.schedule.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);

        const req = new Request('https://airactionsport.com/api/admin/labor-entries?person_id=prs_1', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('binds person_id parameter to the SQL query', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.read']);
        env.DB.__on(/FROM labor_entries WHERE/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries?person_id=prs_1', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /FROM labor_entries WHERE/.test(w.sql));
        expect(listQuery).toBeDefined();
        expect(listQuery.args).toContain('prs_1');
    });
});

describe('POST /api/admin/labor-entries', () => {
    it('returns 400 when required fields missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);

        const req = new Request('https://airactionsport.com/api/admin/labor-entries', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: 'prs_1' }), // missing workedAt + payKind + amountCents
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 403 when caller lacks staff.schedule.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.read']);

        const req = new Request('https://airactionsport.com/api/admin/labor-entries', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: 'prs_1', workedAt: Date.now(),
                payKind: 'volunteer', amountCents: 0,
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 409 when the worked_at year has a tax_year_lock', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        env.DB.__on(/SELECT \* FROM tax_year_locks/, { tax_year: 2025, locked_at: 1, locked_by_user_id: 'u_admin' }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: 'prs_1',
                workedAt: Date.UTC(2025, 5, 15),
                payKind: 'w2_hourly',
                amountCents: 5000,
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toMatch(/locked/i);
    });

    it('happy path manual_entry under cap: approval_required=false in response', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        env.DB.__on(/SELECT \* FROM tax_year_locks/, null, 'first');
        env.DB.__on(/INSERT INTO labor_entries/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: 'prs_1',
                workedAt: Date.now(),
                source: 'manual_entry',
                payKind: 'w2_hourly',
                amountCents: 15000, // $150 — under $200 cap
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toMatch(/^le_/);
        expect(body.approvalRequired).toBe(false);

        const writes = env.DB.__writes();
        const insertWrite = writes.find((w) => /INSERT INTO labor_entries/.test(w.sql));
        expect(insertWrite).toBeDefined();
        // approval_required column = 10th positional bind (after id/person/event/source/workedAt/hours/payKind/amount/notes)
        expect(insertWrite.args).toContain(0); // approval_required = 0 when under cap
    });

    it('happy path manual_entry over $200 cap: approval_required=true', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        env.DB.__on(/SELECT \* FROM tax_year_locks/, null, 'first');
        env.DB.__on(/INSERT INTO labor_entries/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: 'prs_1',
                workedAt: Date.now(),
                source: 'manual_entry',
                payKind: '1099_hourly',
                amountCents: 50000, // $500 — over cap
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.approvalRequired).toBe(true);

        const writes = env.DB.__writes();
        const insertWrite = writes.find((w) => /INSERT INTO labor_entries/.test(w.sql));
        expect(insertWrite).toBeDefined();
        // approval_required = 1 when over cap
        expect(insertWrite.args).toContain(1);
    });

    it('event_completion source bypasses the $200 cap (system-generated, not ad-hoc)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        env.DB.__on(/SELECT \* FROM tax_year_locks/, null, 'first');
        env.DB.__on(/INSERT INTO labor_entries/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: 'prs_1',
                workedAt: Date.now(),
                source: 'event_completion',
                payKind: '1099_per_event',
                amountCents: 50000, // $500 — over cap, but event_completion bypasses
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.approvalRequired).toBe(false); // bypassed
    });
});

describe('POST /api/admin/labor-entries/:id/approve', () => {
    it('returns 404 when row not in approvable state (already approved or wrong flag)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry();
        env.DB.__on(/UPDATE labor_entries SET approved_at/, { meta: { changes: 0 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/approve', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('happy path: flips approved_at + approved_by_user_id, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry();
        env.DB.__on(/UPDATE labor_entries SET approved_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/approve', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'labor_entry.approved')).toBe(true);
    });
});

describe('POST /api/admin/labor-entries/:id/mark-paid', () => {
    it('returns 403 when caller lacks staff.schedule.mark_paid', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/mark-paid', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentReference: 'venmo:abc123' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 404 when row already paid', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.mark_paid']);
        bindEntry();
        env.DB.__on(/UPDATE labor_entries SET paid_at/, { meta: { changes: 0 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/mark-paid', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentReference: 'venmo:abc123' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('happy path: stamps paid_at, payment_reference, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.mark_paid']);
        bindEntry();
        env.DB.__on(/UPDATE labor_entries SET paid_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/mark-paid', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentReference: 'venmo:abc123' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const updateWrite = writes.find((w) => /UPDATE labor_entries SET paid_at/.test(w.sql));
        expect(updateWrite).toBeDefined();
        expect(updateWrite.args).toContain('venmo:abc123');
    });
});

describe('dispute / resolve flow', () => {
    it('dispute returns 404 when already disputed', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.read']);
        env.DB.__on(/UPDATE labor_entries SET disputed_at/, { meta: { changes: 0 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/dispute', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'wrong amount' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('dispute happy path: stamps disputed_at, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.read']);
        env.DB.__on(/UPDATE labor_entries SET disputed_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/dispute', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'wrong amount' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'labor_entry.disputed')).toBe(true);
    });

    it('resolve happy path: stamps resolved_at + audit "labor_entry.resolved"', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.dispute_resolve']);
        env.DB.__on(/UPDATE labor_entries SET resolved_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/resolve', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'corrected amount' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'labor_entry.resolved')).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────
// Sprint 4 C9 — PUT edit, reject, and tax-year-lock enforcement
// ────────────────────────────────────────────────────────────────────

function putReq(body) {
    return new Request('https://airactionsport.com/api/admin/labor-entries/le_001', {
        method: 'PUT',
        headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('PUT /api/admin/labor-entries/:id (C9 — pre-approval edit)', () => {
    it('403 when caller lacks staff.schedule.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.read']);
        bindEntry();
        expect((await worker.fetch(putReq({ amountCents: 100 }), env, {})).status).toBe(403);
    });

    it('404 when the entry is missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        expect((await worker.fetch(putReq({ amountCents: 100 }), env, {})).status).toBe(404);
    });

    it('409 once the entry is approved (no post-approval edits)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry({ approved_at: 123 });
        const res = await worker.fetch(putReq({ amountCents: 100 }), env, {});
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/not yet approved/i);
    });

    it('400 for w2_salary — the CHECK never permits it (pins the app-side mirror)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry();
        const res = await worker.fetch(putReq({ payKind: 'w2_salary' }), env, {});
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/payKind/);
    });

    it('409 when the entry sits in a locked tax year', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry({ tax_year: 2025 });
        env.DB.__on(/SELECT \* FROM tax_year_locks/, { tax_year: 2025, locked_at: 1 }, 'first');
        const res = await worker.fetch(putReq({ amountCents: 100 }), env, {});
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/locked/i);
    });

    it('happy edit: updates fields, RECOMPUTES approval_required from the new amount, audits', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        // A $150 manual entry (under cap, approval_required=0)…
        bindEntry({ amount_cents: 15000, approval_required: 0 });
        env.DB.__on(/UPDATE labor_entries\s+SET worked_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        // …edited up to $500 must go BACK through the approval gate.
        const res = await worker.fetch(putReq({ amountCents: 50000, notes: 'corrected rate' }), env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.approvalRequired).toBe(true);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE labor_entries\s+SET worked_at/.test(w.sql));
        expect(update).toBeDefined();
        expect(update.args).toContain(50000);
        expect(update.args).toContain('corrected rate');

        const audit = writes.find((w) => w.args?.some?.((a) => a === 'labor_entry.updated'));
        expect(audit).toBeDefined();
    });
});

describe('POST /api/admin/labor-entries/:id/reject (C9)', () => {
    function rejectReq(body) {
        return new Request('https://airactionsport.com/api/admin/labor-entries/le_001/reject', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    it('400 when no reason is given (a rejection must say why)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry();
        const res = await worker.fetch(rejectReq({}), env, {});
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/reason/i);
    });

    it('403 when caller lacks staff.schedule.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.read']);
        bindEntry();
        expect((await worker.fetch(rejectReq({ reason: 'dup' }), env, {})).status).toBe(403);
    });

    it('409 when the entry is not in a rejectable state', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry();
        env.DB.__on(/UPDATE labor_entries SET rejected_at/, { meta: { changes: 0 } }, 'run');
        expect((await worker.fetch(rejectReq({ reason: 'dup' }), env, {})).status).toBe(409);
    });

    it('happy path: stamps rejected_at + rejection_reason, audits with the reason', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry();
        env.DB.__on(/UPDATE labor_entries SET rejected_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(rejectReq({ reason: 'duplicate of le_000' }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE labor_entries SET rejected_at/.test(w.sql));
        expect(update).toBeDefined();
        expect(update.args).toContain('duplicate of le_000');
        const audit = writes.find((w) => w.args?.some?.((a) => a === 'labor_entry.rejected'));
        expect(audit).toBeDefined();
    });
});

describe('tax-year-lock enforcement on approve/mark-paid (C9)', () => {
    it('approve 409s for a locked year', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.write']);
        bindEntry({ tax_year: 2025 });
        env.DB.__on(/SELECT \* FROM tax_year_locks/, { tax_year: 2025, locked_at: 1 }, 'first');
        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/approve', {
            method: 'POST', headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        // The guarded UPDATE was never reached.
        expect(env.DB.__writes().some((w) => /UPDATE labor_entries SET approved_at/.test(w.sql))).toBe(false);
    });

    it('mark-paid 409s for a locked year', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.schedule.mark_paid']);
        bindEntry({ tax_year: 2025, approved_at: 123 });
        env.DB.__on(/SELECT \* FROM tax_year_locks/, { tax_year: 2025, locked_at: 1 }, 'first');
        const req = new Request('https://airactionsport.com/api/admin/labor-entries/le_001/mark-paid', {
            method: 'POST', headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentReference: 'check #9' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        expect(env.DB.__writes().some((w) => /UPDATE labor_entries SET paid_at/.test(w.sql))).toBe(false);
    });
});
