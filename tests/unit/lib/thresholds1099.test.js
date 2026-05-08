// M5 R11 — pure helper + I/O wrapper + cron sweep tests for
// worker/lib/thresholds1099.js.
//
// The IRS 1099-NEC threshold is $600 per recipient per tax year.
// requires1099 is the boundary helper; aggregate / lock / cron tests
// exercise the full pipeline that the route + scheduled handler invoke.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    IRS_1099_THRESHOLD_CENTS,
    requires1099,
    previousTaxYear,
    shouldAutoLockToday,
    formatIrs1099Csv,
    formatGenericCsv,
    aggregate1099TotalsForYear,
    getYearLock,
    lockTaxYear,
    runTaxYearAutoLockSweep,
} from '../../../worker/lib/thresholds1099.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

describe('IRS_1099_THRESHOLD_CENTS', () => {
    it('is exactly $600.00 in cents', () => {
        expect(IRS_1099_THRESHOLD_CENTS).toBe(60000);
    });
});

describe('requires1099', () => {
    it('returns false below threshold', () => {
        expect(requires1099(0)).toBe(false);
        expect(requires1099(100)).toBe(false);
        expect(requires1099(59999)).toBe(false);
    });

    it('returns true at exactly the threshold (inclusive boundary)', () => {
        expect(requires1099(60000)).toBe(true);
    });

    it('returns true for any value above the threshold', () => {
        expect(requires1099(60001)).toBe(true);
        expect(requires1099(100000)).toBe(true);
        expect(requires1099(50_000_00)).toBe(true);
    });

    it('coerces null/undefined/string to 0 and returns false', () => {
        expect(requires1099(null)).toBe(false);
        expect(requires1099(undefined)).toBe(false);
        expect(requires1099('')).toBe(false);
    });
});

describe('previousTaxYear', () => {
    it('returns one less than the calendar year of `now`', () => {
        const may2026 = new Date('2026-05-08T00:00:00Z').getTime();
        expect(previousTaxYear(may2026)).toBe(2025);
    });

    it('handles January 1 boundary', () => {
        const jan1_2027 = new Date('2027-01-01T00:00:00Z').getTime();
        expect(previousTaxYear(jan1_2027)).toBe(2026);
    });

    it('handles December 31 boundary (still same calendar year)', () => {
        const dec31_2026 = new Date('2026-12-31T23:59:59Z').getTime();
        expect(previousTaxYear(dec31_2026)).toBe(2025);
    });

    it('accepts a Date instance directly', () => {
        expect(previousTaxYear(new Date('2026-06-01T00:00:00Z'))).toBe(2025);
    });

    it('uses Date.now() default — should not throw with no args', () => {
        const result = previousTaxYear();
        expect(result).toBeGreaterThan(2000);
        expect(result).toBeLessThan(2200);
    });
});

describe('shouldAutoLockToday', () => {
    it('returns false in January', () => {
        const jan15 = new Date('2026-01-15T03:00:00Z').getTime();
        expect(shouldAutoLockToday(jan15)).toBe(false);
    });

    it('returns false in February', () => {
        const feb28 = new Date('2026-02-28T03:00:00Z').getTime();
        expect(shouldAutoLockToday(feb28)).toBe(false);
    });

    it('returns true on March 1', () => {
        const mar1 = new Date('2026-03-01T03:00:00Z').getTime();
        expect(shouldAutoLockToday(mar1)).toBe(true);
    });

    it('returns true on March 15 (window stays open through month)', () => {
        const mar15 = new Date('2026-03-15T03:00:00Z').getTime();
        expect(shouldAutoLockToday(mar15)).toBe(true);
    });

    it('returns true after March (April–December)', () => {
        expect(shouldAutoLockToday(new Date('2026-04-01T03:00:00Z').getTime())).toBe(true);
        expect(shouldAutoLockToday(new Date('2026-12-31T23:59:59Z').getTime())).toBe(true);
    });
});

describe('formatIrs1099Csv', () => {
    it('returns a header line for empty rollup', () => {
        const csv = formatIrs1099Csv([]);
        expect(csv).toBe('Person ID,Full Name,Legal Name,EIN,Email,1099 Total (USD),Requires 1099-NEC');
    });

    it('formats one row with all fields populated', () => {
        const csv = formatIrs1099Csv([
            {
                personId: 'prs_001',
                fullName: 'Jane Doe',
                legalName: 'Jane A Doe',
                ein: '12-3456789',
                email: 'jane@example.com',
                total1099Cents: 75000,
            },
        ]);
        const lines = csv.split('\n');
        expect(lines.length).toBe(2);
        expect(lines[1]).toBe(
            '"prs_001","Jane Doe","Jane A Doe","12-3456789","jane@example.com",750.00,YES'
        );
    });

    it('marks rows below threshold as "no"', () => {
        const csv = formatIrs1099Csv([
            { personId: 'prs_002', fullName: 'Bob', total1099Cents: 50000 },
        ]);
        expect(csv).toContain(',no');
        expect(csv).not.toContain(',YES');
    });

    it('marks rows at exactly $600 as "YES"', () => {
        const csv = formatIrs1099Csv([
            { personId: 'prs_003', fullName: 'Carol', total1099Cents: 60000 },
        ]);
        expect(csv).toContain(',600.00,YES');
    });

    it('escapes double quotes in field values by doubling them', () => {
        const csv = formatIrs1099Csv([
            { personId: 'prs_004', fullName: 'Dave "the kid" Smith', total1099Cents: 70000 },
        ]);
        expect(csv).toContain('"Dave ""the kid"" Smith"');
    });

    it('coerces null/undefined fields to empty quoted strings', () => {
        const csv = formatIrs1099Csv([
            { personId: 'prs_005', fullName: 'Eve', total1099Cents: 65000 },
        ]);
        const dataLine = csv.split('\n')[1];
        // legalName, ein, email all missing → ""
        expect(dataLine).toContain('"prs_005","Eve","","","",650.00,YES');
    });
});

describe('formatGenericCsv', () => {
    it('includes W-2 total, entry count, and unpaid count columns', () => {
        const csv = formatGenericCsv([
            {
                personId: 'prs_001',
                fullName: 'Jane',
                legalName: 'Jane Doe',
                ein: '12-3456789',
                email: 'j@e.com',
                total1099Cents: 75000,
                totalW2Cents: 150000,
                entryCount: 14,
                unpaidCount: 2,
            },
        ]);
        const lines = csv.split('\n');
        expect(lines[0]).toContain('W-2 Total (USD)');
        expect(lines[0]).toContain('Entry Count');
        expect(lines[0]).toContain('Unpaid Count');
        expect(lines[1]).toContain('1500.00');
        expect(lines[1]).toContain(',14,');
        expect(lines[1]).toContain(',2,');
    });

    it('returns header-only string for empty rollup', () => {
        expect(formatGenericCsv([]).split('\n').length).toBe(1);
    });
});

describe('aggregate1099TotalsForYear', () => {
    let env;

    beforeEach(() => {
        env = createMockEnv();
    });

    it('binds the tax year argument to the aggregation query', async () => {
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        await aggregate1099TotalsForYear(env, 2025);

        const writes = env.DB.__writes();
        const aggQuery = writes.find((w) => /FROM labor_entries le/.test(w.sql));
        expect(aggQuery).toBeDefined();
        expect(aggQuery.args).toContain(2025);
    });

    it('maps snake_case row fields to camelCase response shape', async () => {
        env.DB.__on(/FROM labor_entries le/, {
            results: [{
                person_id: 'prs_1',
                full_name: 'Jane',
                email: 'j@e.com',
                legal_name: 'Jane Doe',
                ein: '12-3456789',
                total_1099_cents: 75000,
                total_w2_cents: 0,
                entry_count: 5,
                first_entry_at: 1700000000000,
                last_entry_at: 1700100000000,
                unpaid_count: 1,
            }],
        }, 'all');

        const result = await aggregate1099TotalsForYear(env, 2025);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            personId: 'prs_1',
            fullName: 'Jane',
            email: 'j@e.com',
            legalName: 'Jane Doe',
            ein: '12-3456789',
            total1099Cents: 75000,
            totalW2Cents: 0,
            entryCount: 5,
            unpaidCount: 1,
            requires1099: true,
        });
    });

    it('sets requires1099=false for sub-threshold rows', async () => {
        env.DB.__on(/FROM labor_entries le/, {
            results: [{
                person_id: 'prs_2', full_name: 'Bob', total_1099_cents: 50000,
            }],
        }, 'all');
        const result = await aggregate1099TotalsForYear(env, 2025);
        expect(result[0].requires1099).toBe(false);
    });

    it('returns empty array when no rows match', async () => {
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        const result = await aggregate1099TotalsForYear(env, 2025);
        expect(result).toEqual([]);
    });
});

describe('getYearLock', () => {
    let env;
    beforeEach(() => { env = createMockEnv(); });

    it('returns the row when the year is locked', async () => {
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: 1700000000000, locked_reason: 'manual_close',
        }, 'first');

        const lock = await getYearLock(env, 2025);
        expect(lock).toMatchObject({ tax_year: 2025, locked_reason: 'manual_close' });
    });

    it('returns null when the year is unlocked', async () => {
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, null, 'first');
        const lock = await getYearLock(env, 2025);
        expect(lock).toBeNull();
    });
});

describe('lockTaxYear', () => {
    let env;
    beforeEach(() => {
        env = createMockEnv();
        env.DB.__on(/FROM labor_entries WHERE tax_year = \?/, { w2: 200000, k1099: 75000 }, 'first');
        env.DB.__on(/INSERT INTO tax_year_locks/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
    });

    it('snapshots totals, inserts the lock row, and writes audit_log', async () => {
        const result = await lockTaxYear(env, {
            taxYear: 2025, userId: 'u_owner', reason: 'manual_close', notes: 'CPA-reviewed',
        });

        expect(result).toMatchObject({ ok: true, taxYear: 2025 });
        expect(result.totals).toEqual({ w2: 200000, k1099: 75000 });

        const writes = env.DB.__writes();
        const insertLock = writes.find((w) => /INSERT INTO tax_year_locks/.test(w.sql));
        expect(insertLock).toBeDefined();
        expect(insertLock.args[0]).toBe(2025);
    });

    it('binds reason as a positional arg (parameterized literal — lessons-learned #3)', async () => {
        await lockTaxYear(env, {
            taxYear: 2025, userId: 'u_owner', reason: 'manual_close', notes: null,
        });

        const writes = env.DB.__writes();
        const insertLock = writes.find((w) => /INSERT INTO tax_year_locks/.test(w.sql));
        expect(insertLock.args).toContain('manual_close');
    });

    it('writes audit action "tax_year.locked" when userId is provided', async () => {
        await lockTaxYear(env, {
            taxYear: 2025, userId: 'u_owner', reason: 'manual_close',
        });

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'tax_year.locked')
        );
        expect(auditWrite).toBeDefined();
    });

    it('writes audit action "tax_year.auto_locked" when userId is null (cron path)', async () => {
        await lockTaxYear(env, {
            taxYear: 2025, userId: null, reason: 'auto_march_1',
        });

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'tax_year.auto_locked')
        );
        expect(auditWrite).toBeDefined();
    });

    it('binds "auto_march_1" reason positionally for cron-driven locks', async () => {
        await lockTaxYear(env, {
            taxYear: 2025, userId: null, reason: 'auto_march_1',
        });

        const writes = env.DB.__writes();
        const insertLock = writes.find((w) => /INSERT INTO tax_year_locks/.test(w.sql));
        expect(insertLock.args).toContain('auto_march_1');
    });
});

describe('runTaxYearAutoLockSweep', () => {
    let env;

    beforeEach(() => {
        env = createMockEnv();
        env.RESEND_API_KEY = 'test-resend-key';
        env.RESEND_FROM_EMAIL = 'no-reply@airactionsport.com';
    });

    it('returns zero counts when no candidates and not yet March', async () => {
        const jan15 = new Date('2026-01-15T03:00:00Z').getTime();
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');

        const result = await runTaxYearAutoLockSweep(env, jan15);
        expect(result).toEqual({ autoLocked: 0, w9RemindersSent: 0, w9RemindersFailed: 0 });
    });

    it('skips auto-lock when previous year is already locked', async () => {
        const mar1_2026 = new Date('2026-03-01T03:00:00Z').getTime();
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: mar1_2026 - 86400000, locked_reason: 'manual_close',
        }, 'first');

        const result = await runTaxYearAutoLockSweep(env, mar1_2026);
        expect(result.autoLocked).toBe(0);

        const writes = env.DB.__writes();
        const insertLock = writes.find((w) => /INSERT INTO tax_year_locks/.test(w.sql));
        expect(insertLock).toBeUndefined();
    });

    it('auto-locks previous year on March 1 when not yet locked, with reason="auto_march_1"', async () => {
        const mar1_2026 = new Date('2026-03-01T03:00:00Z').getTime();
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, null, 'first');
        env.DB.__on(/FROM labor_entries WHERE tax_year = \?/, { w2: 0, k1099: 0 }, 'first');
        env.DB.__on(/INSERT INTO tax_year_locks/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const result = await runTaxYearAutoLockSweep(env, mar1_2026);
        expect(result.autoLocked).toBe(1);

        const writes = env.DB.__writes();
        const insertLock = writes.find((w) => /INSERT INTO tax_year_locks/.test(w.sql));
        expect(insertLock).toBeDefined();
        expect(insertLock.args).toContain(2025);
        expect(insertLock.args).toContain('auto_march_1');
        expect(insertLock.args).toContain(null); // userId null for cron path
    });

    it('sends w9_reminder for threshold-meeting candidates missing legal_name + audit sentinel new', async () => {
        const mar1_2026 = new Date('2026-03-01T03:00:00Z').getTime();
        const recipient = {
            person_id: 'prs_001',
            full_name: 'Jane Doe',
            email: 'jane@example.com',
            legal_name: null,
            ein: null,
            total_1099_cents: 75000,
        };
        env.DB.__on(/FROM labor_entries le/, { results: [recipient] }, 'all');
        env.DB.__on(
            /SELECT 1 FROM audit_log[\s\S]*target_type = 'tax_year'/,
            null,
            'first',
        );
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, {
            slug: 'w9_reminder',
            subject: 'W-9 needed for {{taxYear}}',
            body_html: '<p>Hi {{personName}}, total {{total1099Display}} due {{requiredBy}}</p>',
            body_text: 'Hi {{personName}}, total {{total1099Display}} due {{requiredBy}}',
        }, 'first');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: mar1_2026 - 86400000, locked_reason: 'manual_close',
        }, 'first');

        mockResendFetch();

        const result = await runTaxYearAutoLockSweep(env, mar1_2026);
        expect(result.w9RemindersSent).toBe(1);
        expect(result.w9RemindersFailed).toBe(0);

        // Resend was called once.
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        // Audit sentinel was inserted with target_id "prs_001:2025"
        const writes = env.DB.__writes();
        const sentinelInsert = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'tax_year.w9_reminder_sent')
        );
        expect(sentinelInsert).toBeDefined();
        expect(sentinelInsert.args).toContain('prs_001:2025');
    });

    it('skips recipients whose audit sentinel already exists (idempotent re-run)', async () => {
        const mar1_2026 = new Date('2026-03-01T03:00:00Z').getTime();
        const recipient = {
            person_id: 'prs_001',
            full_name: 'Jane Doe',
            email: 'jane@example.com',
            legal_name: null,
            ein: null,
            total_1099_cents: 75000,
        };
        env.DB.__on(/FROM labor_entries le/, { results: [recipient] }, 'all');
        // Sentinel already exists → first() returns truthy.
        env.DB.__on(
            /SELECT 1 FROM audit_log[\s\S]*target_type = 'tax_year'/,
            { '1': 1 },
            'first',
        );
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: mar1_2026 - 86400000, locked_reason: 'manual_close',
        }, 'first');

        const result = await runTaxYearAutoLockSweep(env, mar1_2026);
        expect(result.w9RemindersSent).toBe(0);
        expect(result.w9RemindersFailed).toBe(0);

        // No sentinel insert and no Resend call.
        const writes = env.DB.__writes();
        const sentinelInsert = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'tax_year.w9_reminder_sent')
        );
        expect(sentinelInsert).toBeUndefined();
    });

    it('counts w9RemindersFailed when template is missing', async () => {
        const mar1_2026 = new Date('2026-03-01T03:00:00Z').getTime();
        const recipient = {
            person_id: 'prs_001',
            full_name: 'Jane Doe',
            email: 'jane@example.com',
            legal_name: null,
            ein: null,
            total_1099_cents: 75000,
        };
        env.DB.__on(/FROM labor_entries le/, { results: [recipient] }, 'all');
        env.DB.__on(/SELECT 1 FROM audit_log[\s\S]*target_type = 'tax_year'/, null, 'first');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: mar1_2026 - 86400000, locked_reason: 'manual_close',
        }, 'first');

        const result = await runTaxYearAutoLockSweep(env, mar1_2026);
        expect(result.w9RemindersFailed).toBe(1);
        expect(result.w9RemindersSent).toBe(0);
    });

    it('binds the previous tax year (calendar year - 1) into the candidate query', async () => {
        const may2026 = new Date('2026-05-08T00:00:00Z').getTime();
        env.DB.__on(/FROM labor_entries le/, { results: [] }, 'all');
        env.DB.__on(/FROM tax_year_locks WHERE tax_year = \?/, {
            tax_year: 2025, locked_at: 1, locked_reason: 'manual_close',
        }, 'first');

        await runTaxYearAutoLockSweep(env, may2026);

        const writes = env.DB.__writes();
        const candidateQuery = writes.find((w) =>
            /FROM labor_entries le/.test(w.sql) && /HAVING/.test(w.sql)
        );
        expect(candidateQuery).toBeDefined();
        expect(candidateQuery.args).toContain(2025);
        expect(candidateQuery.args).toContain(IRS_1099_THRESHOLD_CENTS);
    });
});
