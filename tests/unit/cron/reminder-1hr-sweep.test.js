// M5 Batch 7 — audit Group H #73: reminder_1hr sweep.
//
// Same shape as the 24h sweep but stamps reminder_1hr_sent_at and uses
// the 45-75min window. Both windows run in parallel from runReminderSweep.
//
// 2026-07-27 — this is the window that actually misfired in production. On
// 2026-07-25, 18 Operation Last Light bookings received "T-MINUS 1 HOUR" at
// 1:20 AM because `unixepoch(events.date_iso)` read the naive Denver wall clock
// as UTC (6h early in MDT), and the sentinel stamp then suppressed the real
// T-1h send. The filter is now two-stage: padded wall-clock bounds in SQL, exact
// instant test in JS. See worker/lib/eventTime.js.
//
// Fixture dates are DERIVED FROM Date.now(); a hardcoded one rots into a
// vacuous pass once it drifts out of a 30-minute window.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';
import { toDenverWallClock, eventInstantMs } from '../../../worker/lib/eventTime.js';

const MIN = 60_000;

// Clock PINNED — see the note in reminder-24hr-sweep.test.js. Deriving fixtures
// from the real Date.now() would go red for an hour every fall-back Sunday,
// because instant → wall clock → instant loses an hour inside the repeated
// 01:00-01:59 Denver hour.
const NOW = Date.parse('2026-07-20T18:00:00Z'); // 12:00 MDT, a Monday

const eventIsoIn = (msFromNow) => toDenverWallClock(NOW + msFromNow);

const candidate = (id, dateIso) => ({
    id, email: 'a@b.com', event_id: 'ev_1',
    event_title: 'Test', event_display_date: '', event_location: '',
    event_check_in: '', event_first_game: '', event_date_iso: dateIso,
});

describe('runReminderSweep — 1hr window (H73)', () => {
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

    it('binds the 45-75min window EXACTLY as Denver wall-clock bounds', async () => {
        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();
        const writes = env.DB.__writes();
        const oneHrQuery = writes.find((w) =>
            /reminder_1hr_sent_at IS NULL/.test(w.sql) && /BETWEEN \? AND \?/.test(w.sql),
        );
        expect(oneHrQuery).toBeDefined();

        const [start, end] = oneHrQuery.args;
        expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

        // EXACT to the second. The window must stay wider than the 15-min cron
        // tick or bookings fall between ticks and get no reminder at all, so a
        // loose acceptance band here is genuinely unsafe.
        expect(start).toBe(toDenverWallClock(NOW + 45 * MIN));
        expect(end).toBe(toDenverWallClock(NOW + 75 * MIN));
        expect(eventInstantMs(start) - NOW).toBe(45 * MIN);
        expect(eventInstantMs(end) - NOW).toBe(75 * MIN);
    });

    it('uses reminder_1hr_sent_at as the sentinel column (separate from 24hr)', async () => {
        env.DB.__on(/reminder_1hr_sent_at IS NULL/, { results: [candidate('bk_99', eventIsoIn(60 * MIN))] }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_1hr_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        const writes = env.DB.__writes();
        const oneHrUpdate = writes.find((w) =>
            /UPDATE bookings SET reminder_1hr_sent_at/.test(w.sql),
        );
        expect(oneHrUpdate).toBeDefined();
    });

    // ── The exact production misfire ───────────────────────────────────────
    // Operation Last Light started 08:30 Denver. The bad email went out at
    // 01:20 Denver — 7h10m ahead — because the naive read placed the start at
    // 02:30. A row that far out must never be claimed.
    it('does NOT fire ~7h before the event (the 2026-07-25 1:20 AM misfire)', async () => {
        env.DB.__on(/reminder_1hr_sent_at IS NULL/, { results: [candidate('bk_early', eventIsoIn(7 * 60 * MIN))] }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_1hr_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        expect(env.DB.__writes().find((w) => /UPDATE bookings SET reminder_1hr_sent_at/.test(w.sql)))
            .toBeUndefined();
    });

    it('does NOT fire for an event already 15 minutes away', async () => {
        env.DB.__on(/reminder_1hr_sent_at IS NULL/, { results: [candidate('bk_imminent', eventIsoIn(15 * MIN))] }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_1hr_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        expect(env.DB.__writes().find((w) => /UPDATE bookings SET reminder_1hr_sent_at/.test(w.sql)))
            .toBeUndefined();
    });

    it('excludes a row whose date_iso is unparseable rather than mis-timing it', async () => {
        env.DB.__on(/reminder_1hr_sent_at IS NULL/, { results: [candidate('bk_bad', '')] }, 'all');
        env.DB.__on(/UPDATE bookings SET reminder_1hr_sent_at = \?/, { meta: { changes: 1 } }, 'run');

        await workerEntry.scheduled({ cron: '*/15 * * * *' }, env, ctx);
        await ctx.__settle();

        expect(env.DB.__writes().find((w) => /UPDATE bookings SET reminder_1hr_sent_at/.test(w.sql)))
            .toBeUndefined();
    });
});
