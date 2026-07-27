// M5 Batch 7 — audit Group H #72: reminder_24hr sweep.
//
// Locks the sentinel-stamping behavior: the cron stamps reminder_sent_at
// BEFORE attempting to send the email. If the send fails the column
// stays stamped (deliberate trade-off — we'd rather skip a single email
// than spam on retry). The audit row 'reminder.sent' is written only
// after a successful send.
//
// 2026-07-27 — the window filter became TWO-STAGE (see worker/lib/eventTime.js).
// `events.date_iso` is naive Denver wall clock, so the old
// `unixepoch(e.date_iso)` comparison against epoch-ms read every timed event
// 6-7h early and mailed 18 customers at 1:20 AM on 2026-07-25. SQL now binds
// padded WALL-CLOCK bounds and JS does the exact instant test, so the
// assertions below moved accordingly: the binds are strings, and the real
// window contract is pinned on which candidates survive the JS filter.
//
// Fixture dates are DERIVED FROM Date.now() on purpose. A hardcoded date here
// silently rots into a vacuous pass the moment it falls outside the window —
// exactly the calendar time bomb that took `main` red in PR #291.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';
import { toDenverWallClock, eventInstantMs } from '../../../worker/lib/eventTime.js';

const H = 3600_000;

// The clock is PINNED rather than derived from the real Date.now(). Deriving
// from real time leaves two independent bombs: calendar rot, and — because
// eventIsoIn round-trips instant → wall clock → instant — an hour silently
// vanishing whenever the target lands in the repeated 01:00-01:59 Denver hour on
// fall-back Sunday. A fixed instant well clear of both 2026 transitions removes
// both; the transitions themselves are pinned deliberately below and in
// tests/unit/lib/eventTime.test.js.
const NOW = Date.parse('2026-07-20T18:00:00Z'); // 12:00 MDT, a Monday

// A date_iso string, in the stored naive-Denver shape, for an event N ms out.
const eventIsoIn = (msFromNow) => toDenverWallClock(NOW + msFromNow);

const candidate = (id, dateIso) => ({
    id, email: 'attendee@example.com', event_id: 'ev_1',
    event_title: 'Op Night', event_display_date: 'Sat, May 9',
    event_location: 'Ghost Town', event_check_in: '8:00 AM',
    event_first_game: '9:00 AM', event_date_iso: dateIso,
});

describe('runReminderSweep — 24hr window (H72)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('binds the 20-28h window EXACTLY as Denver wall-clock bounds', async () => {
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();
        const writes = env.DB.__writes();
        const reminderQuery = writes.find((w) =>
            /reminder_sent_at IS NULL/.test(w.sql) && /BETWEEN \? AND \?/.test(w.sql),
        );
        expect(reminderQuery).toBeDefined();

        // Binds are Denver wall-clock strings in the same shape date_iso is
        // stored in, so the comparison needs no timezone math in SQL.
        const [start, end] = reminderQuery.args;
        expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

        // EXACT, not approximate. Off a DST transition the wall-clock bounds
        // carry no padding, so this pins the window to the second — a loose band
        // here would let the window silently drift (a 58-66h mutation passed an
        // earlier, sloppier version of this assertion).
        expect(start).toBe(toDenverWallClock(NOW + 20 * H));
        expect(end).toBe(toDenverWallClock(NOW + 28 * H));
        expect(eventInstantMs(start) - NOW).toBe(20 * H);
        expect(eventInstantMs(end) - NOW).toBe(28 * H);
    });

    it('claims a candidate by stamping reminder_sent_at BEFORE send (sentinel-first idempotency)', async () => {
        env.DB.__on(/reminder_sent_at IS NULL/, { results: [candidate('bk_1', eventIsoIn(24 * H))] }, 'all');
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
        // date_iso must be genuinely in-window, otherwise the JS filter drops
        // the row before the claim and this absence assertion passes vacuously.
        env.DB.__on(/reminder_sent_at IS NULL/, { results: [candidate('bk_2', eventIsoIn(24 * H))] }, 'all');
        // Race: another worker claimed it first
        env.DB.__on(/UPDATE bookings SET reminder_sent_at = \?/, { meta: { changes: 0 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        // The row WAS reached (proves the assertion below is not vacuous)…
        const writes = env.DB.__writes();
        expect(writes.find((w) => /UPDATE bookings SET reminder_sent_at/.test(w.sql))).toBeDefined();
        // …but no reminder.sent audit should be written for the skipped row.
        const sentAudit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && w.args.some((a) => a === 'reminder.sent'),
        );
        expect(sentAudit).toBeUndefined();
    });

    // ── The 2026-07-25 regression ──────────────────────────────────────────
    // Before the fix, a naive read placed every timed event 6h (MDT) / 7h (MST)
    // earlier than reality, so rows well outside the true window were claimed
    // and their sentinels burned. These pin the JS stage that now rejects them.
    it('does NOT claim an event that is only ~7h away (the 6h-skew scenario)', async () => {
        env.DB.__on(/reminder_sent_at IS NULL/, { results: [candidate('bk_early', eventIsoIn(7 * H))] }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        expect(env.DB.__writes().find((w) => /UPDATE bookings SET reminder_sent_at/.test(w.sql)))
            .toBeUndefined();
    });

    it('does NOT claim an event ~48h away', async () => {
        env.DB.__on(/reminder_sent_at IS NULL/, { results: [candidate('bk_late', eventIsoIn(48 * H))] }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        expect(env.DB.__writes().find((w) => /UPDATE bookings SET reminder_sent_at/.test(w.sql)))
            .toBeUndefined();
    });

    it('excludes a row whose date_iso is unparseable rather than mis-timing it', async () => {
        env.DB.__on(/reminder_sent_at IS NULL/, { results: [candidate('bk_bad', '')] }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        expect(env.DB.__writes().find((w) => /UPDATE bookings SET reminder_sent_at/.test(w.sql)))
            .toBeUndefined();
    });
});
