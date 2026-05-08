// M5 Batch 7 — audit Group H #73: reminder_1hr sweep.
//
// Same shape as the 24h sweep but stamps reminder_1hr_sent_at and uses
// the 45-75min window. Both windows run in parallel from runReminderSweep.

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('runReminderSweep — 1hr window (H73)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    it('queries bookings with reminder_1hr_sent_at IS NULL in the 45-75min window', async () => {
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();
        const writes = env.DB.__writes();
        const oneHrQuery = writes.find((w) =>
            /reminder_1hr_sent_at IS NULL/.test(w.sql) && /BETWEEN \? AND \?/.test(w.sql),
        );
        expect(oneHrQuery).toBeDefined();
        const now = Date.now();
        const [start, end] = oneHrQuery.args;
        const startMin = (start - now) / 60_000;
        const endMin = (end - now) / 60_000;
        expect(startMin).toBeGreaterThan(44);
        expect(startMin).toBeLessThan(46);
        expect(endMin).toBeGreaterThan(74);
        expect(endMin).toBeLessThan(76);
    });

    it('uses reminder_1hr_sent_at as the sentinel column (separate from 24hr)', async () => {
        env.DB.__on(/reminder_1hr_sent_at IS NULL/, {
            results: [{
                id: 'bk_99', email: 'a@b.com', event_id: 'ev_1',
                event_title: 'Test', event_display_date: '', event_location: '',
                event_check_in: '', event_first_game: '', event_date_iso: '',
            }],
        }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_1hr_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const oneHrUpdate = writes.find((w) =>
            /UPDATE bookings SET reminder_1hr_sent_at/.test(w.sql),
        );
        expect(oneHrUpdate).toBeDefined();
    });
});
