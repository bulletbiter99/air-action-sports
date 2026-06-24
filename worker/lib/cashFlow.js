// 13-week (N-week) direct-method cash-flow forecast — pure compute helper.
//
// Direct method: each week  Opening + Receipts − Disbursements = Net → Closing,
// and Closing(week N) = Opening(week N+1). The caller (worker/routes/admin/
// cashFlow.js) supplies the opening balance + the week windows + the raw data
// to bucket; this module does the bucketing + roll-forward so it stays fully
// unit-testable against plain fixtures (same split as worker/lib/reports.js).
//
// Receipts per week = a flat projected new-booking revenue run-rate (future
// ticket sales — past sales are already in the opening balance) + any field-
// rental payments scheduled (due_at) that week.
// Disbursements per week = the budgeted monthly spend, allocated per-day across
// the week's days (so a week spanning a month boundary splits correctly).

const DAY_MS = 86400000;

function utcMonthKey(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function daysInUtcMonth(ms) {
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * @param {{
 *   openingCents?: number,
 *   weeks?: Array<{ startMs:number, endMs:number, label?:string }>,
 *   weeklyRevenueCents?: number,                              // flat projected booking revenue / week
 *   frPayments?: Array<{ due_at?:number, amount_cents?:number }>, // scheduled field-rental receipts
 *   monthlyBudget?: Record<string, number>,                  // 'YYYY-MM' -> total budgeted cents
 * }} input
 * @returns {{ rows: object[], openingCents:number, endingCents:number,
 *   totalReceiptsCents:number, totalDisbursementsCents:number, netCents:number,
 *   minClosingCents:number, minClosingWeekLabel:string|null }}
 */
export function computeCashFlowForecast({
    openingCents = 0, weeks = [], weeklyRevenueCents = 0, frPayments = [], monthlyBudget = {},
} = {}) {
    const projectedRevenue = Math.max(0, Math.round(Number(weeklyRevenueCents) || 0));
    const start = Math.round(Number(openingCents) || 0);
    let opening = start;

    const rows = weeks.map((w) => {
        const startMs = Number(w.startMs);
        const endMs = Number(w.endMs);

        // Receipts — projected run-rate + FR payments due this week.
        let frReceiptsCents = 0;
        for (const p of frPayments) {
            const due = Number(p.due_at);
            if (Number.isFinite(due) && due >= startMs && due < endMs) {
                frReceiptsCents += Math.round(Number(p.amount_cents) || 0);
            }
        }
        const receiptsCents = projectedRevenue + frReceiptsCents;

        // Disbursements — per-day allocation of each day's month budget.
        let disb = 0;
        for (let dayMs = startMs; dayMs < endMs; dayMs += DAY_MS) {
            const monthTotal = monthlyBudget[utcMonthKey(dayMs)] || 0;
            if (monthTotal > 0) disb += monthTotal / daysInUtcMonth(dayMs);
        }
        const disbursementsCents = Math.round(disb);

        const netCents = receiptsCents - disbursementsCents;
        const closingCents = opening + netCents;
        const row = {
            label: w.label ?? new Date(startMs).toISOString().slice(0, 10),
            startMs,
            openingCents: opening,
            projectedRevenueCents: projectedRevenue,
            frReceiptsCents,
            receiptsCents,
            disbursementsCents,
            netCents,
            closingCents,
        };
        opening = closingCents;
        return row;
    });

    const endingCents = rows.length ? rows[rows.length - 1].closingCents : start;
    const totalReceiptsCents = rows.reduce((s, r) => s + r.receiptsCents, 0);
    const totalDisbursementsCents = rows.reduce((s, r) => s + r.disbursementsCents, 0);

    let minClosingCents = endingCents;
    let minClosingWeekLabel = rows.length ? rows[rows.length - 1].label : null;
    for (const r of rows) {
        if (r.closingCents < minClosingCents) {
            minClosingCents = r.closingCents;
            minClosingWeekLabel = r.label;
        }
    }

    return {
        rows,
        openingCents: start,
        endingCents,
        totalReceiptsCents,
        totalDisbursementsCents,
        netCents: totalReceiptsCents - totalDisbursementsCents,
        minClosingCents,
        minClosingWeekLabel,
    };
}
