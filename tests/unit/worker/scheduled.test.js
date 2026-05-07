// audit Group G #70 — worker/index.js scheduled() outer dispatch
//
// Cron handler at the worker default export. Two cron schedules registered
// in wrangler.toml: '*/15 * * * *' (15-min reminders + abandon + vendor) and
// '0 3 * * *' (nightly customer-tags refresh, M3 B10).
//
// Per docs/audit/06-do-not-touch.md (Critical): "Sentinel-first idempotency
// must be preserved. Always-on `cron.swept` audit row backs the AdminDashboard
// CronHealth widget." Group H (the inner sweep behaviors) is deferred to M5;
// G70 covers ONLY the outer dispatch contract.
//
// G70 invariants:
//   1. event.cron === '0 3 * * *' branches to runCustomerTagsSweep
//      (and skips runReminderSweep / runAbandonPendingSweep / runVendorSweep)
//   2. Any other cron (default '*/15') invokes the three regular sweeps
//      in parallel (Promise.all)
//   3. cron.swept audit row is ALWAYS written, regardless of which branch
//      ran or whether sweeps succeeded
//   4. Errors in one sweep do not crash others (per-sweep .catch wrappers)

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('worker/index.js scheduled (Group G #70 — outer dispatch)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
        // Default: every SQL returns empty results so sweeps complete with
        // zero work. Tests that assert specific behavior register their own
        // handlers before invoking scheduled().
    });

    describe('15-min cron — runs reminders + abandon + vendor sweeps in parallel', () => {
        it('issues SELECT against bookings (reminder sweep)', async () => {
            await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const reminderSelect = writes.find((w) =>
                /FROM bookings/.test(w.sql) &&
                /reminder_sent_at/.test(w.sql)
            );
            expect(reminderSelect).toBeDefined();
        });

        it('issues UPDATE against bookings (abandon-pending sweep)', async () => {
            await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const abandonUpdate = writes.find((w) =>
                /UPDATE bookings/.test(w.sql) &&
                /status\s*=\s*'abandoned'/.test(w.sql)
            );
            expect(abandonUpdate).toBeDefined();
        });

        it('issues SELECT against vendors (vendor COI sweep)', async () => {
            await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const vendorSelect = writes.find((w) =>
                /FROM vendors/.test(w.sql) &&
                /coi_/.test(w.sql)
            );
            expect(vendorSelect).toBeDefined();
        });

        it('does NOT invoke customer-tags sweep on the 15-min cron', async () => {
            await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            // M3 B10's tag sweep clears+reinserts customer_tags rows of type=system.
            // Confirm no such SQL ran.
            const tagsSweepWrites = writes.filter((w) =>
                /customer_tags/.test(w.sql)
            );
            expect(tagsSweepWrites).toHaveLength(0);
        });
    });

    describe('03:00 UTC cron — runs ONLY customer-tags sweep', () => {
        it('does NOT invoke reminder, abandon, or vendor sweeps', async () => {
            await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();

            // No reminder-sweep SELECT
            expect(writes.find((w) =>
                /FROM bookings/.test(w.sql) && /reminder_sent_at/.test(w.sql)
            )).toBeUndefined();

            // No abandon-pending UPDATE
            expect(writes.find((w) =>
                /UPDATE bookings/.test(w.sql) && /'abandoned'/.test(w.sql)
            )).toBeUndefined();

            // No vendor SELECT for COI
            expect(writes.find((w) =>
                /FROM vendors/.test(w.sql) && /coi_/.test(w.sql)
            )).toBeUndefined();
        });

        it('invokes customer-tags sweep (touches customers + customer_tags)', async () => {
            // Provide one customer so the sweep produces visible writes
            env.DB.__on(
                /FROM customers/,
                {
                    results: [{
                        id: 'cust_1',
                        email: 'a@b.c',
                        full_name: 'Test',
                        first_booking_at: Date.now() - 100000,
                        last_booking_at: Date.now() - 50000,
                        booking_count: 1,
                        ltv_cents: 5000,
                    }],
                    meta: { rows_read: 1 },
                },
                'all',
            );

            await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const touchedTags = writes.some((w) => /customer_tags/.test(w.sql));
            expect(touchedTags).toBe(true);
        });
    });

    describe('always-on cron.swept audit row', () => {
        it('writes cron.swept on the 15-min cron even with zero work', async () => {
            await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const auditWrite = writes.find((w) =>
                /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql)
            );
            expect(auditWrite).toBeDefined();
            // First bind = the cron string; second bind = JSON meta; third = createdAt.
            expect(auditWrite.args[0]).toBe('*/15 * * * *');
            const meta = JSON.parse(auditWrite.args[1]);
            expect(meta.cron).toBe('*/15 * * * *');
            expect(typeof meta.durationMs).toBe('number');
            expect(meta).toHaveProperty('reminders');
            expect(meta).toHaveProperty('pending');
            expect(meta).toHaveProperty('vendor');
        });

        it('writes cron.swept on the 03:00 cron with tags summary', async () => {
            await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const auditWrite = writes.find((w) =>
                /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql)
            );
            expect(auditWrite).toBeDefined();
            expect(auditWrite.args[0]).toBe('0 3 * * *');
            const meta = JSON.parse(auditWrite.args[1]);
            expect(meta).toHaveProperty('tags');
        });

        it('cron-string fallback is "manual" when event.cron is undefined', async () => {
            await workerEntry.scheduled({}, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const auditWrite = writes.find((w) =>
                /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql)
            );
            expect(auditWrite).toBeDefined();
            expect(auditWrite.args[0]).toBe('manual');
        });
    });

    describe('error containment — failing sweep does not crash others', () => {
        it('vendor sweep failure does not prevent reminder + abandon sweeps from completing', async () => {
            // Make the vendor-sweep SELECT throw
            env.DB.__on(
                /FROM vendors/,
                () => { throw new Error('simulated D1 outage'); },
                'all',
            );

            await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();

            // Reminder sweep still ran (its SELECT was issued)
            expect(writes.find((w) =>
                /FROM bookings/.test(w.sql) && /reminder_sent_at/.test(w.sql)
            )).toBeDefined();

            // Abandon sweep still ran (its UPDATE was issued)
            expect(writes.find((w) =>
                /UPDATE bookings/.test(w.sql) && /'abandoned'/.test(w.sql)
            )).toBeDefined();

            // cron.swept audit row STILL written, with error captured under vendor
            const auditWrite = writes.find((w) =>
                /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql)
            );
            expect(auditWrite).toBeDefined();
            const meta = JSON.parse(auditWrite.args[1]);
            expect(meta.vendor.error).toContain('simulated D1 outage');
        });

        it('customer-tags sweep failure on 03:00 cron still writes cron.swept', async () => {
            // Make the tags sweep throw
            env.DB.__on(
                /FROM customers/,
                () => { throw new Error('simulated tag sweep failure'); },
                'all',
            );

            await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
            await ctx.__settle();

            const writes = env.DB.__writes();
            const auditWrite = writes.find((w) =>
                /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql)
            );
            expect(auditWrite).toBeDefined();
            const meta = JSON.parse(auditWrite.args[1]);
            expect(meta.tags.error).toContain('simulated tag sweep failure');
        });
    });

    describe('ctx.waitUntil contract', () => {
        it('all work is wrapped in ctx.waitUntil so the runtime knows to wait', async () => {
            await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
            // waitUntil should have been called exactly once with a Promise
            expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
            const p = ctx.waitUntil.mock.calls[0][0];
            expect(p).toBeInstanceOf(Promise);
            // And awaiting it doesn't throw (because the inner work catches sweep errors)
            await expect(p).resolves.toBeUndefined();
        });
    });
});
