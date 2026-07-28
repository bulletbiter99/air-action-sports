// Unit tests for the cash-flow forecast pure helper (worker/lib/cashFlow.js).
// Deterministic week windows are passed in as fixtures (no Date.now()).
//
// Weeks are DENVER-midnight anchored (eventInstantMs on a date-only value =
// midnight Mountain) because that is the shape the route supplies since the
// business-calendar change: the lib walks each week's days as Denver calendar
// dates, so a UTC-midnight fixture would smear its first day into the previous
// Denver date and shift every month-membership assertion by one day.

import { describe, it, expect } from 'vitest';
import { computeCashFlowForecast } from '../../../worker/lib/cashFlow.js';
import { eventInstantMs } from '../../../worker/lib/eventTime.js';

const denverMidnight = (d) => eventInstantMs(d);

// Two consecutive 7-day weeks, both fully inside July 2026 (31 days).
const WEEK1 = { startMs: denverMidnight('2026-07-06'), endMs: denverMidnight('2026-07-13') };
const WEEK2 = { startMs: denverMidnight('2026-07-13'), endMs: denverMidnight('2026-07-20') };

describe('computeCashFlowForecast', () => {
    it('rolls opening → closing forward, applying run-rate + FR receipts − budget', () => {
        const out = computeCashFlowForecast({
            openingCents: 100000,
            weeks: [WEEK1, WEEK2],
            weeklyRevenueCents: 5000,
            // $200 FR payment due in week 2.
            frPayments: [{ due_at: denverMidnight('2026-07-15T12:00:00'), amount_cents: 20000 }],
            // $310/mo budget → $10/day → $70/week over a full-July week.
            monthlyBudget: { '2026-07': 31000 },
        });

        expect(out.rows).toHaveLength(2);
        // Week 1: 100000 + 5000 − 7000 = 98000
        expect(out.rows[0]).toMatchObject({
            openingCents: 100000, receiptsCents: 5000, disbursementsCents: 7000,
            netCents: -2000, closingCents: 98000, frReceiptsCents: 0,
        });
        // Week 2: opening 98000, receipts 5000 + 20000, disb 7000 → closing 116000
        expect(out.rows[1]).toMatchObject({
            openingCents: 98000, receiptsCents: 25000, frReceiptsCents: 20000,
            disbursementsCents: 7000, netCents: 18000, closingCents: 116000,
        });
        expect(out.endingCents).toBe(116000);
        expect(out.totalReceiptsCents).toBe(30000);
        expect(out.totalDisbursementsCents).toBe(14000);
        expect(out.netCents).toBe(16000);
        // The trough is week 1's closing.
        expect(out.minClosingCents).toBe(98000);
        expect(out.minClosingWeekLabel).toBe(out.rows[0].label);
    });

    it('allocates budget per-day across a week that spans a month boundary', () => {
        // July 29 → Aug 5: 3 July days ($10/day) + 4 Aug days ($20/day) = 30 + 80 = $110.
        const crossWeek = { startMs: denverMidnight('2026-07-29'), endMs: denverMidnight('2026-08-05') };
        const out = computeCashFlowForecast({
            openingCents: 0,
            weeks: [crossWeek],
            weeklyRevenueCents: 0,
            monthlyBudget: { '2026-07': 31000, '2026-08': 62000 }, // $10/day July, $20/day Aug (31 days each)
        });
        expect(out.rows[0].disbursementsCents).toBe(11000);
    });

    // THE reason the day-walk is calendar dates, not `dayMs += 86400000`: the
    // fall-back week (containing 1 Nov 2026) is 7 days + 1 HOUR long, so a
    // fixed-ms walk takes an 8th step at 23:00 of the last day and allocates a
    // day of budget twice. Silent, and only one week a year.
    it('allocates exactly 7 days across the 25-hour fall-back week', () => {
        const fallBackWeek = { startMs: denverMidnight('2026-10-26'), endMs: denverMidnight('2026-11-02') };
        expect(fallBackWeek.endMs - fallBackWeek.startMs).toBe(7 * 86400000 + 3600000);
        const out = computeCashFlowForecast({
            openingCents: 0,
            weeks: [fallBackWeek],
            weeklyRevenueCents: 0,
            // $10/day in both months (31 and 30 days respectively).
            monthlyBudget: { '2026-10': 31000, '2026-11': 30000 },
        });
        // Oct 26-31 (6 days) + Nov 1 (1 day) = $70. A double-counted day = $80.
        expect(out.rows[0].disbursementsCents).toBe(7000);
    });

    it('defaults the label to the week start date (YYYY-MM-DD)', () => {
        const out = computeCashFlowForecast({ openingCents: 0, weeks: [WEEK1], weeklyRevenueCents: 0 });
        expect(out.rows[0].label).toBe('2026-07-06');
    });

    it('reports a negative trough when the balance dips below zero', () => {
        const out = computeCashFlowForecast({
            openingCents: 1000,
            weeks: [WEEK1, WEEK2],
            weeklyRevenueCents: 0,
            monthlyBudget: { '2026-07': 31000 }, // −7000/week
        });
        expect(out.rows[0].closingCents).toBe(-6000);
        expect(out.rows[1].closingCents).toBe(-13000);
        expect(out.minClosingCents).toBe(-13000);
    });

    it('tolerates empty input (no weeks → ending == opening)', () => {
        const out = computeCashFlowForecast({ openingCents: 5000 });
        expect(out.rows).toEqual([]);
        expect(out.endingCents).toBe(5000);
        expect(out.minClosingCents).toBe(5000);
    });
});
