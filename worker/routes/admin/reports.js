// M7 Batch 1a — admin Reports route shell.
//
// All 16 endpoints return 501 Not Implemented until populated in Batches 2-5
// (per persona). Each endpoint is gated on the persona-specific capability
// from migration 0062, so 403s fire at the cap-check stage before 501.
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
    computePayoutsSummary,
    computeTaxFeeSummary,
    computePeriodComparison,
    toCsv,
} from '../../lib/reports.js';

const adminReports = new Hono();
adminReports.use('*', requireAuth);

function notImplemented(c, persona, report) {
    return c.json({
        error: 'Not implemented',
        persona,
        report,
        status: 'stub',
        note: 'M7 Batches 2-5 will populate this endpoint per persona.',
    }, 501);
}

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
    const window = resolvePeriodWindow(period, Date.now());
    return { period, eventId, comparison, format, window };
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

// ────────────────────────────────────────────────────────────────────
// Marketing reports (Batch 4)
// ────────────────────────────────────────────────────────────────────

adminReports.get('/marketing/conversion-funnel',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'conversion-funnel'));

adminReports.get('/marketing/promo-performance',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'promo-performance'));

adminReports.get('/marketing/customer-cohorts',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'customer-cohorts'));

adminReports.get('/marketing/channel-attribution',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'channel-attribution'));

// ────────────────────────────────────────────────────────────────────
// Site Coordinator reports (Batch 5)
// ────────────────────────────────────────────────────────────────────

adminReports.get('/site-coordinator/field-rental-revenue',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'field-rental-revenue'));

adminReports.get('/site-coordinator/coi-compliance',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'coi-compliance'));

adminReports.get('/site-coordinator/lead-conversion',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'lead-conversion'));

adminReports.get('/site-coordinator/recurrence-retention',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'recurrence-retention'));

export default adminReports;
