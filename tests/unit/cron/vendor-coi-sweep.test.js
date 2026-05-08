// M5 Batch 7 — audit Group H #75: vendor sweep.
//
// Three sentinel-stamped sweeps over event_vendors / vendors:
//   - COI 30d / 7d expiration warnings (vendor_coi_expiring template)
//   - Package reminders (vendor_package_reminder template)
//   - Signature reminders (vendor_signature_requested template)

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('runVendorSweep (H75)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    it('issues a SELECT against vendors with coi_ columns (COI expiration sweep)', async () => {
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const vendorSelect = writes.find((w) =>
            /FROM vendors/.test(w.sql) && /coi_/.test(w.sql),
        );
        expect(vendorSelect).toBeDefined();
    });

    it('does not run vendor sweep on the 03:00 customer-tags cron', async () => {
        await workerEntry.scheduled({ cron: '0 3 * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const vendorSelect = writes.find((w) =>
            /FROM vendors/.test(w.sql) && /coi_/.test(w.sql),
        );
        // 03:00 cron is the tag-refresh sweep only
        expect(vendorSelect).toBeUndefined();
    });
});
