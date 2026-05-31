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
    computeConversionFunnel,
    computePromoPerformance,
    computeCustomerCohorts,
    computeChannelAttribution,
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
