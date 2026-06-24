// 13-week cash-flow forecast endpoint (Finances). Gated on finances.read.
//
// Combines KNOWN data (field-rental payments scheduled in the horizon +
// budgeted monthly spend) with a projected booking-revenue run-rate and an
// operator-supplied opening balance, then rolls them forward week by week via
// worker/lib/cashFlow.js. All money in INTEGER cents.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { computeCashFlowForecast } from '../../lib/cashFlow.js';

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_WEEKS = 13;

const adminCashFlow = new Hono();
adminCashFlow.use('*', requireAuth);

// GET /api/admin/cash-flow?opening_cents=&weekly_revenue_cents=
//   opening_cents         — current cash balance (operator input; default 0)
//   weekly_revenue_cents   — override the projected booking run-rate; omit to
//                            derive it from the trailing 8 weeks of earned revenue
adminCashFlow.get('/', requireCapability('finances.read'), async (c) => {
    const url = new URL(c.req.url);
    const openingCents = Math.round(Number(url.searchParams.get('opening_cents')) || 0);
    const overrideRaw = url.searchParams.get('weekly_revenue_cents');
    const hasOverride = overrideRaw != null && overrideRaw !== '' && Number.isFinite(Number(overrideRaw));

    const now = Date.now();
    const nd = new Date(now);
    const todayStart = Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth(), nd.getUTCDate());
    const weeks = [];
    for (let i = 0; i < HORIZON_WEEKS; i++) {
        const startMs = todayStart + i * WEEK_MS;
        weeks.push({ startMs, endMs: startMs + WEEK_MS });
    }
    const horizonEnd = todayStart + HORIZON_WEEKS * WEEK_MS;

    // Projected weekly booking revenue — explicit override, else the trailing
    // 8-week earned-revenue average (income-card basis: total − tax − fee).
    let weeklyRevenueCents;
    if (hasOverride) {
        weeklyRevenueCents = Math.max(0, Math.round(Number(overrideRaw)));
    } else {
        const r = await c.env.DB.prepare(
            `SELECT COALESCE(SUM(total_cents - COALESCE(tax_cents,0) - COALESCE(fee_cents,0)),0) AS earned
             FROM bookings WHERE status IN ('paid','comp') AND paid_at >= ?`
        ).bind(now - 8 * WEEK_MS).first();
        weeklyRevenueCents = Math.round((Number(r?.earned) || 0) / 8);
    }

    // Scheduled field-rental receipts due within the horizon.
    const frRes = await c.env.DB.prepare(
        `SELECT due_at, amount_cents FROM field_rental_payments
         WHERE status = 'pending' AND due_at IS NOT NULL AND due_at >= ? AND due_at < ?`
    ).bind(todayStart, horizonEnd).all();

    // Budgeted monthly spend for the months the horizon spans.
    const startMonth = new Date(todayStart).toISOString().slice(0, 7);
    const endMonth = new Date(horizonEnd).toISOString().slice(0, 7);
    const budgetRes = await c.env.DB.prepare(
        `SELECT period, COALESCE(SUM(budgeted_cents),0) AS monthly_cents
         FROM budgets WHERE period >= ? AND period <= ? GROUP BY period`
    ).bind(startMonth, endMonth).all();
    const monthlyBudget = {};
    for (const b of (budgetRes.results || [])) monthlyBudget[b.period] = Number(b.monthly_cents) || 0;

    const payload = computeCashFlowForecast({
        openingCents,
        weeks,
        weeklyRevenueCents,
        frPayments: frRes.results || [],
        monthlyBudget,
    });

    return c.json({
        ...payload,
        horizonWeeks: HORIZON_WEEKS,
        assumptions: { openingCents, weeklyRevenueCents, revenueDerived: !hasOverride },
    });
});

export default adminCashFlow;
