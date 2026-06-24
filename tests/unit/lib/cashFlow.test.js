// Unit tests for the cash-flow forecast pure helper (worker/lib/cashFlow.js).
// Deterministic week windows are passed in as fixtures (no Date.now()).

import { describe, it, expect } from 'vitest';
import { computeCashFlowForecast } from '../../../worker/lib/cashFlow.js';

// Two consecutive 7-day weeks, both fully inside July 2026 (31 days).
const WEEK1 = { startMs: Date.UTC(2026, 6, 6), endMs: Date.UTC(2026, 6, 13) };
const WEEK2 = { startMs: Date.UTC(2026, 6, 13), endMs: Date.UTC(2026, 6, 20) };

describe('computeCashFlowForecast', () => {
    it('rolls opening → closing forward, applying run-rate + FR receipts − budget', () => {
        const out = computeCashFlowForecast({
            openingCents: 100000,
            weeks: [WEEK1, WEEK2],
            weeklyRevenueCents: 5000,
            // $200 FR payment due in week 2.
            frPayments: [{ due_at: Date.UTC(2026, 6, 15), amount_cents: 20000 }],
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
        const crossWeek = { startMs: Date.UTC(2026, 6, 29), endMs: Date.UTC(2026, 7, 5) };
        const out = computeCashFlowForecast({
            openingCents: 0,
            weeks: [crossWeek],
            weeklyRevenueCents: 0,
            monthlyBudget: { '2026-07': 31000, '2026-08': 62000 }, // $10/day July, $20/day Aug (31 days each)
        });
        expect(out.rows[0].disbursementsCents).toBe(11000);
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
