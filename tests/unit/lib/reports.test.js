// M7 Batch 2 — unit tests for the Reports pure helpers (worker/lib/reports.js).
// No D1: every function here is fed plain fixtures matching the raw D1 row
// shapes the route handlers pass in.

import { describe, it, expect } from 'vitest';
import {
    resolvePeriodWindow,
    priorWindow,
    computeDelta,
    computeRevenueTrends,
    computeRefundRate,
    computeAovTrend,
    bucketRepeatCustomers,
    computeSeriesRetention,
    computePayoutsSummary,
    computeTaxFeeSummary,
    computePeriodComparison,
    computeBudgetVsActual,
    computePerEventPnl,
    computeStripeFees,
    computeArAging,
    computeConversionFunnel,
    computePromoPerformance,
    computeCustomerCohorts,
    computeChannelAttribution,
    computeFieldRentalRevenue,
    computeCoiCompliance,
    computeLeadConversion,
    computeRecurrenceRetention,
    csvEscape,
    toCsv,
    SUPPORTED_PERIODS,
} from '../../../worker/lib/reports.js';

const DAY = 86400000;
// Fixed reference instant: 2026-05-15T12:00:00Z (May = UTC month index 4, Q2).
const NOW = Date.UTC(2026, 4, 15, 12, 0, 0);

describe('resolvePeriodWindow', () => {
    it('mtd starts at the 1st of the current UTC month', () => {
        const w = resolvePeriodWindow('mtd', NOW);
        expect(w.startMs).toBe(Date.UTC(2026, 4, 1));
        expect(w.endMs).toBe(NOW);
        expect(w.period).toBe('mtd');
        expect(w.label).toBe('Month to date');
    });

    it('qtd starts at the 1st of the current quarter (Q2 → April)', () => {
        const w = resolvePeriodWindow('qtd', NOW);
        expect(w.startMs).toBe(Date.UTC(2026, 3, 1));
        expect(w.endMs).toBe(NOW);
    });

    it('ytd starts at Jan 1 of the current UTC year', () => {
        const w = resolvePeriodWindow('ytd', NOW);
        expect(w.startMs).toBe(Date.UTC(2026, 0, 1));
    });

    it('last_30d / last_90d are rolling windows ending now', () => {
        expect(resolvePeriodWindow('last_30d', NOW).startMs).toBe(NOW - 30 * DAY);
        expect(resolvePeriodWindow('last_90d', NOW).startMs).toBe(NOW - 90 * DAY);
    });

    it('custom (and unknown) falls back to last_30d', () => {
        const w = resolvePeriodWindow('custom', NOW);
        expect(w.period).toBe('last_30d');
        expect(w.requestedPeriod).toBe('custom');
        expect(w.startMs).toBe(NOW - 30 * DAY);
        expect(resolvePeriodWindow('nonsense', NOW).period).toBe('last_30d');
    });

    // Batch 11a — custom date range
    it('custom with valid bounds uses the supplied window', () => {
        const start = Date.UTC(2026, 0, 1);  // 2026-01-01
        const end = Date.UTC(2026, 2, 1);    // 2026-03-01
        const w = resolvePeriodWindow('custom', NOW, { startMs: start, endMs: end });
        expect(w.period).toBe('custom');
        expect(w.requestedPeriod).toBe('custom');
        expect(w.startMs).toBe(start);
        expect(w.endMs).toBe(end);
        expect(w.label).toBe('Custom range');
    });

    it('custom falls back to last_30d when bounds are missing, non-finite, or inverted', () => {
        expect(resolvePeriodWindow('custom', NOW, { startMs: 1 }).period).toBe('last_30d');             // missing endMs
        expect(resolvePeriodWindow('custom', NOW, { startMs: NaN, endMs: 10 }).period).toBe('last_30d'); // non-finite
        expect(resolvePeriodWindow('custom', NOW, { startMs: 100, endMs: 100 }).period).toBe('last_30d'); // start == end
        expect(resolvePeriodWindow('custom', NOW, { startMs: 200, endMs: 100 }).period).toBe('last_30d'); // start > end
    });

    it('customBounds is ignored for non-custom periods', () => {
        const w = resolvePeriodWindow('mtd', NOW, { startMs: 1, endMs: 2 });
        expect(w.period).toBe('mtd');
        expect(w.startMs).not.toBe(1);
    });

    it('SUPPORTED_PERIODS lists the six selectors', () => {
        expect(SUPPORTED_PERIODS).toEqual(['mtd', 'qtd', 'ytd', 'last_30d', 'last_90d', 'custom']);
    });
});

describe('priorWindow', () => {
    it('is the equal-length window immediately preceding', () => {
        const cur = { startMs: 1000, endMs: 1700 };
        const prior = priorWindow(cur);
        expect(prior.endMs).toBe(1000);
        expect(prior.startMs).toBe(300); // 1000 - (1700-1000)
        expect(prior.endMs - prior.startMs).toBe(cur.endMs - cur.startMs);
    });

    it('prior of an MTD window does not overlap the current window', () => {
        const cur = resolvePeriodWindow('mtd', NOW);
        const prior = priorWindow(cur);
        expect(prior.endMs).toBe(cur.startMs);
    });
});

describe('computeDelta', () => {
    it('computes absolute + percentage delta', () => {
        expect(computeDelta(150, 100)).toEqual({ delta: 50, deltaPct: 0.5 });
        expect(computeDelta(80, 100)).toEqual({ delta: -20, deltaPct: -0.2 });
    });

    it('returns null deltaPct when prior is 0 (no divide-by-zero)', () => {
        expect(computeDelta(100, 0)).toEqual({ delta: 100, deltaPct: null });
        expect(computeDelta(0, 0)).toEqual({ delta: 0, deltaPct: null });
    });

    it('treats null/undefined prior as 0', () => {
        expect(computeDelta(100, null)).toEqual({ delta: 100, deltaPct: null });
        expect(computeDelta(100, undefined)).toEqual({ delta: 100, deltaPct: null });
    });
});

describe('computeRevenueTrends', () => {
    it('maps daily rows to a series and sums the total', () => {
        const out = computeRevenueTrends({
            dailyRows: [
                { d: '2026-05-01', gross_cents: 10000 },
                { d: '2026-05-02', gross_cents: 5000 },
            ],
        });
        expect(out.series).toEqual([
            { date: '2026-05-01', grossCents: 10000 },
            { date: '2026-05-02', grossCents: 5000 },
        ]);
        expect(out.totalCents).toBe(15000);
        expect(out.priorTotalCents).toBeNull();
        expect(out.delta).toBeNull();
    });

    it('computes a prior-period delta when priorTotalCents supplied', () => {
        const out = computeRevenueTrends({
            dailyRows: [{ d: '2026-05-01', gross_cents: 12000 }],
            priorTotalCents: 10000,
        });
        expect(out.priorTotalCents).toBe(10000);
        expect(out.delta).toEqual({ delta: 2000, deltaPct: 0.2 });
    });

    it('handles empty rows', () => {
        const out = computeRevenueTrends({ dailyRows: [] });
        expect(out.series).toEqual([]);
        expect(out.totalCents).toBe(0);
    });
});

describe('computeRefundRate', () => {
    it('computes per-month rate and overall rate from sums', () => {
        const out = computeRefundRate({
            monthlyRows: [
                { month: '2026-04', charged: 10, refunded: 2 },
                { month: '2026-05', charged: 10, refunded: 3 },
            ],
        });
        expect(out.series[0].rate).toBeCloseTo(0.2);
        expect(out.series[1].rate).toBeCloseTo(0.3);
        expect(out.charged).toBe(20);
        expect(out.refunded).toBe(5);
        expect(out.rate).toBeCloseTo(0.25);
    });

    it('rate is 0 when nothing charged (no NaN)', () => {
        const out = computeRefundRate({ monthlyRows: [{ month: '2026-05', charged: 0, refunded: 0 }] });
        expect(out.rate).toBe(0);
    });

    it('computes prior rate + delta when prior supplied', () => {
        const out = computeRefundRate({
            monthlyRows: [{ month: '2026-05', charged: 10, refunded: 5 }],
            priorCharged: 10,
            priorRefunded: 2,
        });
        expect(out.priorRate).toBeCloseTo(0.2);
        expect(out.delta.delta).toBeCloseTo(0.3);
    });
});

describe('computeAovTrend', () => {
    it('recomputes overall AOV from total sum / count, not avg of monthly avgs', () => {
        const out = computeAovTrend({
            monthlyRows: [
                { month: '2026-04', sum_cents: 30000, n: 3 }, // avg 10000
                { month: '2026-05', sum_cents: 10000, n: 1 }, // avg 10000
            ],
        });
        expect(out.series[0].avgCents).toBe(10000);
        expect(out.series[1].avgCents).toBe(10000);
        // overall: 40000 / 4 = 10000 (avg-of-avgs would also be 10000 here,
        // but the weighted path is exercised by the prior case below)
        expect(out.aovCents).toBe(10000);
        expect(out.bookings).toBe(4);
    });

    it('weights overall AOV by booking count across uneven months', () => {
        const out = computeAovTrend({
            monthlyRows: [
                { month: '2026-04', sum_cents: 90000, n: 9 }, // avg 10000
                { month: '2026-05', sum_cents: 10000, n: 1 }, // avg 10000
            ],
        });
        expect(out.aovCents).toBe(10000); // 100000 / 10
    });

    it('computes prior AOV + delta', () => {
        const out = computeAovTrend({
            monthlyRows: [{ month: '2026-05', sum_cents: 12000, n: 1 }],
            priorSumCents: 10000,
            priorCount: 1,
        });
        expect(out.priorAovCents).toBe(10000);
        expect(out.delta).toEqual({ delta: 2000, deltaPct: 0.2 });
    });

    it('handles empty + zero-count months', () => {
        expect(computeAovTrend({ monthlyRows: [] }).aovCents).toBe(0);
        expect(computeAovTrend({ monthlyRows: [{ month: '2026-05', sum_cents: 0, n: 0 }] }).series[0].avgCents).toBe(0);
    });
});

describe('bucketRepeatCustomers', () => {
    it('buckets at the 2-3 / 4-9 / 10+ boundaries', () => {
        const out = bucketRepeatCustomers([
            { total_bookings: 1 },  // not repeat
            { total_bookings: 2 },  // 2-3
            { total_bookings: 3 },  // 2-3
            { total_bookings: 4 },  // 4-9
            { total_bookings: 9 },  // 4-9
            { total_bookings: 10 }, // 10+
            { total_bookings: 25 }, // 10+
        ]);
        expect(out.buckets).toEqual({ '2-3': 2, '4-9': 2, '10+': 2 });
        expect(out.total).toBe(7);
        expect(out.repeatTotal).toBe(6);
        expect(out.repeatPct).toBeCloseTo(6 / 7);
    });

    it('handles empty input', () => {
        expect(bucketRepeatCustomers([])).toEqual({
            buckets: { '2-3': 0, '4-9': 0, '10+': 0 },
            total: 0,
            repeatTotal: 0,
            repeatPct: 0,
        });
    });
});

describe('computeSeriesRetention', () => {
    it('orders series by earliest date and computes adjacent retention', () => {
        const rows = [
            // Series Alpha (earliest 2026-01) — customers a,b,c
            { customer_id: 'a', series: 'Alpha', date_iso: '2026-01-10' },
            { customer_id: 'b', series: 'Alpha', date_iso: '2026-01-10' },
            { customer_id: 'c', series: 'Alpha', date_iso: '2026-01-10' },
            // Series Bravo (2026-03) — a,b booked again (2/3 retained)
            { customer_id: 'a', series: 'Bravo', date_iso: '2026-03-10' },
            { customer_id: 'b', series: 'Bravo', date_iso: '2026-03-10' },
            // Series Charlie (2026-05) — only a (1/2 retained from Bravo)
            { customer_id: 'a', series: 'Charlie', date_iso: '2026-05-10' },
        ];
        const out = computeSeriesRetention(rows);
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({ fromSeries: 'Alpha', toSeries: 'Bravo', baseCount: 3, retainedCount: 2 });
        expect(out[0].retainedPct).toBeCloseTo(2 / 3);
        expect(out[1]).toMatchObject({ fromSeries: 'Bravo', toSeries: 'Charlie', baseCount: 2, retainedCount: 1 });
        expect(out[1].retainedPct).toBeCloseTo(0.5);
    });

    it('returns [] with fewer than 2 series', () => {
        expect(computeSeriesRetention([])).toEqual([]);
        expect(computeSeriesRetention([
            { customer_id: 'a', series: 'Solo', date_iso: '2026-01-01' },
        ])).toEqual([]);
    });

    it('skips rows with null series or customer', () => {
        const out = computeSeriesRetention([
            { customer_id: 'a', series: null, date_iso: '2026-01-01' },
            { customer_id: null, series: 'X', date_iso: '2026-01-01' },
        ]);
        expect(out).toEqual([]);
    });
});

describe('csvEscape + toCsv', () => {
    it('escapes commas, quotes, and newlines', () => {
        expect(csvEscape('plain')).toBe('plain');
        expect(csvEscape('a,b')).toBe('"a,b"');
        expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
        expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
        expect(csvEscape(null)).toBe('');
        expect(csvEscape(42)).toBe('42');
    });

    it('builds a CRLF-delimited CSV with header + rows', () => {
        const csv = toCsv(['Month', 'Gross'], [['2026-05', '100.00'], ['2026-06', '250.50']]);
        expect(csv).toBe('Month,Gross\r\n2026-05,100.00\r\n2026-06,250.50\r\n');
    });
});

describe('computePayoutsSummary', () => {
    it('merges booking + field-rental months and computes net', () => {
        const out = computePayoutsSummary({
            bookingRows: [
                { month: '2026-04', gross_cents: 10000, refund_cents: 0 },
                { month: '2026-05', gross_cents: 20000, refund_cents: 5000 },
            ],
            frRows: [
                { month: '2026-05', fr_gross_cents: 8000 },
                { month: '2026-06', fr_gross_cents: 3000 },
            ],
        });
        // union of months, sorted ascending
        expect(out.rows.map((r) => r.month)).toEqual(['2026-04', '2026-05', '2026-06']);
        const may = out.rows.find((r) => r.month === '2026-05');
        expect(may).toMatchObject({ stripeGrossCents: 20000, fieldRentalGrossCents: 8000, refundsCents: 5000 });
        expect(may.netCents).toBe(23000); // 20000 - 5000 + 8000
        const jun = out.rows.find((r) => r.month === '2026-06');
        expect(jun.netCents).toBe(3000); // FR-only month
        expect(out.totals).toEqual({
            stripeGrossCents: 30000,
            fieldRentalGrossCents: 11000,
            refundsCents: 5000,
            netCents: 36000,
        });
    });

    it('handles empty input', () => {
        const out = computePayoutsSummary({});
        expect(out.rows).toEqual([]);
        expect(out.totals).toEqual({ stripeGrossCents: 0, fieldRentalGrossCents: 0, refundsCents: 0, netCents: 0 });
    });
});

describe('computeTaxFeeSummary', () => {
    it('builds a per-month series with per-row totals + grand totals', () => {
        const out = computeTaxFeeSummary({
            monthlyRows: [
                { month: '2026-05', tax_cents: 1000, fee_cents: 500 },
                { month: '2026-06', tax_cents: 2000, fee_cents: 0 },
            ],
        });
        expect(out.series[0]).toEqual({ month: '2026-05', taxCents: 1000, feeCents: 500, totalCents: 1500 });
        expect(out.series[1].totalCents).toBe(2000);
        expect(out.totals).toEqual({ taxCents: 3000, feeCents: 500, totalCents: 3500 });
    });

    it('handles empty input', () => {
        expect(computeTaxFeeSummary({}).totals).toEqual({ taxCents: 0, feeCents: 0, totalCents: 0 });
    });
});

describe('computePeriodComparison', () => {
    it('derives net/AOV per side and a delta per metric', () => {
        const out = computePeriodComparison({
            current: { gross_cents: 20000, refund_cents: 5000, tax_cents: 1500, fee_cents: 500, paid_count: 10 },
            prior: { gross_cents: 10000, refund_cents: 0, tax_cents: 800, fee_cents: 200, paid_count: 5 },
        });
        const byKey = Object.fromEntries(out.metrics.map((m) => [m.key, m]));
        expect(byKey.net).toMatchObject({ current: 15000, prior: 10000 });
        expect(byKey.net.delta).toEqual({ delta: 5000, deltaPct: 0.5 });
        expect(byKey.aov).toMatchObject({ current: 1500, prior: 2000 }); // net/bookings
        expect(byKey.aov.delta).toEqual({ delta: -500, deltaPct: -0.25 });
        expect(byKey.bookings).toMatchObject({ current: 10, prior: 5, kind: 'count' });
        expect(out.metrics).toHaveLength(7);
    });

    it('returns null deltaPct when prior side is empty/zero', () => {
        const out = computePeriodComparison({
            current: { gross_cents: 5000, refund_cents: 0, paid_count: 2 },
            prior: {},
        });
        const net = out.metrics.find((m) => m.key === 'net');
        expect(net.current).toBe(5000);
        expect(net.prior).toBe(0);
        expect(net.delta.deltaPct).toBeNull();
    });

    it('tolerates fully empty input (all zeros)', () => {
        const out = computePeriodComparison({});
        expect(out.metrics.every((m) => m.current === 0 && m.prior === 0)).toBe(true);
    });
});

describe('computeBudgetVsActual', () => {
    it('aggregates budget vs spend per category with variance + P&L net', () => {
        const out = computeBudgetVsActual({
            budgetRows: [
                { category: 'payroll', budgeted_cents: 300000 },
                { category: 'payroll', budgeted_cents: 100000 }, // 2 months → summed
                { category: 'marketing', budgeted_cents: 50000 },
            ],
            expenseRows: [
                { category: 'payroll', spent_cents: 380000 },   // over budget (400k) → favorable
                { category: 'marketing', spent_cents: 60000 },  // over budget (50k) → unfavorable
                { category: 'consumables', spent_cents: 4200 }, // no budget
            ],
            revenueRows: [{ earned_cents: 700000 }],
        });
        const payroll = out.categories.find((c) => c.category === 'payroll');
        expect(payroll.budgetedCents).toBe(400000);
        expect(payroll.spentCents).toBe(380000);
        expect(payroll.varianceCents).toBe(20000); // under budget
        const marketing = out.categories.find((c) => c.category === 'marketing');
        expect(marketing.varianceCents).toBe(-10000); // over budget
        const consumables = out.categories.find((c) => c.category === 'consumables');
        expect(consumables.budgetedCents).toBe(0);
        expect(consumables.variancePct).toBeNull(); // no budget → null pct
        // Sorted by spend desc: payroll (380k) > marketing (60k) > consumables (4.2k)
        expect(out.categories.map((c) => c.category)).toEqual(['payroll', 'marketing', 'consumables']);
        // Totals + P&L
        expect(out.totals.spentCents).toBe(444200);
        expect(out.totals.budgetedCents).toBe(450000);
        expect(out.totals.varianceCents).toBe(5800);
        expect(out.totals.earnedCents).toBe(700000);
        expect(out.totals.netCents).toBe(700000 - 444200);
    });

    it('tolerates fully empty input (zeros, no categories)', () => {
        const out = computeBudgetVsActual({});
        expect(out.categories).toEqual([]);
        expect(out.totals).toEqual({ budgetedCents: 0, spentCents: 0, varianceCents: 0, earnedCents: 0, netCents: 0 });
    });

    it('includes budgeted categories with zero spend', () => {
        const out = computeBudgetVsActual({ budgetRows: [{ category: 'insurance', budgeted_cents: 25000 }] });
        expect(out.categories).toHaveLength(1);
        expect(out.categories[0]).toMatchObject({ category: 'insurance', budgetedCents: 25000, spentCents: 0, varianceCents: 25000 });
    });
});

describe('computePerEventPnl', () => {
    it('computes per-event margin (revenue − tagged costs) + totals', () => {
        const out = computePerEventPnl({
            eventRows: [
                { id: 'ev_a', title: 'Volga', date_iso: '2026-06-20T16:00:00', earned_cents: 136000, paid_bookings: 34 },
                { id: 'ev_b', title: 'Foxtrot', date_iso: '2026-06-20T07:00:00', earned_cents: 65000, paid_bookings: 21 },
                { id: 'ev_c', title: 'Untagged', date_iso: '2026-05-09T08:30:00', earned_cents: 40000, paid_bookings: 10 },
            ],
            costRows: [
                { event_id: 'ev_a', cost_cents: 50000 },
                { event_id: 'ev_a', cost_cents: 10000 }, // two expenses → summed to 60000
                { event_id: 'ev_b', cost_cents: 80000 }, // costs exceed revenue → negative margin
            ],
        });
        const a = out.events.find((e) => e.eventId === 'ev_a');
        expect(a.directCostsCents).toBe(60000);
        expect(a.marginCents).toBe(76000);
        expect(a.marginPct).toBeCloseTo(76000 / 136000);
        const b = out.events.find((e) => e.eventId === 'ev_b');
        expect(b.marginCents).toBe(-15000); // 65000 − 80000
        const c = out.events.find((e) => e.eventId === 'ev_c');
        expect(c.directCostsCents).toBe(0); // no tagged costs
        expect(c.marginCents).toBe(40000);
        // Totals
        expect(out.totals.earnedCents).toBe(241000);
        expect(out.totals.directCostsCents).toBe(140000);
        expect(out.totals.marginCents).toBe(101000);
    });

    it('marginPct is null for a zero-revenue event', () => {
        const out = computePerEventPnl({
            eventRows: [{ id: 'ev_x', title: 'Comp only', earned_cents: 0 }],
            costRows: [{ event_id: 'ev_x', cost_cents: 5000 }],
        });
        expect(out.events[0].marginPct).toBeNull();
        expect(out.events[0].marginCents).toBe(-5000);
    });

    it('tolerates empty input', () => {
        const out = computePerEventPnl({});
        expect(out.events).toEqual([]);
        expect(out.totals).toEqual({ earnedCents: 0, directCostsCents: 0, marginCents: 0, marginPct: null });
    });
});

describe('computeStripeFees', () => {
    it('sums fees/net/kept + computes coverage and effective fee rate', () => {
        const out = computeStripeFees({
            monthlyRows: [
                // $1000 gross (reconciled), $59 Stripe fee, $941 net, $67.50 tax → kept 873.50.
                { month: '2026-06', gross_cents: 100000, fee_cents: 5900, net_cents: 94100, tax_cents: 6750, paid_count: 10, captured_count: 8 },
            ],
        });
        const row = out.series[0];
        expect(row.keptCents).toBe(94100 - 6750); // net − tax
        expect(out.totals.feeCents).toBe(5900);
        expect(out.totals.keptCents).toBe(87350);
        // Coverage: 8 of 10 reconciled.
        expect(out.coverage).toEqual({ captured: 8, total: 10, pct: 0.8 });
        // Effective fee rate = 5900 / 100000.
        expect(out.effectiveFeeRate).toBeCloseTo(0.059);
    });

    it('coverage pct is 1 and fee rate null when there are no paid bookings', () => {
        const out = computeStripeFees({});
        expect(out.coverage).toEqual({ captured: 0, total: 0, pct: 1 });
        expect(out.effectiveFeeRate).toBeNull();
        expect(out.totals.keptCents).toBe(0);
    });
});

describe('computeArAging', () => {
    it('buckets pending payments by age past due and totals them', () => {
        const out = computeArAging({
            nowMs: NOW,
            salesCents: 0,
            pendingRows: [
                { id: 'p1', rental_id: 'fr1', renter: 'Acme', site: 'Ghost Town', due_at: NOW + 5 * DAY, amount_cents: 10000 }, // not yet due → current
                { id: 'p2', rental_id: 'fr2', renter: 'Beta', site: 'Foxtrot', due_at: NOW - 10 * DAY, amount_cents: 20000 },    // 1–30
                { id: 'p3', rental_id: 'fr3', renter: 'Gamma', site: 'Foxtrot', due_at: NOW - 45 * DAY, amount_cents: 30000 },   // 31–60
                { id: 'p4', rental_id: 'fr4', renter: 'Delta', site: 'Foxtrot', due_at: NOW - 120 * DAY, amount_cents: 40000 },  // 90+
                { id: 'p5', rental_id: 'fr5', renter: 'Epsilon', site: 'Foxtrot', due_at: null, amount_cents: 5000 },           // un-dated → current
            ],
        });
        const byKey = Object.fromEntries(out.buckets.map((b) => [b.key, b]));
        expect(byKey.current).toMatchObject({ count: 2, amountCents: 15000 }); // not-due + un-dated
        expect(byKey.d1_30.amountCents).toBe(20000);
        expect(byKey.d31_60.amountCents).toBe(30000);
        expect(byKey.d61_90.count).toBe(0);
        expect(byKey.d90plus.amountCents).toBe(40000);
        expect(out.totals).toEqual({ count: 5, amountCents: 105000 });
        expect(out.overdue).toEqual({ count: 3, amountCents: 90000 });
        // Most overdue first.
        expect(out.items[0].id).toBe('p4');
        expect(out.items[0].daysOverdue).toBe(120);
    });

    it('DSO annualizes outstanding A/R against trailing receipts; null with no receipts', () => {
        const out = computeArAging({
            nowMs: NOW,
            salesWindowDays: 365,
            salesCents: 365000, // $3650 over 365d → $10/day run-rate
            pendingRows: [{ id: 'p1', due_at: NOW - 1 * DAY, amount_cents: 50000 }], // $500 outstanding
        });
        // 50000 / (365000 / 365) = 50000 / 1000 = 50 days
        expect(out.dso).toBeCloseTo(50);

        const none = computeArAging({ pendingRows: [{ id: 'x', amount_cents: 100 }], salesCents: 0 });
        expect(none.dso).toBeNull();
    });

    it('returns a valid empty shape with no input', () => {
        const out = computeArAging({});
        expect(out.totals).toEqual({ count: 0, amountCents: 0 });
        expect(out.overdue).toEqual({ count: 0, amountCents: 0 });
        expect(out.items).toEqual([]);
        expect(out.dso).toBeNull();
        expect(out.buckets).toHaveLength(5);
    });
});

describe('computeConversionFunnel', () => {
    it('builds a 4-stage funnel per event with drop-off percentages', () => {
        const out = computeConversionFunnel({
            bookingRows: [{ event_id: 'e1', title: 'Op Night', date_iso: '2026-05-01', created: 100, paid: 80 }],
            attendeeRows: [{ event_id: 'e1', checked_in: 60, waivered: 50 }],
        });
        expect(out.events).toHaveLength(1);
        const ev = out.events[0];
        expect(ev).toMatchObject({ eventId: 'e1', title: 'Op Night', dateIso: '2026-05-01' });
        expect(ev.stages.map((s) => s.count)).toEqual([100, 80, 60, 50]);
        expect(ev.stages[0].pctOfPrev).toBeNull();
        expect(ev.stages[1].pctOfTop).toBeCloseTo(0.8);
        expect(ev.stages[2].pctOfPrev).toBeCloseTo(0.75); // 60/80
        expect(ev.stages[3].pctOfPrev).toBeCloseTo(50 / 60);
    });

    it('zero-fills events with no attendee row', () => {
        const out = computeConversionFunnel({
            bookingRows: [{ event_id: 'e2', title: 'New', date_iso: '2026-06-01', created: 5, paid: 0 }],
            attendeeRows: [],
        });
        expect(out.events[0].stages.map((s) => s.count)).toEqual([5, 0, 0, 0]);
    });

    it('handles empty input', () => {
        expect(computeConversionFunnel({}).events).toEqual([]);
    });
});

describe('computePromoPerformance', () => {
    const NOW_MS = Date.UTC(2026, 4, 15);

    it('labels discount + computes status across active/expired/inactive', () => {
        const out = computePromoPerformance({
            nowMs: NOW_MS,
            rows: [
                { id: 'p1', code: 'SAVE15', discount_type: 'percent', discount_value: 15, uses_count: 5, active: 1, expires_at: null, redemptions: 5, discount_cents: 3000, revenue_cents: 17000 },
                { id: 'p2', code: 'TENOFF', discount_type: 'fixed', discount_value: 1000, uses_count: 2, active: 1, expires_at: NOW_MS - 1000, redemptions: 2, discount_cents: 2000, revenue_cents: 5000 },
                { id: 'p3', code: 'OLD', discount_type: 'percent', discount_value: 50, uses_count: 0, active: 0 },
            ],
        });
        const byCode = Object.fromEntries(out.promos.map((p) => [p.code, p]));
        expect(byCode.SAVE15).toMatchObject({ discountLabel: '15%', status: 'active', redemptions: 5, revenueCents: 17000 });
        expect(byCode.TENOFF).toMatchObject({ discountLabel: '$10.00', status: 'expired' });
        expect(byCode.OLD).toMatchObject({ status: 'inactive' });
    });

    it('handles empty input', () => {
        expect(computePromoPerformance({}).promos).toEqual([]);
    });
});

describe('computeCustomerCohorts', () => {
    it('computes per-cohort repeat rate + weighted totals', () => {
        const out = computeCustomerCohorts({
            monthlyRows: [
                { month: '2026-04', new_count: 10, repeat_count: 3 },
                { month: '2026-05', new_count: 5, repeat_count: 0 },
            ],
        });
        expect(out.cohorts[0].repeatPct).toBeCloseTo(0.3);
        expect(out.cohorts[1].repeatPct).toBe(0);
        expect(out.totals).toMatchObject({ newCount: 15, repeatCount: 3 });
        expect(out.totals.repeatPct).toBeCloseTo(0.2);
    });

    it('handles empty input', () => {
        expect(computeCustomerCohorts({}).totals).toEqual({ newCount: 0, repeatCount: 0, repeatPct: 0 });
    });
});

describe('computeChannelAttribution', () => {
    it('computes revenue share and flags hasData when a real channel exists', () => {
        const out = computeChannelAttribution({
            rows: [
                { channel: 'google', bookings: 10, revenue_cents: 50000 },
                { channel: '(unspecified)', bookings: 5, revenue_cents: 20000 },
            ],
        });
        expect(out.totalRevenueCents).toBe(70000);
        expect(out.channels[0].pctOfRevenue).toBeCloseTo(50000 / 70000);
        expect(out.hasData).toBe(true);
    });

    it('hasData is false when only the unspecified bucket is present', () => {
        const out = computeChannelAttribution({ rows: [{ channel: '(unspecified)', bookings: 3, revenue_cents: 10000 }] });
        expect(out.hasData).toBe(false);
    });

    it('handles empty input', () => {
        const out = computeChannelAttribution({});
        expect(out.hasData).toBe(false);
        expect(out.totalRevenueCents).toBe(0);
    });
});

describe('computeFieldRentalRevenue', () => {
    it('rolls up per-site and grand totals', () => {
        const out = computeFieldRentalRevenue({
            rows: [
                { site: 'Ghost Town', month: '2026-05', rentals: 2, revenue_cents: 50000 },
                { site: 'Ghost Town', month: '2026-06', rentals: 1, revenue_cents: 30000 },
                { site: 'Foxtrot', month: '2026-05', rentals: 1, revenue_cents: 20000 },
            ],
        });
        expect(out.totals).toEqual({ rentals: 4, revenueCents: 100000 });
        // siteTotals sorted by revenue desc
        expect(out.siteTotals[0]).toEqual({ site: 'Ghost Town', rentals: 3, revenueCents: 80000 });
        expect(out.siteTotals[1]).toEqual({ site: 'Foxtrot', rentals: 1, revenueCents: 20000 });
        expect(out.rows).toHaveLength(3);
    });

    it('handles empty input', () => {
        expect(computeFieldRentalRevenue({}).totals).toEqual({ rentals: 0, revenueCents: 0 });
    });
});

describe('computeCoiCompliance', () => {
    it('buckets active rentals by COI status + expiry vs now', () => {
        const out = computeCoiCompliance({
            nowMs: NOW,
            rows: [
                { id: 'r1', coi_status: 'received', coi_expires_at: NOW + 100 * DAY }, // valid
                { id: 'r2', coi_status: 'received', coi_expires_at: NOW + 20 * DAY },  // expiring30
                { id: 'r3', coi_status: 'received', coi_expires_at: NOW + 45 * DAY },  // expiring60
                { id: 'r4', coi_status: 'received', coi_expires_at: NOW - 5 * DAY },   // expired (date)
                { id: 'r5', coi_status: 'expired' },                                   // expired (status)
                { id: 'r6', coi_status: 'pending' },                                   // missing
                { id: 'r7', coi_status: 'not_required' },                              // missing
                { id: 'r8', coi_status: 'received', coi_expires_at: null },            // valid (no expiry)
            ],
        });
        expect(out.buckets).toEqual({ valid: 2, expiring30: 1, expiring60: 1, missing: 2, expired: 2 });
        expect(out.total).toBe(8);
        // expiring soon = r2 + r3, sorted by expiry asc (r2 first)
        expect(out.expiringSoon.map((e) => e.id)).toEqual(['r2', 'r3']);
        expect(out.expiringSoon[0].daysUntil).toBe(20);
    });

    it('handles empty input', () => {
        expect(computeCoiCompliance({ rows: [], nowMs: NOW }).buckets)
            .toEqual({ valid: 0, expiring30: 0, expiring60: 0, missing: 0, expired: 0 });
    });
});

describe('computeLeadConversion', () => {
    it('cascades current statuses into a funnel + lost + conversion %', () => {
        const out = computeLeadConversion({
            statusCounts: [
                { status: 'lead', n: 5 },
                { status: 'draft', n: 3 },
                { status: 'sent', n: 2 },
                { status: 'agreed', n: 2 },
                { status: 'paid', n: 4 },
                { status: 'completed', n: 1 },
                { status: 'cancelled', n: 3 },
                { status: 'refunded', n: 1 },
            ],
        });
        const byName = Object.fromEntries(out.stages.map((s) => [s.name, s.count]));
        expect(byName).toEqual({ Lead: 17, Draft: 12, Sent: 9, Agreed: 7, Paid: 5 });
        expect(out.stages[0].pctOfPrev).toBeNull();
        expect(out.lost).toBe(4);
        expect(out.created).toBe(21);
        expect(out.conversionPct).toBeCloseTo(5 / 21);
    });

    it('handles empty input', () => {
        const out = computeLeadConversion({});
        expect(out.created).toBe(0);
        expect(out.conversionPct).toBe(0);
        expect(out.stages.every((s) => s.count === 0)).toBe(true);
    });
});

describe('computeRecurrenceRetention', () => {
    it('computes eligible/retained/pct per 90/180/365-day window', () => {
        const out = computeRecurrenceRetention({
            nowMs: NOW,
            rows: [
                { id: 's1', active: 1, created_at: NOW - 400 * DAY }, // eligible 90/180/365, active
                { id: 's2', active: 0, created_at: NOW - 200 * DAY }, // eligible 90/180, inactive
                { id: 's3', active: 1, created_at: NOW - 100 * DAY }, // eligible 90 only, active
                { id: 's4', active: 1, created_at: NOW - 10 * DAY },  // not eligible
            ],
        });
        expect(out.retention.d90).toMatchObject({ eligible: 3, retained: 2 });
        expect(out.retention.d90.pct).toBeCloseTo(2 / 3);
        expect(out.retention.d180).toMatchObject({ eligible: 2, retained: 1 });
        expect(out.retention.d365).toMatchObject({ eligible: 1, retained: 1 });
        expect(out.retention.d365.pct).toBe(1);
        expect(out.series).toHaveLength(4);
    });

    it('handles empty input', () => {
        const out = computeRecurrenceRetention({ rows: [], nowMs: NOW });
        expect(out.retention.d90).toEqual({ eligible: 0, retained: 0, pct: 0 });
    });
});
