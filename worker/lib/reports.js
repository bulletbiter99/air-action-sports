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
// Bookkeeper report shapers (Batch 3)
// ────────────────────────────────────────────────────────────────────

/**
 * Payouts summary — merge monthly booking revenue with monthly field-rental
 * payments into one per-month table. Net = stripeGross − refunds + frGross.
 *
 * @param {{ bookingRows?: Array<{month?:string, gross_cents?:number, refund_cents?:number}>,
 *           frRows?: Array<{month?:string, fr_gross_cents?:number}> }} input
 */
export function computePayoutsSummary({ bookingRows = [], frRows = [] } = {}) {
    const byMonth = new Map();
    const ensure = (m) => {
        let r = byMonth.get(m);
        if (!r) {
            r = { month: m, stripeGrossCents: 0, fieldRentalGrossCents: 0, refundsCents: 0 };
            byMonth.set(m, r);
        }
        return r;
    };
    for (const b of bookingRows) {
        const m = b.month ?? b.m;
        if (!m) continue;
        const r = ensure(m);
        r.stripeGrossCents += Number(b.gross_cents ?? 0);
        r.refundsCents += Number(b.refund_cents ?? 0);
    }
    for (const f of frRows) {
        const m = f.month ?? f.m;
        if (!m) continue;
        ensure(m).fieldRentalGrossCents += Number(f.fr_gross_cents ?? f.frGrossCents ?? 0);
    }

    const rows = [...byMonth.values()]
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
        .map((r) => ({ ...r, netCents: r.stripeGrossCents - r.refundsCents + r.fieldRentalGrossCents }));

    const totals = rows.reduce((t, r) => ({
        stripeGrossCents: t.stripeGrossCents + r.stripeGrossCents,
        fieldRentalGrossCents: t.fieldRentalGrossCents + r.fieldRentalGrossCents,
        refundsCents: t.refundsCents + r.refundsCents,
        netCents: t.netCents + r.netCents,
    }), { stripeGrossCents: 0, fieldRentalGrossCents: 0, refundsCents: 0, netCents: 0 });

    return { rows, totals };
}

/**
 * Tax/fee summary — monthly tax + fee series + totals.
 *
 * @param {{ monthlyRows?: Array<{month?:string, tax_cents?:number, fee_cents?:number}> }} input
 */
export function computeTaxFeeSummary({ monthlyRows = [] } = {}) {
    const series = monthlyRows.map((r) => {
        const taxCents = Number(r.tax_cents ?? r.taxCents ?? 0);
        const feeCents = Number(r.fee_cents ?? r.feeCents ?? 0);
        return { month: r.month ?? r.m, taxCents, feeCents, totalCents: taxCents + feeCents };
    });
    const totals = series.reduce((t, r) => ({
        taxCents: t.taxCents + r.taxCents,
        feeCents: t.feeCents + r.feeCents,
        totalCents: t.totalCents + r.totalCents,
    }), { taxCents: 0, feeCents: 0, totalCents: 0 });
    return { series, totals };
}

/**
 * Period comparison — current window vs prior window, one metric per row with
 * a delta. Net = gross − refunds; AOV = net ÷ paid bookings. Tolerates
 * null/empty inputs (coerced to 0) so empty windows produce a valid shape.
 *
 * @param {{ current?: object, prior?: object }} input - each side
 *   { gross_cents, refund_cents, tax_cents, fee_cents, paid_count }
 */
export function computePeriodComparison({ current = {}, prior = {} } = {}) {
    const derive = (o) => {
        const gross = Number(o?.gross_cents ?? 0) || 0;
        const refunds = Number(o?.refund_cents ?? 0) || 0;
        const tax = Number(o?.tax_cents ?? 0) || 0;
        const fee = Number(o?.fee_cents ?? 0) || 0;
        const bookings = Number(o?.paid_count ?? 0) || 0;
        const net = gross - refunds;
        return { gross, refunds, net, tax, fee, bookings, aov: bookings > 0 ? Math.round(net / bookings) : 0 };
    };
    const c = derive(current);
    const p = derive(prior);

    const defs = [
        { key: 'gross', label: 'Gross', kind: 'money' },
        { key: 'refunds', label: 'Refunds', kind: 'money' },
        { key: 'net', label: 'Net', kind: 'money' },
        { key: 'tax', label: 'Tax', kind: 'money' },
        { key: 'fee', label: 'Fees', kind: 'money' },
        { key: 'bookings', label: 'Bookings', kind: 'count' },
        { key: 'aov', label: 'AOV', kind: 'money' },
    ];
    const metrics = defs.map((d) => ({
        key: d.key,
        label: d.label,
        kind: d.kind,
        current: c[d.key],
        prior: p[d.key],
        delta: computeDelta(c[d.key], p[d.key]),
    }));
    return { metrics };
}

// ────────────────────────────────────────────────────────────────────
// Marketing report shapers (Batch 4)
// ────────────────────────────────────────────────────────────────────

const FUNNEL_STAGE_NAMES = ['Bookings', 'Paid', 'Checked-in', 'Waivers'];

/**
 * Conversion funnel by event — merge per-event booking counts with per-event
 * attendee counts into a 4-stage funnel each. Stage units are mixed (bookings
 * for stages 1-2, attendees for 3-4), matching the M4 /analytics/funnel
 * definition; labeled clearly.
 *
 * @param {{ bookingRows?: Array<{event_id?:string,title?:string,date_iso?:string,created?:number,paid?:number}>,
 *           attendeeRows?: Array<{event_id?:string,checked_in?:number,waivered?:number}> }} input
 */
export function computeConversionFunnel({ bookingRows = [], attendeeRows = [] } = {}) {
    const attByEvent = new Map();
    for (const a of attendeeRows) {
        const id = a.event_id ?? a.eventId;
        if (id != null) attByEvent.set(id, a);
    }
    const events = bookingRows.map((b) => {
        const id = b.event_id ?? b.eventId;
        const att = attByEvent.get(id) || {};
        const counts = [
            Number(b.created ?? 0),
            Number(b.paid ?? 0),
            Number(att.checked_in ?? att.checkedIn ?? 0),
            Number(att.waivered ?? 0),
        ];
        const top = counts[0];
        const stages = counts.map((count, i) => ({
            name: FUNNEL_STAGE_NAMES[i],
            count,
            pctOfTop: top > 0 ? count / top : 0,
            pctOfPrev: i === 0 ? null : (counts[i - 1] > 0 ? count / counts[i - 1] : 0),
        }));
        return { eventId: id, title: b.title, dateIso: b.date_iso ?? b.dateIso, stages };
    });
    return { events };
}

/**
 * Promo code performance — per-code label + lifetime usage/revenue + a
 * computed status. `nowMs` is passed in (no Date.now() in the pure helper).
 */
export function computePromoPerformance({ rows = [], nowMs = 0 } = {}) {
    const promos = rows.map((r) => {
        const type = r.discount_type ?? r.discountType;
        const value = Number(r.discount_value ?? r.discountValue ?? 0);
        const discountLabel = type === 'percent' ? `${value}%` : `$${(value / 100).toFixed(2)}`;
        const active = r.active === 1 || r.active === true;
        const expiresAt = r.expires_at ?? r.expiresAt ?? null;
        let status = 'active';
        if (!active) status = 'inactive';
        else if (expiresAt != null && Number(expiresAt) < nowMs) status = 'expired';
        return {
            id: r.id,
            code: r.code,
            discountLabel,
            uses: Number(r.uses_count ?? r.usesCount ?? 0),
            redemptions: Number(r.redemptions ?? 0),
            discountCents: Number(r.discount_cents ?? 0),
            revenueCents: Number(r.revenue_cents ?? 0),
            status,
        };
    });
    return { promos };
}

/**
 * Customer cohorts by acquisition month — repeat rate per cohort + totals.
 * @param {{ monthlyRows?: Array<{month?:string,new_count?:number,repeat_count?:number}> }} input
 */
export function computeCustomerCohorts({ monthlyRows = [] } = {}) {
    const cohorts = monthlyRows.map((r) => {
        const newCount = Number(r.new_count ?? r.newCount ?? 0);
        const repeatCount = Number(r.repeat_count ?? r.repeatCount ?? 0);
        return { month: r.month ?? r.m, newCount, repeatCount, repeatPct: newCount > 0 ? repeatCount / newCount : 0 };
    });
    const totals = cohorts.reduce((t, c) => ({
        newCount: t.newCount + c.newCount,
        repeatCount: t.repeatCount + c.repeatCount,
    }), { newCount: 0, repeatCount: 0 });
    totals.repeatPct = totals.newCount > 0 ? totals.repeatCount / totals.newCount : 0;
    return { cohorts, totals };
}

/**
 * Channel attribution — revenue + share per referral channel. `hasData` is
 * false when there are no rows or the only channel is the unspecified bucket,
 * which drives the UI's explanatory empty state.
 *
 * @param {{ rows?: Array<{channel?:string,bookings?:number,revenue_cents?:number}> }} input
 */
export function computeChannelAttribution({ rows = [] } = {}) {
    const totalRevenueCents = rows.reduce((s, r) => s + Number(r.revenue_cents ?? 0), 0);
    const channels = rows.map((r) => {
        const revenueCents = Number(r.revenue_cents ?? 0);
        return {
            channel: r.channel,
            bookings: Number(r.bookings ?? 0),
            revenueCents,
            pctOfRevenue: totalRevenueCents > 0 ? revenueCents / totalRevenueCents : 0,
        };
    });
    const hasData = channels.some((c) => c.channel !== '(unspecified)');
    return { channels, totalRevenueCents, hasData };
}

// ────────────────────────────────────────────────────────────────────
// Site Coordinator report shapers (Batch 5)
// ────────────────────────────────────────────────────────────────────

/**
 * Field rental revenue by site — per (site, month) rows + per-site + grand
 * totals. SQL groups by site + month; the helper just normalizes + sums.
 *
 * @param {{ rows?: Array<{site?:string,month?:string,rentals?:number,revenue_cents?:number}> }} input
 */
export function computeFieldRentalRevenue({ rows = [] } = {}) {
    const normalized = rows.map((r) => ({
        site: r.site,
        month: r.month ?? r.m,
        rentals: Number(r.rentals ?? 0),
        revenueCents: Number(r.revenue_cents ?? r.revenueCents ?? 0),
    }));
    const bySite = new Map();
    for (const r of normalized) {
        let s = bySite.get(r.site);
        if (!s) { s = { site: r.site, rentals: 0, revenueCents: 0 }; bySite.set(r.site, s); }
        s.rentals += r.rentals;
        s.revenueCents += r.revenueCents;
    }
    const siteTotals = [...bySite.values()].sort((a, b) => b.revenueCents - a.revenueCents);
    const totals = normalized.reduce(
        (t, r) => ({ rentals: t.rentals + r.rentals, revenueCents: t.revenueCents + r.revenueCents }),
        { rentals: 0, revenueCents: 0 },
    );
    return { rows: normalized, siteTotals, totals };
}

const DAY_MS_REPORTS = 86400000;

/**
 * COI compliance snapshot — bucket active rentals by certificate status vs
 * `nowMs` into 5 mutually-exclusive buckets, plus an expiring-soon list (≤60d).
 *
 * @param {{ rows?: Array<{id?:string,site?:string,coi_status?:string,coi_expires_at?:number,scheduled_starts_at?:number}>, nowMs?: number }} input
 */
export function computeCoiCompliance({ rows = [], nowMs = 0 } = {}) {
    const buckets = { valid: 0, expiring30: 0, expiring60: 0, missing: 0, expired: 0 };
    const expiringSoon = [];
    for (const r of rows) {
        const status = r.coi_status ?? r.coiStatus;
        const exp = r.coi_expires_at ?? r.coiExpiresAt ?? null;
        let bucket;
        if (status === 'received') {
            if (exp == null) bucket = 'valid';
            else if (exp <= nowMs) bucket = 'expired';
            else if (exp <= nowMs + 30 * DAY_MS_REPORTS) bucket = 'expiring30';
            else if (exp <= nowMs + 60 * DAY_MS_REPORTS) bucket = 'expiring60';
            else bucket = 'valid';
        } else if (status === 'expired') {
            bucket = 'expired';
        } else {
            bucket = 'missing'; // not_required | pending
        }
        buckets[bucket] += 1;
        if (bucket === 'expiring30' || bucket === 'expiring60') {
            expiringSoon.push({
                id: r.id,
                site: r.site,
                coiExpiresAt: exp,
                scheduledStartsAt: r.scheduled_starts_at ?? r.scheduledStartsAt ?? null,
                daysUntil: exp != null ? Math.ceil((exp - nowMs) / DAY_MS_REPORTS) : null,
            });
        }
    }
    expiringSoon.sort((a, b) => (a.coiExpiresAt ?? Infinity) - (b.coiExpiresAt ?? Infinity));
    return { buckets, expiringSoon, total: rows.length };
}

/**
 * Lead-to-booking conversion funnel. Derived from CURRENT status (no status-
 * history table), so the funnel cascades over non-terminal forward ranks and
 * cancelled/refunded count as `lost` rather than mid-funnel drop-offs. A true
 * historical funnel is a future enhancement.
 *
 * @param {{ statusCounts?: Array<{status?:string,n?:number}> }} input
 */
export function computeLeadConversion({ statusCounts = [] } = {}) {
    const counts = {};
    for (const r of statusCounts) counts[r.status] = Number(r.n ?? 0);
    const c = (s) => counts[s] || 0;

    const reachedPaid = c('paid') + c('completed');
    const reachedAgreed = reachedPaid + c('agreed');
    const reachedSent = reachedAgreed + c('sent');
    const reachedDraft = reachedSent + c('draft');
    const reachedLead = reachedDraft + c('lead'); // all non-terminal
    const lost = c('cancelled') + c('refunded');
    const created = reachedLead + lost;
    const top = reachedLead;

    const stageDefs = [
        ['Lead', reachedLead],
        ['Draft', reachedDraft],
        ['Sent', reachedSent],
        ['Agreed', reachedAgreed],
        ['Paid', reachedPaid],
    ];
    const stages = stageDefs.map(([name, count], i) => ({
        name,
        count,
        pctOfTop: top > 0 ? count / top : 0,
        pctOfPrev: i === 0 ? null : (stageDefs[i - 1][1] > 0 ? count / stageDefs[i - 1][1] : 0),
    }));
    return { stages, lost, created, conversionPct: created > 0 ? reachedPaid / created : 0 };
}

/**
 * Recurrence retention — for each {90,180,365}-day window, the fraction of
 * series old enough to be eligible that are still active.
 *
 * @param {{ rows?: Array<{id?:string,site?:string,frequency?:string,starts_on?:string,active?:number,created_at?:number}>, nowMs?: number }} input
 */
export function computeRecurrenceRetention({ rows = [], nowMs = 0 } = {}) {
    const windows = [90, 180, 365];
    const retention = {};
    for (const w of windows) retention[`d${w}`] = { eligible: 0, retained: 0, pct: 0 };

    const series = rows.map((r) => {
        const createdAt = Number(r.created_at ?? r.createdAt ?? 0);
        const active = r.active === 1 || r.active === true;
        const ageDays = createdAt > 0 ? Math.floor((nowMs - createdAt) / DAY_MS_REPORTS) : 0;
        for (const w of windows) {
            if (ageDays >= w) {
                retention[`d${w}`].eligible += 1;
                if (active) retention[`d${w}`].retained += 1;
            }
        }
        return { id: r.id, site: r.site, frequency: r.frequency, startsOn: r.starts_on ?? r.startsOn, active, ageDays };
    });
    for (const w of windows) {
        const b = retention[`d${w}`];
        b.pct = b.eligible > 0 ? b.retained / b.eligible : 0;
    }
    return { retention, series, total: rows.length };
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
