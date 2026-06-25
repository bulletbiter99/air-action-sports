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
    custom: 'Custom range',
};

export const SUPPORTED_PERIODS = ['mtd', 'qtd', 'ytd', 'last_30d', 'last_90d', 'custom'];

/**
 * Resolve a period selector into a half-open [startMs, endMs) window.
 * endMs is always "now". UTC boundaries for calendar periods.
 *
 * `custom` uses the caller-supplied customBounds when valid (Batch 11a);
 * otherwise it falls back to last_30d (missing/invalid range).
 *
 * @param {string} period - mtd | qtd | ytd | last_30d | last_90d | custom
 * @param {number} nowMs
 * @param {{ startMs:number, endMs:number }} [customBounds] - used only when period==='custom'
 * @returns {{ period: string, requestedPeriod: string, startMs: number, endMs: number, label: string }}
 */
export function resolvePeriodWindow(period, nowMs, customBounds) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const d = new Date(now);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();

    // Custom range (Batch 11a): a valid [startMs, endMs) from the caller wins.
    // Must be finite with start < end; otherwise fall through to last_30d.
    if (period === 'custom' && customBounds
        && Number.isFinite(customBounds.startMs) && Number.isFinite(customBounds.endMs)
        && customBounds.startMs < customBounds.endMs) {
        return {
            period: 'custom',
            requestedPeriod: 'custom',
            startMs: customBounds.startMs,
            endMs: customBounds.endMs,
            label: PERIOD_LABELS.custom,
        };
    }

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

/**
 * Budget vs actual (P&L-vs-budget) — aggregate per-category budget targets vs
 * recorded expenses over the window, plus the overall P&L. Expenses + budgets
 * are summed per category across the window's months. varianceCents = budget −
 * spent (positive = under budget / favorable). earnedCents is passed already
 * summed (earned-revenue basis: total − tax − fee, excl refunds); netCents =
 * earned − spent. Categories are sorted by spend (biggest first).
 *
 * @param {{ budgetRows?: Array<{category?:string, budgeted_cents?:number}>,
 *           expenseRows?: Array<{category?:string, spent_cents?:number}>,
 *           revenueRows?: Array<{earned_cents?:number}> }} input
 */
export function computeBudgetVsActual({ budgetRows = [], expenseRows = [], revenueRows = [] } = {}) {
    const budgetByCat = new Map();
    for (const b of budgetRows) {
        const cat = b.category;
        if (!cat) continue;
        budgetByCat.set(cat, (budgetByCat.get(cat) || 0) + Number(b.budgeted_cents ?? b.budgetedCents ?? 0));
    }
    const spentByCat = new Map();
    for (const e of expenseRows) {
        const cat = e.category;
        if (!cat) continue;
        spentByCat.set(cat, (spentByCat.get(cat) || 0) + Number(e.spent_cents ?? e.spentCents ?? 0));
    }

    const cats = new Set([...budgetByCat.keys(), ...spentByCat.keys()]);
    const categories = [...cats].map((category) => {
        const budgetedCents = budgetByCat.get(category) || 0;
        const spentCents = spentByCat.get(category) || 0;
        const varianceCents = budgetedCents - spentCents;
        return {
            category,
            budgetedCents,
            spentCents,
            varianceCents,
            variancePct: budgetedCents > 0 ? varianceCents / budgetedCents : null,
        };
    }).sort((a, b) => b.spentCents - a.spentCents || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

    const earnedCents = revenueRows.reduce((s, r) => s + Number(r.earned_cents ?? r.earnedCents ?? 0), 0);
    const budgetedCents = categories.reduce((s, c) => s + c.budgetedCents, 0);
    const spentCents = categories.reduce((s, c) => s + c.spentCents, 0);
    const totals = {
        budgetedCents,
        spentCents,
        varianceCents: budgetedCents - spentCents,
        earnedCents,
        netCents: earnedCents - spentCents,
    };
    return { categories, totals };
}

/**
 * Per-event P&L — each event's earned revenue minus the expenses tagged to it
 * (expenses.event_id) = contribution margin. eventRows carry the per-event
 * earned revenue (lifetime over the event's paid/comp bookings); costRows are
 * per-event tagged-expense sums. marginPct is null when an event has no
 * revenue (avoids divide-by-zero). Totals roll up across the listed events.
 *
 * @param {{ eventRows?: Array<{id?:string, title?:string, date_iso?:string, earned_cents?:number, paid_bookings?:number}>,
 *           costRows?: Array<{event_id?:string, cost_cents?:number}> }} input
 */
export function computePerEventPnl({ eventRows = [], costRows = [] } = {}) {
    const costByEvent = new Map();
    for (const r of costRows) {
        const id = r.event_id ?? r.eventId;
        if (id == null) continue;
        costByEvent.set(id, (costByEvent.get(id) || 0) + Number(r.cost_cents ?? r.costCents ?? 0));
    }
    const events = eventRows.map((e) => {
        const eventId = e.id ?? e.eventId;
        const earnedCents = Number(e.earned_cents ?? e.earnedCents ?? 0);
        const directCostsCents = costByEvent.get(eventId) || 0;
        const marginCents = earnedCents - directCostsCents;
        return {
            eventId,
            title: e.title,
            dateIso: e.date_iso ?? e.dateIso,
            paidBookings: Number(e.paid_bookings ?? e.paidBookings ?? 0),
            earnedCents,
            directCostsCents,
            marginCents,
            marginPct: earnedCents > 0 ? marginCents / earnedCents : null,
        };
    });
    const totals = events.reduce((t, e) => ({
        earnedCents: t.earnedCents + e.earnedCents,
        directCostsCents: t.directCostsCents + e.directCostsCents,
        marginCents: t.marginCents + e.marginCents,
    }), { earnedCents: 0, directCostsCents: 0, marginCents: 0 });
    totals.marginPct = totals.earnedCents > 0 ? totals.marginCents / totals.earnedCents : null;
    return { events, totals };
}

/**
 * Stripe fees & true net — monthly ACTUAL Stripe fee + net (from each charge's
 * balance_transaction, captured by runStripeFeeSync) vs the gross charged, plus
 * "kept" = net deposited − sales tax remitted. The money columns are computed
 * over the RECONCILED subset (bookings whose fee is captured) so they stay
 * internally consistent while the nightly backfill catches up; `coverage`
 * reports how many paid bookings are reconciled vs total. effectiveFeeRate =
 * fee / gross over the reconciled subset.
 *
 * @param {{ monthlyRows?: Array<{month?:string, gross_cents?:number, fee_cents?:number,
 *   net_cents?:number, tax_cents?:number, paid_count?:number, captured_count?:number}> }} input
 */
export function computeStripeFees({ monthlyRows = [], refundRows = [] } = {}) {
    // Merge paid economics + refunded-booking fee loss by month so a month with
    // ONLY refunds still shows up (it won't be in the paid query's rows).
    const byMonth = new Map();
    const ensure = (m) => {
        let r = byMonth.get(m);
        if (!r) {
            r = {
                month: m,
                grossCents: 0, feeCents: 0, netCents: 0, taxCents: 0, keptCents: 0,
                paidCount: 0, capturedCount: 0,
                refundedFeeCents: 0, refundedCount: 0, refundedCaptured: 0,
            };
            byMonth.set(m, r);
        }
        return r;
    };

    for (const r of monthlyRows) {
        const m = r.month ?? r.m;
        if (m == null) continue;
        const row = ensure(m);
        row.grossCents += Number(r.gross_cents ?? 0);
        row.feeCents += Number(r.fee_cents ?? 0);
        row.netCents += Number(r.net_cents ?? 0);
        row.taxCents += Number(r.tax_cents ?? 0);
        row.paidCount += Number(r.paid_count ?? 0);
        row.capturedCount += Number(r.captured_count ?? 0);
        row.keptCents = row.netCents - row.taxCents;
    }
    // Refunded bookings: Stripe keeps the original fee → a pure, unrecoverable
    // loss. We surface the fee only (the principal + tax came back).
    for (const r of refundRows) {
        const m = r.month ?? r.m;
        if (m == null) continue;
        const row = ensure(m);
        row.refundedFeeCents += Number(r.refunded_fee_cents ?? 0);
        row.refundedCount += Number(r.refunded_count ?? 0);
        row.refundedCaptured += Number(r.refunded_captured ?? 0);
    }

    const series = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    const totals = series.reduce((t, r) => ({
        grossCents: t.grossCents + r.grossCents,
        feeCents: t.feeCents + r.feeCents,
        netCents: t.netCents + r.netCents,
        taxCents: t.taxCents + r.taxCents,
        keptCents: t.keptCents + r.keptCents,
        paidCount: t.paidCount + r.paidCount,
        capturedCount: t.capturedCount + r.capturedCount,
        refundedFeeCents: t.refundedFeeCents + r.refundedFeeCents,
        refundedCount: t.refundedCount + r.refundedCount,
        refundedCaptured: t.refundedCaptured + r.refundedCaptured,
    }), {
        grossCents: 0, feeCents: 0, netCents: 0, taxCents: 0, keptCents: 0,
        paidCount: 0, capturedCount: 0, refundedFeeCents: 0, refundedCount: 0, refundedCaptured: 0,
    });
    const coverage = {
        captured: totals.capturedCount,
        total: totals.paidCount,
        pct: totals.paidCount > 0 ? totals.capturedCount / totals.paidCount : 1,
    };
    const effectiveFeeRate = totals.grossCents > 0 ? totals.feeCents / totals.grossCents : null;
    // True take-home = paid kept LESS the fees Stripe kept on refunded charges.
    const refunds = { feeCents: totals.refundedFeeCents, count: totals.refundedCount, captured: totals.refundedCaptured };
    const netKeptCents = totals.keptCents - totals.refundedFeeCents;
    return { series, totals, coverage, effectiveFeeRate, refunds, netKeptCents };
}

/**
 * Field-rental A/R aging + DSO — a snapshot of what's owed as of `nowMs`.
 *
 * AAS tickets are prepaid via Stripe Checkout, so the only real accounts-
 * receivable exposure is the B2B field-rental side: field_rental_payments rows
 * still in status='pending'. Each outstanding payment is bucketed by how far
 * past its due_at it is; an un-dated or not-yet-due payment counts as "current".
 *
 * DSO (Days Sales Outstanding) ≈ outstanding A/R ÷ average daily field-rental
 * receipts. `salesCents` is the field-rental cash RECEIVED over the trailing
 * `salesWindowDays` (the caller windows it); `dso` is null when there were no
 * receipts (no run-rate to annualize against).
 *
 * @param {{
 *   pendingRows?: Array<{id?:string, rental_id?:string, renter?:string, site?:string, due_at?:number, amount_cents?:number}>,
 *   salesCents?: number,
 *   salesWindowDays?: number,
 *   nowMs?: number,
 * }} input
 */
export function computeArAging({ pendingRows = [], salesCents = 0, salesWindowDays = 365, nowMs = 0 } = {}) {
    const BUCKET_DEFS = [
        { key: 'current', label: 'Current' },
        { key: 'd1_30', label: '1–30 days' },
        { key: 'd31_60', label: '31–60 days' },
        { key: 'd61_90', label: '61–90 days' },
        { key: 'd90plus', label: '90+ days' },
    ];
    const tally = {};
    for (const b of BUCKET_DEFS) tally[b.key] = { count: 0, amountCents: 0 };

    const items = pendingRows.map((r) => {
        const due = r.due_at ?? r.dueAt;
        const dueAt = due == null ? null : Number(due);
        const amountCents = Math.round(Number(r.amount_cents ?? r.amountCents ?? 0));
        const daysOverdue = dueAt == null ? null : Math.floor((nowMs - dueAt) / DAY_MS_REPORTS);
        let bucket;
        if (daysOverdue == null || daysOverdue <= 0) bucket = 'current';
        else if (daysOverdue <= 30) bucket = 'd1_30';
        else if (daysOverdue <= 60) bucket = 'd31_60';
        else if (daysOverdue <= 90) bucket = 'd61_90';
        else bucket = 'd90plus';
        tally[bucket].count += 1;
        tally[bucket].amountCents += amountCents;
        return {
            id: r.id,
            rentalId: r.rental_id ?? r.rentalId ?? null,
            renter: r.renter ?? null,
            site: r.site ?? null,
            dueAt,
            amountCents,
            daysOverdue,
            bucket,
        };
    });
    // Most overdue first; un-dated / not-yet-due (daysOverdue null/≤0) sink down.
    items.sort((a, b) => (b.daysOverdue ?? -Infinity) - (a.daysOverdue ?? -Infinity));

    const buckets = BUCKET_DEFS.map((b) => ({ key: b.key, label: b.label, ...tally[b.key] }));
    const totals = buckets.reduce(
        (t, b) => ({ count: t.count + b.count, amountCents: t.amountCents + b.amountCents }),
        { count: 0, amountCents: 0 },
    );
    const current = { ...tally.current };
    const overdue = {
        count: totals.count - current.count,
        amountCents: totals.amountCents - current.amountCents,
    };

    const sales = Math.max(0, Math.round(Number(salesCents) || 0));
    const days = Math.max(1, Math.round(Number(salesWindowDays) || 0));
    const dso = sales > 0 ? totals.amountCents / (sales / days) : null;

    return { buckets, items, totals, current, overdue, dso, salesCents: sales, salesWindowDays: days };
}

/**
 * Median of a numeric array (sorted copy; mean of the middle two when even).
 * Ignores non-finite entries. Returns null for an empty/all-invalid array. Pure.
 */
export function median(nums = []) {
    const xs = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * Owner weekly scorecard — EOS Level-10-style 13-week grid. PURE + Date-free:
 * the route supplies the 13-week meta (with isCurrent set) plus pre-bucketed
 * per-week values + per-week volume for each metric; this classifies every cell
 * against an auto-derived target and tallies the summary.
 *
 * Target = MEDIAN of the metric's COMPLETED, ACTIVE weeks (index 0..11 where
 * volume >= 1 and the value is non-null). Median (not mean) so a few dead or
 * outlier weeks don't move the bar. Status is three-state vs target with a
 * tolerance band. A cell is NEUTRAL (no judgment) when the week is the current
 * in-progress week, the target is null (insufficient baseline), or the week's
 * volume floor trips (a genuinely quiet week is shown as data, not an alarm —
 * the core seasonality guard for a spiky, low-volume events business).
 *
 * Sufficiency per metric: 'ok' (>=6 active completed weeks), 'sparse' (3-5),
 * 'insufficient' (<3 → target null → all cells neutral). avg = mean of the
 * metric's completed, non-null weeks (money/count include quiet $0 weeks;
 * rate metrics are null on no-volume weeks and so are excluded).
 *
 * @param {{
 *   weeks: Array<{ index:number, startMs:number, endMs:number, startIso:string, isCurrent:boolean, isPartial:boolean }>,
 *   metricInputs: Array<{ key:string, label:string, unit:'money'|'count'|'percent',
 *     direction:'higher-better'|'lower-better', weekValues:Array<number|null>, volumeByWeek:Array<number> }>,
 * }} input
 */
export function computeScorecard({ weeks = [], metricInputs = [] } = {}) {
    const completed = weeks.filter((w) => !w.isCurrent).map((w) => w.index);

    const classify = (value, target, direction) => {
        if (target == null || value == null) return 'neutral';
        if (direction === 'lower-better') {
            if (target === 0) return value <= 0 ? 'on' : 'off';
            const ratio = value / target;
            if (ratio <= 1.10) return 'on';
            if (ratio <= 1.30) return 'watch';
            return 'off';
        }
        if (target <= 0) return 'neutral'; // no positive baseline to judge against
        const ratio = value / target;
        if (ratio >= 0.90) return 'on';
        if (ratio >= 0.70) return 'watch';
        return 'off';
    };

    const summary = { on: 0, watch: 0, off: 0, neutral: 0 };

    const metrics = metricInputs.map((m) => {
        const vals = m.weekValues || [];
        const vol = m.volumeByWeek || [];

        // Baseline: completed weeks that were actually active (volume >= 1, non-null).
        const baseline = completed
            .filter((i) => (Number(vol[i]) || 0) >= 1 && vals[i] != null)
            .map((i) => vals[i]);
        const activeCount = baseline.length;
        const sufficiency = activeCount >= 6 ? 'ok' : activeCount >= 3 ? 'sparse' : 'insufficient';
        let target = sufficiency === 'insufficient' ? null : median(baseline);
        // A refund-rate target only ever sits in [0, 0.5] — clamp guards an
        // anomalous baseline from producing a nonsensical bar (rarely trips).
        if (target != null && m.key === 'refund_rate') target = Math.min(0.5, Math.max(0, target));

        // avg over completed, non-null weeks.
        const avgVals = completed.map((i) => vals[i]).filter((v) => v != null);
        const avg = avgVals.length ? avgVals.reduce((s, v) => s + v, 0) / avgVals.length : null;

        const cells = weeks.map((w) => {
            const i = w.index;
            const value = vals[i] ?? null;
            const floored = (Number(vol[i]) || 0) < 1;
            const status = (w.isCurrent || target == null || floored)
                ? 'neutral'
                : classify(value, target, m.direction);
            if (!w.isCurrent) summary[status] += 1;
            return {
                index: i,
                value,
                status,
                pctOfTarget: (target && value != null) ? value / target : null,
            };
        });

        return {
            key: m.key,
            label: m.label,
            unit: m.unit,
            direction: m.direction,
            targetBasis: '12-week trailing median',
            sufficiency,
            target,
            avg,
            cells,
        };
    });

    return { weeks, metrics, summary };
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
