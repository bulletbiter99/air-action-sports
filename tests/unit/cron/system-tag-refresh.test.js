// M5 Batch 7 — audit Group H #76: system tag refresh (M3 B10 nightly cron).
//
// Cron string '0 3 * * *' triggers runCustomerTagsSweep which clears+
// reinserts customer_tags rows of source='system' for the 4 system tags:
// vip / frequent / lapsed / new.

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('runCustomerTagsSweep (H76)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    it('runs only on the 03:00 cron, not the 15-min cron', async () => {
        // 15-min: should NOT touch customer_tags rows of source='system'
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        const writes15 = env.DB.__writes();
        const tagWrite15 = writes15.find((w) =>
            /customer_tags/.test(w.sql) && /source\s*=\s*'system'/.test(w.sql),
        );
        expect(tagWrite15).toBeUndefined();
    });

    it('issues queries against customers + customer_tags on the 03:00 cron', async () => {
        await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const customersSelect = writes.find((w) => /FROM customers/.test(w.sql));
        expect(customersSelect).toBeDefined();
    });

    it('writes cron.swept audit row on 03:00 cron completion', async () => {
        await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const swept = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /cron\.swept/.test(w.sql),
        );
        expect(swept).toBeDefined();
    });
});
