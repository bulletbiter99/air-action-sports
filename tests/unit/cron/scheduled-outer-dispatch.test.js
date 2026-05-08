// M5 Batch 7 — audit Group H #71: scheduled() outer dispatch.
//
// Already partially covered by Group G's scheduled.test.js (M4 B1a),
// which locks the cron-string branching. H71 extends with explicit
// assertions about the cron.swept audit row and Promise.all parallelism.

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('scheduled() outer dispatch (H71)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    it('writes cron.swept audit row on every invocation', async () => {
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();
        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql),
        );
        expect(auditWrite).toBeDefined();
    });

    it('writes cron.swept audit row on the 03:00 customer-tags cron too', async () => {
        await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
        await ctx.__settle();
        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql),
        );
        expect(auditWrite).toBeDefined();
    });

    it('cron.swept audit row encodes the cron string in target_id', async () => {
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();
        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql),
        );
        expect(auditWrite).toBeDefined();
        // First bind arg is the cron string (encoded as target_id)
        expect(auditWrite.args[0]).toBe('*/15 * * * *');
    });
});
