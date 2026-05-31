// M7 Batch 2 — Reports pure helpers.
//
// Period-window math + per-report compute/shape functions + CSV serialization.
// These are deliberately PURE (no D1, no env): the route handlers in
// worker/routes/admin/reports.js do the prepare().bind().all() and feed the
// raw D1 rows in here, so this module is fully unit-testable against plain
// fixtures (same split as worker/lib/money.js + src/admin/walkUpHelpers.js).
//
// Conventions inherited from worker/routes/admin/analytics.js so Reports
// reconcile with the dashboard:
//   - Gross = SUM(total_cents) over status IN ('paid','refunded') — refunding
//     flips status paid→refunded but preserves total_cents (lifetime received).
//   - Customer-aggregating reports filter customer_id != '__needs_backfill__'.
//   - Daily bucketing via date(paid_at/1000,'unixepoch'); series grouping uses
//     events.site (the series-branding column — events.series does NOT exist).

const DAY_MS = 86400000;

const PERIOD_LABELS = {
    mtd: 'Month to date',
    qtd: 'Quarter to date',
    ytd: 'Year to date',
    last_30d: 'Last 30 days',
    last_90d: 'Last 90 days',
};

export const SUPPORTED_PERIODS = ['mtd', 'qtd', 'ytd', 'last_30d', 'last_90d', 'custom'];

/**
 * Resolve a period selector into a half-open [startMs, endMs) window.
 * endMs is always "now". UTC boundaries for calendar periods.
 *
 * `custom` is not yet wired (Batch 11 polish) and falls back to last_30d,
 * matching the note in src/admin/reports/ReportFilters.jsx.
 *
 * @param {string} period - mtd | qtd | ytd | last_30d | last_90d | custom
 * @param {number} nowMs
 * @returns {{ period: string, requestedPeriod: string, startMs: number, endMs: number, label: string }}
 */
export function resolvePeriodWindow(period, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const d = new Date(now);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();

    let startMs;
    let resolved = period;
    switch (period) {
        case 'mtd':
            startMs = Date.UTC(y, m, 1);
            break;
        case 'qtd':
            startMs = Date.UTC(y, Math.floor(m / 3) * 3, 1);
            break;
        case 'ytd':
            startMs = Date.UTC(y, 0, 1);
            break;
        case 'last_30d':
            startMs = now - 30 * DAY_MS;
            break;
        case 'last_90d':
            startMs = now - 90 * DAY_MS;
            break;
        case 'custom':
        default:
            resolved = 'last_30d';
            startMs = now - 30 * DAY_MS;
            break;
    }

    return {
        period: resolved,
        requestedPeriod: period,
        startMs,
        endMs: now,
        label: PERIOD_LABELS[resolved] || PERIOD_LABELS.last_30d,
    };
}

/**
 * Equal-length window immediately preceding the given one
 * ("same number of days backward" per the reports scope doc).
 *
 * @param {{ startMs: number, endMs: number }} window
 * @returns {{ startMs: number, endMs: number }}
 */
export function priorWindow({ startMs, endMs }) {
    const span = endMs - startMs;
    return { startMs: startMs - span, endMs: startMs };
}

/**
 * Absolute + percentage delta. deltaPct is null when prior is 0 (no
 * divide-by-zero / fake ∞%); the UI renders "—" in that case.
 *
 * @param {number} current
 * @param {number} prior
 * @returns {{ delta: number, deltaPct: number|null }}
 */
export function computeDelta(current, prior) {
    const c = Number(current) || 0;
    const p = Number(prior) || 0;
    const delta = c - p;
    return { delta, deltaPct: p === 0 ? null : delta / p };
}

/**
 * Revenue trends — daily gross series + total + optional prior-period delta.
 *
 * @param {{ dailyRows?: Array<{d?:string, gross_cents?:number}>, priorTotalCents?: number|null }} input
 */
export function computeRevenueTrends({ dailyRows = [], priorTotalCents = null } = {}) {
    const series = dailyRows.map((r) => ({
        date: r.d ?? r.date,
        grossCents: Number(r.gross_cents ?? r.grossCents ?? 0),
    }));
    const totalCents = series.reduce((s, p) => s + p.grossCents, 0);
    return {
        series,
        totalCents,
        priorTotalCents: priorTotalCents == null ? null : Number(priorTotalCents),
        delta: priorTotalCents == null ? null : computeDelta(totalCents, priorTotalCents),
    };
}

/**
 * Refund rate — monthly {charged, refunded, rate} series + overall rate +
 * optional prior-period delta. "charged" = bookings ever paid/charged
 * (status IN paid|refunded); "refunded" counts BOTH Stripe (refunded_at) and
 * external (refund_external=1) refunds. rate is bounded [0,1].
 */
export function computeRefundRate({ monthlyRows = [], priorCharged = null, priorRefunded = null } = {}) {
    const series = monthlyRows.map((r) => {
        const charged = Number(r.charged ?? 0);
        const refunded = Number(r.refunded ?? 0);
        return {
            month: r.month ?? r.m,
            charged,
            refunded,
            rate: charged > 0 ? refunded / charged : 0,
        };
    });
    const charged = series.reduce((s, r) => s + r.charged, 0);
    const refunded = series.reduce((s, r) => s + r.refunded, 0);
    const rate = charged > 0 ? refunded / charged : 0;

    let priorRate = null;
    let delta = null;
    if (priorCharged != null) {
        const pc = Number(priorCharged) || 0;
        const pr = Number(priorRefunded) || 0;
        priorRate = pc > 0 ? pr / pc : 0;
        delta = computeDelta(rate, priorRate);
    }
    return { series, charged, refunded, rate, priorRate, delta };
}

/**
 * Average order value — monthly avg series + overall AOV + optional delta.
 * Overall AOV is recomputed from total sum / total count (NOT an average of
 * monthly averages, which would be wrong for uneven months).
 *
 * @param {{ monthlyRows?: Array<{month?:string, sum_cents?:number, n?:number}>, priorSumCents?: number|null, priorCount?: number|null }} input
 */
export function computeAovTrend({ monthlyRows = [], priorSumCents = null, priorCount = null } = {}) {
    const series = monthlyRows.map((r) => {
        const sum = Number(r.sum_cents ?? r.sumCents ?? 0);
        const n = Number(r.n ?? r.count ?? 0);
        return { month: r.month ?? r.m, bookings: n, avgCents: n > 0 ? Math.round(sum / n) : 0 };
    });
    const totalSum = monthlyRows.reduce((s, r) => s + Number(r.sum_cents ?? r.sumCents ?? 0), 0);
    const totalCount = monthlyRows.reduce((s, r) => s + Number(r.n ?? r.count ?? 0), 0);
    const aovCents = totalCount > 0 ? Math.round(totalSum / totalCount) : 0;

    let priorAovCents = null;
    let delta = null;
    if (priorSumCents != null) {
        const ps = Number(priorSumCents) || 0;
        const pn = Number(priorCount) || 0;
        priorAovCents = pn > 0 ? Math.round(ps / pn) : 0;
        delta = computeDelta(aovCents, priorAovCents);
    }
    return { series, aovCents, priorAovCents, bookings: totalCount, delta };
}

/**
 * Repeat-customer distribution. Buckets booked customers by lifetime
 * total_bookings into 2-3 / 4-9 / 10+. repeatPct = repeat / all-booked.
 * Caller passes only customers with total_bookings >= 1.
 *
 * @param {Array<{total_bookings?:number}>} rows
 */
export function bucketRepeatCustomers(rows = []) {
    const buckets = { '2-3': 0, '4-9': 0, '10+': 0 };
    let total = 0;
    let repeatTotal = 0;
    for (const r of rows) {
        const tb = Number(r.total_bookings ?? r.totalBookings ?? 0);
        total += 1;
        if (tb >= 2) repeatTotal += 1;
        if (tb >= 2 && tb <= 3) buckets['2-3'] += 1;
        else if (tb >= 4 && tb <= 9) buckets['4-9'] += 1;
        else if (tb >= 10) buckets['10+'] += 1;
    }
    return { buckets, total, repeatTotal, repeatPct: total > 0 ? repeatTotal / total : 0 };
}

/**
 * Series-to-series retention. Given (customer, series, first-seen date) rows,
 * orders series chronologically by earliest date and, for each adjacent pair,
 * computes the fraction of series-N customers who also booked series N+1.
 * Returns [] when fewer than 2 series are present.
 *
 * @param {Array<{customer_id?:string, series?:string, date_iso?:string}>} rows
 */
export function computeSeriesRetention(rows = []) {
    const seriesInfo = new Map(); // series -> { series, earliest, customers:Set }
    for (const r of rows) {
        const series = r.series ?? r.site;
        const cust = r.customer_id ?? r.customerId;
        if (!series || !cust) continue;
        const dateIso = r.date_iso ?? r.dateIso ?? '';
        let info = seriesInfo.get(series);
        if (!info) {
            info = { series, earliest: dateIso, customers: new Set() };
            seriesInfo.set(series, info);
        }
        if (dateIso && (!info.earliest || dateIso < info.earliest)) info.earliest = dateIso;
        info.customers.add(cust);
    }

    const ordered = [...seriesInfo.values()].sort((a, b) => {
        if (a.earliest === b.earliest) return a.series < b.series ? -1 : 1;
        return a.earliest < b.earliest ? -1 : 1;
    });

    const transitions = [];
    for (let i = 0; i < ordered.length - 1; i++) {
        const from = ordered[i];
        const to = ordered[i + 1];
        let retained = 0;
        for (const cust of from.customers) if (to.customers.has(cust)) retained += 1;
        const baseCount = from.customers.size;
        transitions.push({
            fromSeries: from.series,
            toSeries: to.series,
            baseCount,
            retainedCount: retained,
            retainedPct: baseCount > 0 ? retained / baseCount : 0,
        });
    }
    return transitions;
}

// ────────────────────────────────────────────────────────────────────
// CSV serialization (mirrors the csvEscape behavior in
// worker/lib/thresholds1099.js — wrap-and-double-quote on special chars).
// ────────────────────────────────────────────────────────────────────

export function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Serialize a header row + data rows to a CRLF-delimited CSV string.
 * @param {Array<string|number>} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function toCsv(headers, rows) {
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) lines.push(row.map(csvEscape).join(','));
    return lines.join('\r\n') + '\r\n';
}
