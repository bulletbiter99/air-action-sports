// M7 Batch 1a — admin Reports route shell.
//
// All 16 endpoints are implemented (Batches 2-5). Each is gated on the
// persona-specific capability from migration 0062 (403 at the cap-check
// stage); CSV export (?format=csv) additionally requires reports.export.
//
//   Owner reports (5)  — Batch 2: revenue-trends, retention, refund-rate,
//                                  repeat-customers, aov-trend
//   Bookkeeper (3)     — Batch 3: payouts, tax-fee-summary, period-comparison
//                                  (1099 thresholds links to existing M5 page)
//   Marketing (4)      — Batch 4: conversion-funnel, promo-performance,
//                                  customer-cohorts, channel-attribution
//   Site Coordinator(4)— Batch 5: field-rental-revenue, coi-compliance,
//                                  lead-conversion, recurrence-retention
//
// Mounted at /api/admin/reports in worker/index.js.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability, hasCapability } from '../../lib/capabilities.js';
import {
    resolvePeriodWindow,
    priorWindow,
    computeRevenueTrends,
    computeRefundRate,
    computeAovTrend,
    bucketRepeatCustomers,
    computeSeriesRetention,
    computePerEventPnl,
    computeScorecard,
    computePayoutsSummary,
    computeTaxFeeSummary,
    computePeriodComparison,
    computeBudgetVsActual,
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
    toCsv,
} from '../../lib/reports.js';

const adminReports = new Hono();
adminReports.use('*', requireAuth);

// ────────────────────────────────────────────────────────────────────
// Shared report-handler helpers (Batch 2)
// ────────────────────────────────────────────────────────────────────

// Parse the common query params + resolve the period window.
function reportParams(c) {
    const url = new URL(c.req.url);
    const period = url.searchParams.get('period') || 'mtd';
    const eventId = url.searchParams.get('event_id') || null;
    const cmp = url.searchParams.get('comparison');
    const comparison = cmp === '1' || cmp === 'true';
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    // Custom date range (Batch 11a) — from/to are ISO YYYY-MM-DD. Invalid/missing
    // → null → resolver falls back to last_30d (unchanged for non-custom requests).
    const customBounds = parseCustomBounds(url.searchParams.get('from'), url.searchParams.get('to'));
    const window = resolvePeriodWindow(period, Date.now(), customBounds);
    return { period, eventId, comparison, format, window };
}

// Convert ISO date-only strings (YYYY-MM-DD) into a UTC [startMs, endMs) window.
// `from` is 00:00:00Z; `to` advances one day so the selected end day is inclusive.
// Returns null when either is missing or unparseable (resolvePeriodWindow then
// validates start < end and falls back to last_30d if not).
function parseCustomBounds(from, to) {
    if (!from || !to) return null;
    const startMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(toMs)) return null;
    return { startMs, endMs: toMs + 86400000 };
}

// CSV export is gated on the reports.export capability (in addition to the
// per-tab reports.read.<persona> route gate). The requireCapability middleware
// has already loaded user.capabilities, so this sync check hits the cache.
function csvAllowed(c) {
    return hasCapability(c.get('user'), 'reports.export');
}

function csvForbidden(c) {
    return c.json({ error: 'Forbidden', requiresCapability: 'reports.export' }, 403);
}

function csvResponse(filename, headers, rows) {
    return new Response(toCsv(headers, rows), {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}.csv"`,
            'Cache-Control': 'no-store',
        },
    });
}

// cents → bare decimal string for CSV cells (no currency symbol).
const dollars = (cents) => (Number(cents) / 100).toFixed(2);

// ────────────────────────────────────────────────────────────────────
// Owner reports (Batch 2)
// ────────────────────────────────────────────────────────────────────

// 1. Revenue trends — daily gross over the period, vs prior when comparison.
adminReports.get('/owner/revenue-trends',
    requireCapability('reports.read.owner'),
    async (c) => {
        const { eventId, comparison, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const evt = eventId ? ' AND event_id = ?' : '';
        const dailyBinds = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const daily = await c.env.DB.prepare(
            `SELECT date(paid_at/1000,'unixepoch') AS d,
                    COALESCE(SUM(total_cents),0) AS gross_cents
             FROM bookings
             WHERE status IN ('paid','refunded') AND paid_at >= ? AND paid_at < ?${evt}
             GROUP BY d ORDER BY d ASC`
        ).bind(...dailyBinds).all();

        let priorTotalCents = null;
        if (comparison) {
            const pw = priorWindow(window);
            const pb = eventId ? [pw.startMs, pw.endMs, eventId] : [pw.startMs, pw.endMs];
            const row = await c.env.DB.prepare(
                `SELECT COALESCE(SUM(total_cents),0) AS gross_cents
                 FROM bookings
                 WHERE status IN ('paid','refunded') AND paid_at >= ? AND paid_at < ?${evt}`
            ).bind(...pb).first();
            priorTotalCents = row?.gross_cents ?? 0;
        }

        const payload = computeRevenueTrends({ dailyRows: daily.results || [], priorTotalCents });
        if (format === 'csv') {
            return csvResponse('revenue-trends', ['Date', 'Gross'],
                payload.series.map((p) => [p.date, dollars(p.grossCents)]));
        }
        return c.json({ report: 'revenue-trends', period: window.period, window, ...payload });
    });

// 2. Retention by event series (events.site branding). Uses full booking
//    history — series transitions need the whole timeline, so the period
//    filter does not constrain this report.
adminReports.get('/owner/retention',
    requireCapability('reports.read.owner'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const rows = await c.env.DB.prepare(
            `SELECT b.customer_id, e.site AS series, MIN(e.date_iso) AS date_iso
             FROM bookings b
             JOIN events e ON e.id = b.event_id
             WHERE b.status IN ('paid','comp')
               AND b.customer_id != '__needs_backfill__'
               AND e.site IS NOT NULL AND e.site != ''
             GROUP BY b.customer_id, e.site`
        ).all();

        const transitions = computeSeriesRetention(rows.results || []);
        if (format === 'csv') {
            return csvResponse('retention',
                ['From Series', 'To Series', 'Base', 'Retained', 'Retention %'],
                transitions.map((t) => [t.fromSeries, t.toSeries, t.baseCount, t.retainedCount, (t.retainedPct * 100).toFixed(1)]));
        }
        return c.json({ report: 'retention', transitions });
    });

// 3. Refund rate — monthly (refunded ÷ charged) over the period. Counts BOTH
//    Stripe (refunded_at) and external (refund_external=1) refunds.
adminReports.get('/owner/refund-rate',
    requireCapability('reports.read.owner'),
    async (c) => {
        const { eventId, comparison, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const evt = eventId ? ' AND event_id = ?' : '';
        const mb = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const monthly = await c.env.DB.prepare(
            `SELECT strftime('%Y-%m', paid_at/1000, 'unixepoch') AS month,
                    COUNT(CASE WHEN status IN ('paid','refunded') THEN 1 END) AS charged,
                    COUNT(CASE WHEN refunded_at IS NOT NULL OR refund_external = 1 THEN 1 END) AS refunded
             FROM bookings
             WHERE paid_at >= ? AND paid_at < ?${evt}
             GROUP BY month ORDER BY month ASC`
        ).bind(...mb).all();

        let priorCharged = null;
        let priorRefunded = null;
        if (comparison) {
            const pw = priorWindow(window);
            const pb = eventId ? [pw.startMs, pw.endMs, eventId] : [pw.startMs, pw.endMs];
            const row = await c.env.DB.prepare(
                `SELECT COUNT(CASE WHEN status IN ('paid','refunded') THEN 1 END) AS charged,
                        COUNT(CASE WHEN refunded_at IS NOT NULL OR refund_external = 1 THEN 1 END) AS refunded
                 FROM bookings WHERE paid_at >= ? AND paid_at < ?${evt}`
            ).bind(...pb).first();
            priorCharged = row?.charged ?? 0;
            priorRefunded = row?.refunded ?? 0;
        }

        const payload = computeRefundRate({ monthlyRows: monthly.results || [], priorCharged, priorRefunded });
        if (format === 'csv') {
            return csvResponse('refund-rate',
                ['Month', 'Charged', 'Refunded', 'Refund Rate %'],
                payload.series.map((r) => [r.month, r.charged, r.refunded, (r.rate * 100).toFixed(1)]));
        }
        return c.json({ report: 'refund-rate', period: window.period, window, ...payload });
    });

// 4. Repeat customers — lifetime distribution snapshot. Period filter does not
//    apply (total_bookings is a denormalized lifetime count). Excludes merged,
//    archived, and the backfill sentinel.
adminReports.get('/owner/repeat-customers',
    requireCapability('reports.read.owner'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const rows = await c.env.DB.prepare(
            `SELECT id, total_bookings
             FROM customers
             WHERE total_bookings >= 1 AND merged_into IS NULL AND archived_at IS NULL
               AND id != '__needs_backfill__'`
        ).all();

        const payload = bucketRepeatCustomers(rows.results || []);
        if (format === 'csv') {
            return csvResponse('repeat-customers', ['Bookings', 'Customers'],
                Object.entries(payload.buckets).map(([bucket, n]) => [bucket, n]));
        }
        return c.json({ report: 'repeat-customers', ...payload });
    });

// 5. AOV trend — monthly AVG(total_cents) over paid bookings, vs prior.
adminReports.get('/owner/aov-trend',
    requireCapability('reports.read.owner'),
    async (c) => {
        const { eventId, comparison, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const evt = eventId ? ' AND event_id = ?' : '';
        const mb = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const monthly = await c.env.DB.prepare(
            `SELECT strftime('%Y-%m', paid_at/1000, 'unixepoch') AS month,
                    COALESCE(SUM(total_cents),0) AS sum_cents,
                    COUNT(*) AS n
             FROM bookings
             WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?${evt}
             GROUP BY month ORDER BY month ASC`
        ).bind(...mb).all();

        let priorSumCents = null;
        let priorCount = null;
        if (comparison) {
            const pw = priorWindow(window);
            const pb = eventId ? [pw.startMs, pw.endMs, eventId] : [pw.startMs, pw.endMs];
            const row = await c.env.DB.prepare(
                `SELECT COALESCE(SUM(total_cents),0) AS sum_cents, COUNT(*) AS n
                 FROM bookings WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?${evt}`
            ).bind(...pb).first();
            priorSumCents = row?.sum_cents ?? 0;
            priorCount = row?.n ?? 0;
        }

        const payload = computeAovTrend({ monthlyRows: monthly.results || [], priorSumCents, priorCount });
        if (format === 'csv') {
            return csvResponse('aov-trend', ['Month', 'Bookings', 'AOV'],
                payload.series.map((r) => [r.month, r.bookings, dollars(r.avgCents)]));
        }
        return c.json({ report: 'aov-trend', period: window.period, window, ...payload });
    });

// 6. Per-event P&L — each event's earned revenue minus the expenses tagged to
//    it (expenses.event_id) = contribution margin. The period window selects
//    WHICH events to show (by event date); each event's revenue + costs are its
//    lifetime totals (an event's P&L spans all its sales regardless of when they
//    were paid). Earned revenue = total − tax − fee on paid/comp (income-card
//    basis). reports.read.owner holders are owner + bookkeeper — both hold the
//    finances caps, so cost visibility is appropriately gated.
adminReports.get('/owner/per-event-pnl',
    requireCapability('reports.read.owner'),
    async (c) => {
        const { format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        // Window selects events by calendar date. endMs is exclusive but == now
        // for calendar periods, so its date is today (events up through today).
        const startDate = new Date(window.startMs).toISOString().slice(0, 10);
        const endDate = new Date(window.endMs).toISOString().slice(0, 10);

        const [eventRes, costRes] = await Promise.all([
            c.env.DB.prepare(
                `SELECT e.id, e.title, e.date_iso,
                        COALESCE(SUM(CASE WHEN b.status IN ('paid','comp')
                                          THEN (b.total_cents - COALESCE(b.tax_cents,0) - COALESCE(b.fee_cents,0))
                                          ELSE 0 END), 0) AS earned_cents,
                        SUM(CASE WHEN b.status = 'paid' THEN 1 ELSE 0 END) AS paid_bookings
                 FROM events e
                 LEFT JOIN bookings b ON b.event_id = e.id
                 WHERE date(e.date_iso) >= ? AND date(e.date_iso) <= ?
                 GROUP BY e.id
                 ORDER BY e.date_iso DESC`
            ).bind(startDate, endDate).all(),
            c.env.DB.prepare(
                `SELECT event_id, COALESCE(SUM(amount_cents),0) AS cost_cents
                 FROM expenses WHERE event_id IS NOT NULL GROUP BY event_id`
            ).all(),
        ]);

        const payload = computePerEventPnl({ eventRows: eventRes.results || [], costRows: costRes.results || [] });
        if (format === 'csv') {
            return csvResponse('per-event-pnl',
                ['Event', 'Date', 'Revenue', 'Direct Costs', 'Margin', 'Margin %'],
                payload.events.map((e) => [
                    e.title, e.dateIso,
                    dollars(e.earnedCents), dollars(e.directCostsCents), dollars(e.marginCents),
                    e.marginPct == null ? '' : (e.marginPct * 100).toFixed(1),
                ]));
        }
        return c.json({ report: 'per-event-pnl', period: window.period, window, ...payload });
    });

// 7. Owner weekly scorecard — EOS Level-10-style 13-week grid of cash + demand
//    metrics, each auto-targeted to its own trailing-median (current week
//    excluded) so there's nothing to configure. Always the trailing 13 ISO weeks
//    (Monday 00:00 UTC); the period/event filters do NOT apply. Quiet weeks
//    (no sales / no FR receipts) render neutral, not red. The math lives in the
//    pure computeScorecard; the route just windows + buckets the D1 rows.
adminReports.get('/owner/scorecard',
    requireCapability('reports.read.owner'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const DAY = 86400000;
        const WEEK = 7 * DAY;
        const now = Date.now();
        const nd = new Date(now);
        const daysSinceMonday = (nd.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun..6=Sat → Mon=0
        const mondayUtc = Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth(), nd.getUTCDate()) - daysSinceMonday * DAY;
        const windowStartMs = mondayUtc - 12 * WEEK;      // oldest of 13 weeks
        const windowEndMs = mondayUtc + WEEK;             // end of the current (in-progress) week

        const weeks = [];
        for (let i = 0; i < 13; i++) {
            const startMs = windowStartMs + i * WEEK;
            weeks.push({
                index: i,
                startMs,
                endMs: startMs + WEEK,
                startIso: new Date(startMs).toISOString().slice(0, 10),
                isCurrent: i === 12,
                isPartial: i === 12,
            });
        }

        // Three grouped queries; each row's wk = integer week offset from window
        // start (0..12). status IN ('paid','comp') powers cash/earned/paid-count;
        // field-rental receipts + the refund charged/refunded counts are separate.
        // Comps are recorded as $0 (worker/routes/admin/bookings.js), so including
        // 'comp' in the cash/earned SUMs is a no-op (kept for parity with the
        // income-card basis); paid_count + the volume floor count only 'paid'.
        const [bk, fr, rf] = await Promise.all([
            c.env.DB.prepare(
                `SELECT CAST((paid_at - ?) / 604800000 AS INTEGER) AS wk,
                        COALESCE(SUM(total_cents),0) AS cash_cents,
                        COALESCE(SUM(total_cents - COALESCE(tax_cents,0) - COALESCE(fee_cents,0)),0) AS earned_cents,
                        SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid_count
                 FROM bookings
                 WHERE status IN ('paid','comp') AND paid_at >= ? AND paid_at < ?
                 GROUP BY wk`
            ).bind(windowStartMs, windowStartMs, windowEndMs).all(),
            c.env.DB.prepare(
                `SELECT CAST((received_at - ?) / 604800000 AS INTEGER) AS wk,
                        COALESCE(SUM(amount_cents),0) AS fr_cents
                 FROM field_rental_payments
                 WHERE status='received' AND received_at >= ? AND received_at < ?
                 GROUP BY wk`
            ).bind(windowStartMs, windowStartMs, windowEndMs).all(),
            // refund_rate = refunded / ever-charged, where charged counts every
            // booking that was ever charged (status IN ('paid','refunded')). This
            // is the standard "share of charged money refunded" basis and is
            // DELIBERATELY different from analytics.js's paid-only denominator
            // (refundedCount/paidCount) — the scorecard's is the more defensible one.
            c.env.DB.prepare(
                `SELECT CAST((paid_at - ?) / 604800000 AS INTEGER) AS wk,
                        COUNT(CASE WHEN status IN ('paid','refunded') THEN 1 END) AS charged,
                        COUNT(CASE WHEN refunded_at IS NOT NULL OR refund_external = 1 THEN 1 END) AS refunded
                 FROM bookings
                 WHERE paid_at >= ? AND paid_at < ?
                 GROUP BY wk`
            ).bind(windowStartMs, windowStartMs, windowEndMs).all(),
        ]);

        const slot = () => Array(13).fill(0);
        const cash = slot(), earned = slot(), paidCount = slot(), frCash = slot(), charged = slot(), refunded = slot();
        for (const r of (bk.results || [])) {
            const i = Number(r.wk);
            if (i >= 0 && i < 13) { cash[i] = Number(r.cash_cents) || 0; earned[i] = Number(r.earned_cents) || 0; paidCount[i] = Number(r.paid_count) || 0; }
        }
        for (const r of (fr.results || [])) {
            const i = Number(r.wk);
            if (i >= 0 && i < 13) frCash[i] = Number(r.fr_cents) || 0;
        }
        for (const r of (rf.results || [])) {
            const i = Number(r.wk);
            if (i >= 0 && i < 13) { charged[i] = Number(r.charged) || 0; refunded[i] = Number(r.refunded) || 0; }
        }

        // Derived (no extra round-trip): AOV = earned ÷ paid count; refund rate.
        const aov = paidCount.map((n, i) => (n > 0 ? Math.round(earned[i] / n) : null));
        const refundRate = charged.map((cnt, i) => (cnt > 0 ? refunded[i] / cnt : null));

        const metricInputs = [
            { key: 'cash_in',           label: 'Cash In',           unit: 'money',   direction: 'higher-better', weekValues: cash,       volumeByWeek: paidCount },
            { key: 'earned_revenue',    label: 'Earned Revenue',    unit: 'money',   direction: 'higher-better', weekValues: earned,     volumeByWeek: paidCount },
            { key: 'paid_bookings',     label: 'Paid Bookings',     unit: 'count',   direction: 'higher-better', weekValues: paidCount,  volumeByWeek: paidCount },
            { key: 'aov',               label: 'AOV',               unit: 'money',   direction: 'higher-better', weekValues: aov,        volumeByWeek: paidCount },
            { key: 'field_rental_cash', label: 'Field Rental Cash', unit: 'money',   direction: 'higher-better', weekValues: frCash,     volumeByWeek: frCash },
            { key: 'refund_rate',       label: 'Refund Rate',       unit: 'percent', direction: 'lower-better',  weekValues: refundRate, volumeByWeek: charged },
        ];

        const payload = computeScorecard({ weeks, metricInputs });

        if (format === 'csv') {
            const fmt = (unit, v) => (v == null ? '' : unit === 'money' ? dollars(v) : unit === 'percent' ? (v * 100).toFixed(1) : String(v));
            return csvResponse('owner-scorecard',
                ['Metric', 'Target', 'Avg', ...weeks.map((w) => w.startIso)],
                payload.metrics.map((m) => [
                    m.label, fmt(m.unit, m.target), fmt(m.unit, m.avg),
                    ...m.cells.map((cell) => fmt(m.unit, cell.value)),
                ]));
        }
        return c.json({ report: 'owner-scorecard', generatedAtMs: now, ...payload });
    });

// ────────────────────────────────────────────────────────────────────
// Bookkeeper reports (Batch 3)
// ────────────────────────────────────────────────────────────────────

// 1. Payouts summary — monthly Stripe (bookings) + field-rental gross + refunds.
adminReports.get('/bookkeeper/payouts',
    requireCapability('reports.read.bookkeeper'),
    async (c) => {
        const { eventId, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const evt = eventId ? ' AND event_id = ?' : '';
        const bBinds = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const booking = await c.env.DB.prepare(
            `SELECT strftime('%Y-%m', paid_at/1000,'unixepoch') AS month,
                    SUM(CASE WHEN status IN ('paid','refunded') THEN total_cents ELSE 0 END) AS gross_cents,
                    SUM(CASE WHEN status = 'refunded' THEN total_cents ELSE 0 END) AS refund_cents
             FROM bookings
             WHERE paid_at >= ? AND paid_at < ?${evt}
             GROUP BY month ORDER BY month ASC`
        ).bind(...bBinds).all();

        // Field rentals aren't event-scoped — skip the FR query when an event
        // filter is set (and flag it in the response).
        let frRows = [];
        if (!eventId) {
            const fr = await c.env.DB.prepare(
                `SELECT strftime('%Y-%m', received_at/1000,'unixepoch') AS month,
                        COALESCE(SUM(amount_cents),0) AS fr_gross_cents
                 FROM field_rental_payments
                 WHERE status = 'received' AND received_at >= ? AND received_at < ?
                 GROUP BY month ORDER BY month ASC`
            ).bind(window.startMs, window.endMs).all();
            frRows = fr.results || [];
        }

        const payload = computePayoutsSummary({ bookingRows: booking.results || [], frRows });
        if (format === 'csv') {
            return csvResponse('payouts-summary',
                ['Month', 'Stripe Gross', 'Field Rental Gross', 'Refunds', 'Net'],
                payload.rows.map((r) => [r.month, dollars(r.stripeGrossCents), dollars(r.fieldRentalGrossCents), dollars(r.refundsCents), dollars(r.netCents)]));
        }
        return c.json({
            report: 'payouts',
            period: window.period,
            window,
            scopedNote: eventId ? 'Field rentals excluded (not event-scoped).' : null,
            ...payload,
        });
    });

// 2. Tax/fee summary — monthly SUM(tax_cents) + SUM(fee_cents) over paid/comp.
adminReports.get('/bookkeeper/tax-fee-summary',
    requireCapability('reports.read.bookkeeper'),
    async (c) => {
        const { eventId, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const evt = eventId ? ' AND event_id = ?' : '';
        const mb = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const monthly = await c.env.DB.prepare(
            `SELECT strftime('%Y-%m', paid_at/1000,'unixepoch') AS month,
                    COALESCE(SUM(tax_cents),0) AS tax_cents,
                    COALESCE(SUM(fee_cents),0) AS fee_cents
             FROM bookings
             WHERE status IN ('paid','comp') AND paid_at >= ? AND paid_at < ?${evt}
             GROUP BY month ORDER BY month ASC`
        ).bind(...mb).all();

        const payload = computeTaxFeeSummary({ monthlyRows: monthly.results || [] });
        if (format === 'csv') {
            return csvResponse('tax-fee-summary',
                ['Month', 'Tax', 'Fees', 'Total'],
                payload.series.map((r) => [r.month, dollars(r.taxCents), dollars(r.feeCents), dollars(r.totalCents)]));
        }
        return c.json({ report: 'tax-fee-summary', period: window.period, window, ...payload });
    });

// 3. Period comparison — current window vs prior window (always compares).
adminReports.get('/bookkeeper/period-comparison',
    requireCapability('reports.read.bookkeeper'),
    async (c) => {
        const { eventId, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const pw = priorWindow(window);
        const evt = eventId ? ' AND event_id = ?' : '';
        const aggSql =
            `SELECT SUM(CASE WHEN status IN ('paid','refunded') THEN total_cents ELSE 0 END) AS gross_cents,
                    SUM(CASE WHEN status = 'refunded' THEN total_cents ELSE 0 END) AS refund_cents,
                    SUM(CASE WHEN status IN ('paid','comp') THEN tax_cents ELSE 0 END) AS tax_cents,
                    SUM(CASE WHEN status IN ('paid','comp') THEN fee_cents ELSE 0 END) AS fee_cents,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count
             FROM bookings WHERE paid_at >= ? AND paid_at < ?${evt}`;
        const curBinds = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const priBinds = eventId ? [pw.startMs, pw.endMs, eventId] : [pw.startMs, pw.endMs];
        const [current, prior] = await Promise.all([
            c.env.DB.prepare(aggSql).bind(...curBinds).first(),
            c.env.DB.prepare(aggSql).bind(...priBinds).first(),
        ]);

        const payload = computePeriodComparison({ current: current || {}, prior: prior || {} });
        if (format === 'csv') {
            return csvResponse('period-comparison',
                ['Metric', 'Current', 'Prior', 'Change %'],
                payload.metrics.map((m) => [
                    m.label,
                    m.kind === 'money' ? dollars(m.current) : m.current,
                    m.kind === 'money' ? dollars(m.prior) : m.prior,
                    m.delta.deltaPct == null ? '' : (m.delta.deltaPct * 100).toFixed(1),
                ]));
        }
        return c.json({ report: 'period-comparison', period: window.period, window, priorWindow: pw, ...payload });
    });

// 4. Budget vs actual (P&L vs budget) — per-category recorded expenses vs
//    monthly budgets, plus net income (earned revenue − expenses) over the
//    window. Expenses + budgets are org-wide (no event scope), so ?event_id
//    is intentionally ignored here. Earned revenue uses the same basis as the
//    income card: total − tax − fee on paid/comp bookings (refunds excluded).
adminReports.get('/bookkeeper/budget-vs-actual',
    requireCapability('reports.read.bookkeeper'),
    async (c) => {
        const { format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        // Months touched by the window (budgets are keyed YYYY-MM). endMs is
        // exclusive but == now for calendar periods, so its month is current.
        const startMonth = new Date(window.startMs).toISOString().slice(0, 7);
        const endMonth = new Date(window.endMs).toISOString().slice(0, 7);

        const [expenseRes, budgetRes, revenueRes] = await Promise.all([
            c.env.DB.prepare(
                `SELECT category, COALESCE(SUM(amount_cents),0) AS spent_cents
                 FROM expenses
                 WHERE incurred_at >= ? AND incurred_at < ?
                 GROUP BY category`
            ).bind(window.startMs, window.endMs).all(),
            c.env.DB.prepare(
                `SELECT category, period, budgeted_cents
                 FROM budgets
                 WHERE period >= ? AND period <= ?`
            ).bind(startMonth, endMonth).all(),
            c.env.DB.prepare(
                `SELECT COALESCE(SUM(total_cents - COALESCE(tax_cents,0) - COALESCE(fee_cents,0)),0) AS earned_cents
                 FROM bookings
                 WHERE status IN ('paid','comp') AND paid_at >= ? AND paid_at < ?`
            ).bind(window.startMs, window.endMs).first(),
        ]);

        const payload = computeBudgetVsActual({
            expenseRows: expenseRes.results || [],
            budgetRows: budgetRes.results || [],
            revenueRows: revenueRes ? [{ earned_cents: revenueRes.earned_cents }] : [],
        });

        if (format === 'csv') {
            return csvResponse('budget-vs-actual',
                ['Category', 'Budgeted', 'Spent', 'Variance'],
                payload.categories.map((r) => [r.category, dollars(r.budgetedCents), dollars(r.spentCents), dollars(r.varianceCents)]));
        }
        return c.json({ report: 'budget-vs-actual', period: window.period, window, ...payload });
    });

// 5. Stripe fees & true net — monthly ACTUAL Stripe fee/net (captured by the
//    runStripeFeeSync cron into bookings.stripe_fee_cents/_net) vs gross
//    charged, plus "kept" = net deposited − sales tax. Money columns are over
//    the RECONCILED subset (fee captured) so they stay consistent while the
//    nightly backfill catches up; `coverage` reports the reconciled fraction.
adminReports.get('/bookkeeper/stripe-fees',
    requireCapability('reports.read.bookkeeper'),
    async (c) => {
        const { eventId, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const evt = eventId ? ' AND event_id = ?' : '';
        const binds = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const monthly = await c.env.DB.prepare(
            `SELECT strftime('%Y-%m', paid_at/1000,'unixepoch') AS month,
                    COALESCE(SUM(CASE WHEN stripe_fee_cents IS NOT NULL THEN total_cents ELSE 0 END),0) AS gross_cents,
                    COALESCE(SUM(stripe_fee_cents),0) AS fee_cents,
                    COALESCE(SUM(stripe_net_cents),0) AS net_cents,
                    COALESCE(SUM(CASE WHEN stripe_fee_cents IS NOT NULL THEN tax_cents ELSE 0 END),0) AS tax_cents,
                    COUNT(*) AS paid_count,
                    SUM(CASE WHEN stripe_fee_cents IS NOT NULL THEN 1 ELSE 0 END) AS captured_count
             FROM bookings
             WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?${evt}
             GROUP BY month ORDER BY month ASC`
        ).bind(...binds).all();

        const payload = computeStripeFees({ monthlyRows: monthly.results || [] });
        if (format === 'csv') {
            return csvResponse('stripe-fees',
                ['Month', 'Gross', 'Stripe Fees', 'Net Deposited', 'Sales Tax', 'Kept'],
                payload.series.map((r) => [r.month, dollars(r.grossCents), dollars(r.feeCents), dollars(r.netCents), dollars(r.taxCents), dollars(r.keptCents)]));
        }
        return c.json({ report: 'stripe-fees', period: window.period, window, ...payload });
    });

// 6. Field-rental A/R aging + DSO — outstanding (pending) field-rental payments
//    bucketed by age past due_at, as a snapshot of NOW. The period + event
//    filters do NOT apply (A/R is what's owed today, not a windowed flow).
//    Tickets are prepaid via Stripe, so field rentals are AAS's only real
//    receivables. DSO annualizes the outstanding balance against field-rental
//    cash received over a trailing 365-day window.
adminReports.get('/bookkeeper/ar-aging',
    requireCapability('reports.read.bookkeeper'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const nowMs = Date.now();
        const DSO_WINDOW_DAYS = 365;
        const salesSinceMs = nowMs - DSO_WINDOW_DAYS * 86400000;

        const [pendingRes, salesRes] = await Promise.all([
            // Outstanding receivables. Excludes payments on dead deals: cancelling
            // or refunding a rental does NOT cascade to its pending payment rows
            // (see fieldRentals.js cancel), and those aren't real receivables.
            // Mirrors the sibling field-rental reports' fr.status filters. 'paid' /
            // 'completed' stay IN — they can still carry a pending damage/balance.
            c.env.DB.prepare(
                `SELECT frp.id, frp.rental_id, frp.due_at, frp.amount_cents,
                        COALESCE(NULLIF(c.business_name,''), c.full_name) AS renter,
                        s.name AS site
                 FROM field_rental_payments frp
                 JOIN field_rentals fr ON fr.id = frp.rental_id
                 JOIN customers c ON c.id = fr.customer_id
                 JOIN sites s ON s.id = fr.site_id
                 WHERE frp.status = 'pending'
                   AND fr.status NOT IN ('cancelled','refunded')`
            ).all(),
            // DSO denominator: field-rental cash actually received over the trailing
            // window. Cash-basis on purpose — historically-received cash is NOT
            // revised if a rental is later cancelled, so this intentionally does not
            // join/filter on field_rentals.status (unlike the numerator above).
            c.env.DB.prepare(
                `SELECT COALESCE(SUM(amount_cents),0) AS sales_cents
                 FROM field_rental_payments
                 WHERE status = 'received' AND received_at >= ?`
            ).bind(salesSinceMs).first(),
        ]);

        const payload = computeArAging({
            pendingRows: pendingRes.results || [],
            salesCents: salesRes?.sales_cents ?? 0,
            salesWindowDays: DSO_WINDOW_DAYS,
            nowMs,
        });

        if (format === 'csv') {
            return csvResponse('ar-aging',
                ['Renter', 'Site', 'Due Date', 'Days Overdue', 'Amount', 'Bucket'],
                payload.items.map((it) => [
                    it.renter || '', it.site || '',
                    it.dueAt == null ? '' : new Date(it.dueAt).toISOString().slice(0, 10),
                    it.daysOverdue == null ? '' : it.daysOverdue,
                    dollars(it.amountCents),
                    it.bucket,
                ]));
        }
        return c.json({ report: 'ar-aging', ...payload });
    });

// ────────────────────────────────────────────────────────────────────
// Marketing reports (Batch 4)
// ────────────────────────────────────────────────────────────────────

// 1. Conversion funnel by event — Bookings → Paid → Checked-in → Waivers.
adminReports.get('/marketing/conversion-funnel',
    requireCapability('reports.read.marketing'),
    async (c) => {
        const { eventId, format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);

        const FUNNEL_EVENT_CAP = 25;
        const evtWhere = eventId ? 'WHERE e.id = ?' : '';
        const bookingBinds = eventId ? [eventId, FUNNEL_EVENT_CAP + 1] : [FUNNEL_EVENT_CAP + 1];
        const bookingRes = await c.env.DB.prepare(
            `SELECT e.id AS event_id, e.title, e.date_iso,
                    COUNT(b.id) AS created,
                    SUM(CASE WHEN b.status IN ('paid','comp') THEN 1 ELSE 0 END) AS paid
             FROM events e
             LEFT JOIN bookings b ON b.event_id = e.id
             ${evtWhere}
             GROUP BY e.id
             ORDER BY e.date_iso DESC
             LIMIT ?`
        ).bind(...bookingBinds).all();
        let bookingRows = bookingRes.results || [];
        const truncated = bookingRows.length > FUNNEL_EVENT_CAP;
        if (truncated) bookingRows = bookingRows.slice(0, FUNNEL_EVENT_CAP);

        // Per-event attendee counts for just the events being shown.
        let attendeeRows = [];
        const ids = bookingRows.map((r) => r.event_id);
        if (ids.length) {
            const placeholders = ids.map(() => '?').join(',');
            const attRes = await c.env.DB.prepare(
                `SELECT b.event_id,
                        COUNT(CASE WHEN a.checked_in_at IS NOT NULL THEN 1 END) AS checked_in,
                        COUNT(CASE WHEN a.checked_in_at IS NOT NULL AND a.waiver_id IS NOT NULL THEN 1 END) AS waivered
                 FROM attendees a
                 JOIN bookings b ON b.id = a.booking_id
                 WHERE b.status IN ('paid','comp') AND b.event_id IN (${placeholders})
                 GROUP BY b.event_id`
            ).bind(...ids).all();
            attendeeRows = attRes.results || [];
        }

        const payload = computeConversionFunnel({ bookingRows, attendeeRows });
        if (format === 'csv') {
            const rows = [];
            for (const ev of payload.events) {
                for (const s of ev.stages) {
                    rows.push([ev.title, s.name, s.count, s.pctOfTop == null ? '' : (s.pctOfTop * 100).toFixed(1)]);
                }
            }
            return csvResponse('conversion-funnel', ['Event', 'Stage', 'Count', '% of Bookings'], rows);
        }
        return c.json({ report: 'conversion-funnel', truncated, ...payload });
    });

// 2. Promo code performance — per-code lifetime usage + revenue attributed.
adminReports.get('/marketing/promo-performance',
    requireCapability('reports.read.marketing'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);
        const res = await c.env.DB.prepare(
            `SELECT pc.id, pc.code, pc.discount_type, pc.discount_value, pc.uses_count, pc.active, pc.expires_at,
                    COUNT(b.id) AS redemptions,
                    COALESCE(SUM(b.discount_cents),0) AS discount_cents,
                    COALESCE(SUM(CASE WHEN b.status IN ('paid','refunded') THEN b.total_cents ELSE 0 END),0) AS revenue_cents
             FROM promo_codes pc
             LEFT JOIN bookings b ON b.promo_code_id = pc.id AND b.status IN ('paid','comp','refunded')
             GROUP BY pc.id
             ORDER BY revenue_cents DESC, pc.created_at DESC`
        ).all();
        const payload = computePromoPerformance({ rows: res.results || [], nowMs: Date.now() });
        if (format === 'csv') {
            return csvResponse('promo-performance',
                ['Code', 'Discount', 'Uses', 'Redemptions', 'Discount Given', 'Revenue', 'Status'],
                payload.promos.map((p) => [p.code, p.discountLabel, p.uses, p.redemptions, dollars(p.discountCents), dollars(p.revenueCents), p.status]));
        }
        return c.json({ report: 'promo-performance', ...payload });
    });

// 3. Customer cohorts by acquisition month (lifetime; period/event N/A).
adminReports.get('/marketing/customer-cohorts',
    requireCapability('reports.read.marketing'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);
        const res = await c.env.DB.prepare(
            `SELECT strftime('%Y-%m', first_booking_at/1000,'unixepoch') AS month,
                    COUNT(*) AS new_count,
                    SUM(CASE WHEN total_bookings >= 2 THEN 1 ELSE 0 END) AS repeat_count
             FROM customers
             WHERE first_booking_at IS NOT NULL AND merged_into IS NULL AND archived_at IS NULL
               AND id != '__needs_backfill__'
             GROUP BY month ORDER BY month ASC`
        ).all();
        const payload = computeCustomerCohorts({ monthlyRows: res.results || [] });
        if (format === 'csv') {
            return csvResponse('customer-cohorts',
                ['Acquisition Month', 'New Customers', 'Repeat', 'Repeat %'],
                payload.cohorts.map((co) => [co.month, co.newCount, co.repeatCount, (co.repeatPct * 100).toFixed(1)]));
        }
        return c.json({ report: 'customer-cohorts', ...payload });
    });

// 4. Channel attribution — paid bookings grouped by referral (period + event).
adminReports.get('/marketing/channel-attribution',
    requireCapability('reports.read.marketing'),
    async (c) => {
        const { eventId, format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);
        const evt = eventId ? ' AND event_id = ?' : '';
        const binds = eventId ? [window.startMs, window.endMs, eventId] : [window.startMs, window.endMs];
        const res = await c.env.DB.prepare(
            `SELECT COALESCE(NULLIF(TRIM(referral),''),'(unspecified)') AS channel,
                    COUNT(*) AS bookings,
                    COALESCE(SUM(total_cents),0) AS revenue_cents
             FROM bookings
             WHERE status IN ('paid','comp','refunded') AND paid_at >= ? AND paid_at < ?${evt}
             GROUP BY channel ORDER BY revenue_cents DESC`
        ).bind(...binds).all();
        const payload = computeChannelAttribution({ rows: res.results || [] });
        if (format === 'csv') {
            return csvResponse('channel-attribution',
                ['Channel', 'Bookings', 'Revenue', '% of Revenue'],
                payload.channels.map((ch) => [ch.channel, ch.bookings, dollars(ch.revenueCents), (ch.pctOfRevenue * 100).toFixed(1)]));
        }
        return c.json({ report: 'channel-attribution', period: window.period, window, ...payload });
    });

// ────────────────────────────────────────────────────────────────────
// Site Coordinator reports (Batch 5)
// ────────────────────────────────────────────────────────────────────

// 1. Field rental revenue by site — realized (paid+completed) revenue per
//    site, by month. Period windows scheduled_starts_at.
adminReports.get('/site-coordinator/field-rental-revenue',
    requireCapability('reports.read.site_coordinator'),
    async (c) => {
        const { format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);
        const res = await c.env.DB.prepare(
            `SELECT s.name AS site,
                    strftime('%Y-%m', fr.scheduled_starts_at/1000,'unixepoch') AS month,
                    COUNT(*) AS rentals,
                    COALESCE(SUM(fr.total_cents),0) AS revenue_cents
             FROM field_rentals fr
             JOIN sites s ON s.id = fr.site_id
             WHERE fr.status IN ('paid','completed')
               AND fr.scheduled_starts_at >= ? AND fr.scheduled_starts_at < ?
             GROUP BY s.name, month
             ORDER BY s.name ASC, month ASC`
        ).bind(window.startMs, window.endMs).all();
        const payload = computeFieldRentalRevenue({ rows: res.results || [] });
        if (format === 'csv') {
            return csvResponse('field-rental-revenue',
                ['Site', 'Month', 'Rentals', 'Revenue'],
                payload.rows.map((r) => [r.site, r.month, r.rentals, dollars(r.revenueCents)]));
        }
        return c.json({ report: 'field-rental-revenue', period: window.period, window, ...payload });
    });

// 2. COI compliance — active rentals bucketed by certificate status (snapshot).
adminReports.get('/site-coordinator/coi-compliance',
    requireCapability('reports.read.site_coordinator'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);
        const res = await c.env.DB.prepare(
            `SELECT fr.id, s.name AS site, fr.coi_status, fr.coi_expires_at, fr.scheduled_starts_at
             FROM field_rentals fr
             JOIN sites s ON s.id = fr.site_id
             WHERE fr.status IN ('sent','agreed','paid','completed') AND fr.archived_at IS NULL`
        ).all();
        const payload = computeCoiCompliance({ rows: res.results || [], nowMs: Date.now() });
        if (format === 'csv') {
            return csvResponse('coi-compliance', ['Status', 'Active Rentals'],
                Object.entries(payload.buckets).map(([bucket, n]) => [bucket, n]));
        }
        return c.json({ report: 'coi-compliance', ...payload });
    });

// 3. Lead-to-booking conversion — field-rental pipeline funnel (period windows
//    created_at). Approximated from current status (see lib note).
adminReports.get('/site-coordinator/lead-conversion',
    requireCapability('reports.read.site_coordinator'),
    async (c) => {
        const { format, window } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);
        const res = await c.env.DB.prepare(
            `SELECT status, COUNT(*) AS n
             FROM field_rentals
             WHERE created_at >= ? AND created_at < ?
             GROUP BY status`
        ).bind(window.startMs, window.endMs).all();
        const payload = computeLeadConversion({ statusCounts: res.results || [] });
        if (format === 'csv') {
            return csvResponse('lead-conversion', ['Stage', 'Count', '% of Leads'],
                payload.stages.map((s) => [s.name, s.count, s.pctOfTop == null ? '' : (s.pctOfTop * 100).toFixed(1)]));
        }
        return c.json({ report: 'lead-conversion', period: window.period, window, ...payload });
    });

// 4. Recurrence retention — % of recurrence series still active at 90/180/365d
//    (snapshot; period N/A).
adminReports.get('/site-coordinator/recurrence-retention',
    requireCapability('reports.read.site_coordinator'),
    async (c) => {
        const { format } = reportParams(c);
        if (format === 'csv' && !csvAllowed(c)) return csvForbidden(c);
        const res = await c.env.DB.prepare(
            `SELECT r.id, s.name AS site, r.frequency, r.starts_on, r.active, r.created_at
             FROM field_rental_recurrences r
             JOIN sites s ON s.id = r.site_id
             ORDER BY r.created_at DESC`
        ).all();
        const payload = computeRecurrenceRetention({ rows: res.results || [], nowMs: Date.now() });
        if (format === 'csv') {
            return csvResponse('recurrence-retention', ['Window', 'Eligible', 'Retained', 'Retention %'],
                Object.entries(payload.retention).map(([win, b]) => [win, b.eligible, b.retained, (b.pct * 100).toFixed(1)]));
        }
        return c.json({ report: 'recurrence-retention', ...payload });
    });

export default adminReports;
