// M5 Batch 7 — audit Group H #74: abandon-pending sweep.
//
// Marks pending bookings older than PENDING_ABANDON_MS (30 min) as
// 'abandoned'. The seat-hold has already expired (PENDING_HOLD_MS=10min),
// so this is a status cleanup, not a seat release.

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('runAbandonPendingSweep (H74)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    it('issues UPDATE bookings SET status=abandoned WHERE pending AND older than 30min cutoff', async () => {
        env.DB.__on(/UPDATE bookings\s+SET status = 'abandoned'/, { meta: { changes: 3 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const abandonUpdate = writes.find((w) =>
            /UPDATE bookings/.test(w.sql) &&
            /status\s*=\s*'abandoned'/.test(w.sql) &&
            /status\s*=\s*'pending'/.test(w.sql),
        );
        expect(abandonUpdate).toBeDefined();
        // The bind arg is the cutoff timestamp (now - 30 minutes)
        const now = Date.now();
        const cutoff = abandonUpdate.args[0];
        const minutesAgo = (now - cutoff) / 60_000;
        expect(minutesAgo).toBeGreaterThan(29);
        expect(minutesAgo).toBeLessThan(31);
    });

    it('completes when no rows match (idempotent re-run)', async () => {
        env.DB.__on(/UPDATE bookings\s+SET status = 'abandoned'/, { meta: { changes: 0 } }, 'run');

        await expect(
            workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx)
        ).resolves.not.toThrow();
        await ctx.__settle();
    });
});
