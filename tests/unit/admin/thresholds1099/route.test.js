// M5 R11 — admin 1099 thresholds route tests.
// GET / returns the rollup with locked banner reflected; GET /export
// returns IRS-formatted CSV; POST /lock-year inserts a tax_year_locks
// row + writes audit. All three endpoints are capability-gated.

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

describe('GET /api/admin/1099-thresholds', () => {
    it('returns 403 when caller lacks staff.thresholds_1099.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 200 with rollup shape and threshold_cents=60000', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.read']);
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, null, 'first');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.tax_year).toBe(2025);
        expect(body.threshold_cents).toBe(60000);
        expect(body.locked).toBe(false);
        expect(body.recipients).toEqual([]);
    });

    it('reflects locked=true and locked_reason in response when year is locked', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.read']);
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: 1700000000000, locked_reason: 'manual_close',
        }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.locked).toBe(true);
        expect(body.locked_reason).toBe('manual_close');
        expect(body.locked_at).toBe(1700000000000);
    });

    it('maps recipients to camelCase shape with requires1099 boolean', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.read']);
        env.DB.__on(/FROM labor_entries le/, {
            results: [
                {
                    person_id: 'prs_1', full_name: 'Jane Doe',
                    email: 'jane@example.com', legal_name: 'Jane Doe', ein: '12-3456789',
                    total_1099_cents: 75000, total_w2_cents: 0,
                    entry_count: 5, first_entry_at: 1, last_entry_at: 2, unpaid_count: 0,
                },
                {
                    person_id: 'prs_2', full_name: 'Bob',
                    email: 'b@e.com', legal_name: null, ein: null,
                    total_1099_cents: 30000, total_w2_cents: 0,
                    entry_count: 2, first_entry_at: 1, last_entry_at: 1, unpaid_count: 0,
                },
            ],
        }, 'all');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, null, 'first');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.recipients).toHaveLength(2);
        expect(body.recipients[0]).toMatchObject({
            personId: 'prs_1', fullName: 'Jane Doe', requires1099: true,
        });
        expect(body.recipients[1]).toMatchObject({
            personId: 'prs_2', requires1099: false,
        });
    });

    it('defaults tax_year to current calendar year when not provided', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.read']);
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, null, 'first');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.tax_year).toBe(new Date().getUTCFullYear());
    });
});

describe('GET /api/admin/1099-thresholds/export', () => {
    it('returns 403 when caller lacks staff.thresholds_1099.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.read']);

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/export?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 200 with text/csv content-type and attachment disposition', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.export']);
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/export?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
        expect(res.headers.get('Content-Disposition')).toContain('1099-thresholds-2025.csv');
    });

    it('CSV body contains the IRS-format header line', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.export']);
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/export?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.text();
        expect(body.split('\n')[0]).toBe(
            'Person ID,Full Name,Legal Name,EIN,Email,1099 Total (USD),Requires 1099-NEC'
        );
    });

    it('writes a data row when recipients are present', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.export']);
        env.DB.__on(/FROM labor_entries le/, {
            results: [{
                person_id: 'prs_1', full_name: 'Jane', legal_name: 'Jane Doe',
                ein: '12-3456789', email: 'j@e.com', total_1099_cents: 75000,
                total_w2_cents: 0, entry_count: 1, first_entry_at: 1, last_entry_at: 1, unpaid_count: 0,
            }],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/export?tax_year=2025', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.text();
        const lines = body.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('"prs_1"');
        expect(lines[1]).toContain('750.00');
        expect(lines[1]).toContain('YES');
    });
});

describe('POST /api/admin/1099-thresholds/lock-year', () => {
    it('returns 403 when caller lacks staff.thresholds_1099.lock_year', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.read']);

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/lock-year', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ taxYear: 2025 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 400 when taxYear is missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.lock_year']);

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/lock-year', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when taxYear is out of range (<2020 or >2100)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.lock_year']);

        for (const year of [2019, 2101, 9999]) {
            const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/lock-year', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ taxYear: year }),
            });
            const res = await worker.fetch(req, env, {});
            expect(res.status).toBe(400);
        }
    });

    it('returns 409 when year is already locked', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.lock_year']);
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: 1700000000000, locked_reason: 'manual_close',
        }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/lock-year', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ taxYear: 2025 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
    });

    it('inserts the lock row + writes audit on happy path with manual_close reason', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.thresholds_1099.lock_year']);
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, null, 'first');
        env.DB.__on(/FROM labor_entries WHERE tax_year = \?/, { w2: 100000, k1099: 50000 }, 'first');
        env.DB.__on(/INSERT INTO tax_year_locks/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/1099-thresholds/lock-year', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ taxYear: 2025, notes: 'CPA-reviewed' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toMatchObject({ ok: true, taxYear: 2025 });

        const writes = env.DB.__writes();
        const insertLock = writes.find((w) => /INSERT INTO tax_year_locks/.test(w.sql));
        expect(insertLock).toBeDefined();
        expect(insertLock.args).toContain(2025);
        expect(insertLock.args).toContain('manual_close');
        expect(insertLock.args).toContain('u_owner');
        expect(insertLock.args).toContain('CPA-reviewed');

        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'tax_year.locked')
        );
        expect(auditWrite).toBeDefined();
    });
});
