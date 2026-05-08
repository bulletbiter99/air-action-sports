// M5 Batch 7 — audit Group H #72: reminder_24hr sweep.
//
// Locks the sentinel-stamping behavior: the cron stamps reminder_sent_at
// BEFORE attempting to send the email. If the send fails the column
// stays stamped (deliberate trade-off — we'd rather skip a single email
// than spam on retry). The audit row 'reminder.sent' is written only
// after a successful send.

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('runReminderSweep — 24hr window (H72)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    it('queries bookings with reminder_sent_at IS NULL in the 20-28h window', async () => {
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();
        const writes = env.DB.__writes();
        const reminderQuery = writes.find((w) =>
            /reminder_sent_at IS NULL/.test(w.sql) && /BETWEEN \? AND \?/.test(w.sql),
        );
        expect(reminderQuery).toBeDefined();
        // The bind args should be [windowStart, windowEnd] roughly 20h and 28h from now
        const now = Date.now();
        const [start, end] = reminderQuery.args;
        const startHours = (start - now) / 3600_000;
        const endHours = (end - now) / 3600_000;
        expect(startHours).toBeGreaterThan(19);
        expect(startHours).toBeLessThan(21);
        expect(endHours).toBeGreaterThan(27);
        expect(endHours).toBeLessThan(29);
    });

    it('claims a candidate by stamping reminder_sent_at BEFORE send (sentinel-first idempotency)', async () => {
        // Return a single candidate booking
        env.DB.__on(/reminder_sent_at IS NULL/, {
            results: [{
                id: 'bk_1', email: 'attendee@example.com', event_id: 'ev_1',
                event_title: 'Op Night', event_display_date: '2026-05-09',
                event_location: 'Ghost Town', event_check_in: '8:00 AM',
                event_first_game: '9:00 AM', event_date_iso: '2026-05-09',
            }],
        }, 'all');
        // The UPDATE returns changes=1 indicating successful claim
        env.DB.__on(/UPDATE bookings SET reminder_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const updateBeforeSend = writes.find((w) =>
            /UPDATE bookings SET reminder_sent_at/.test(w.sql),
        );
        expect(updateBeforeSend).toBeDefined();
        expect(updateBeforeSend.args.some((a) => a === 'bk_1')).toBe(true);
    });

    it('skips a row when UPDATE changes=0 (already claimed by another tick)', async () => {
        env.DB.__on(/reminder_sent_at IS NULL/, {
            results: [{
                id: 'bk_2', email: 'attendee@example.com', event_id: 'ev_1',
                event_title: 'Op', event_display_date: '2026-05-09',
                event_location: '', event_check_in: '', event_first_game: '', event_date_iso: '2026-05-09',
            }],
        }, 'all');
        // Race: another worker claimed it first
        env.DB.__on(/UPDATE bookings SET reminder_sent_at = \?/, { meta: { changes: 0 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        // No reminder.sent audit should be written for the skipped row
        const writes = env.DB.__writes();
        const sentAudit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && w.args.some((a) => a === 'reminder.sent'),
        );
        expect(sentAudit).toBeUndefined();
    });
});
