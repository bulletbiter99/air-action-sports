// Expenses + Budgets — operating-cost tracking + monthly budgets (migration 0074).
// Foundation for per-event P&L margin + P&L-vs-budget + cash-flow forecasting.
//
// Two Hono routers, mounted at /api/admin/expenses and /api/admin/budgets.
// Gated on the `finances.*` capabilities (owner + bookkeeper presets):
//   - finances.read  → list / view
//   - finances.write → create / edit / delete
//
// Money is stored + transported in INTEGER cents. Timestamps are ms epoch.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { expenseId, budgetId } from '../../lib/ids.js';

// Canonical expense categories (key → label). Stored as free TEXT in D1
// (no CHECK enum) so the set can grow without a migration; validated here.
// The client UI mirrors this list (src/utils/expenseCategories.js).
export const EXPENSE_CATEGORIES = [
    { key: 'field_rent', label: 'Field / Rent' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'consumables', label: 'Consumables' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'software', label: 'Software' },
    { key: 'utilities', label: 'Utilities' },
    { key: 'taxes', label: 'Taxes' },
    { key: 'other', label: 'Other' },
];
const CATEGORY_KEYS = new Set(EXPENSE_CATEGORIES.map((c) => c.key));
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // YYYY-MM

// Coerce to an integer count of cents (rejects floats/NaN/Infinity).
function intCents(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : NaN;
}

function formatExpense(row) {
    return {
        id: row.id,
        category: row.category,
        description: row.description,
        amountCents: row.amount_cents,
        incurredAt: row.incurred_at,
        vendor: row.vendor,
        eventId: row.event_id,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function formatBudget(row) {
    return {
        id: row.id,
        period: row.period,
        category: row.category,
        budgetedCents: row.budgeted_cents,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ── Expenses ─────────────────────────────────────────────────────────
export const adminExpenses = new Hono();
adminExpenses.use('*', requireAuth);

// GET /api/admin/expenses?start=&end=&category=&event_id=
// start/end are epoch-ms bounds on incurred_at.
adminExpenses.get('/', requireCapability('finances.read'), async (c) => {
    const url = new URL(c.req.url);
    const clauses = [];
    const binds = [];
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    const category = url.searchParams.get('category');
    const eventId = url.searchParams.get('event_id');
    if (start && Number.isFinite(Number(start))) { clauses.push('incurred_at >= ?'); binds.push(Number(start)); }
    if (end && Number.isFinite(Number(end))) { clauses.push('incurred_at <= ?'); binds.push(Number(end)); }
    if (category) { clauses.push('category = ?'); binds.push(category); }
    if (eventId) { clauses.push('event_id = ?'); binds.push(eventId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT * FROM expenses ${where} ORDER BY incurred_at DESC, created_at DESC`
    ).bind(...binds).all();

    const list = (rows.results || []).map(formatExpense);
    const totalCents = list.reduce((s, e) => s + (e.amountCents || 0), 0);
    return c.json({ expenses: list, totalCents, categories: EXPENSE_CATEGORIES });
});

// POST /api/admin/expenses
adminExpenses.post('/', requireCapability('finances.write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    if (!CATEGORY_KEYS.has(body.category)) {
        return c.json({ error: 'category must be one of the known expense categories' }, 400);
    }
    const amount = intCents(body.amountCents);
    if (!Number.isInteger(amount) || amount <= 0) {
        return c.json({ error: 'amountCents must be a positive integer (cents)' }, 400);
    }
    const incurredAt = body.incurredAt != null ? Number(body.incurredAt) : Date.now();
    if (!Number.isFinite(incurredAt)) {
        return c.json({ error: 'incurredAt must be epoch ms' }, 400);
    }

    const id = expenseId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO expenses (id, category, description, amount_cents, incurred_at, vendor, event_id, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        body.category,
        body.description ? String(body.description) : null,
        amount,
        incurredAt,
        body.vendor ? String(body.vendor) : null,
        body.eventId ? String(body.eventId) : null,
        body.notes ? String(body.notes) : null,
        user.id,
        now,
        now,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'expense.created',
        targetType: 'expense',
        targetId: id,
        meta: { category: body.category, amountCents: amount, eventId: body.eventId || null },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first();
    return c.json({ expense: formatExpense(row) }, 201);
});

// PUT /api/admin/expenses/:id — partial update.
adminExpenses.put('/:id', requireCapability('finances.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Expense not found' }, 404);

    const sets = [];
    const binds = [];
    if (body.category !== undefined) {
        if (!CATEGORY_KEYS.has(body.category)) return c.json({ error: 'unknown category' }, 400);
        sets.push('category = ?'); binds.push(body.category);
    }
    if (body.description !== undefined) { sets.push('description = ?'); binds.push(body.description ? String(body.description) : null); }
    if (body.amountCents !== undefined) {
        const amount = intCents(body.amountCents);
        if (!Number.isInteger(amount) || amount <= 0) return c.json({ error: 'amountCents must be a positive integer (cents)' }, 400);
        sets.push('amount_cents = ?'); binds.push(amount);
    }
    if (body.incurredAt !== undefined) {
        const ts = Number(body.incurredAt);
        if (!Number.isFinite(ts)) return c.json({ error: 'incurredAt must be epoch ms' }, 400);
        sets.push('incurred_at = ?'); binds.push(ts);
    }
    if (body.vendor !== undefined) { sets.push('vendor = ?'); binds.push(body.vendor ? String(body.vendor) : null); }
    if (body.eventId !== undefined) { sets.push('event_id = ?'); binds.push(body.eventId ? String(body.eventId) : null); }
    if (body.notes !== undefined) { sets.push('notes = ?'); binds.push(body.notes ? String(body.notes) : null); }

    if (!sets.length) return c.json({ expense: formatExpense(existing) });

    sets.push('updated_at = ?'); binds.push(Date.now());
    binds.push(id);
    await c.env.DB.prepare(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id, action: 'expense.updated', targetType: 'expense', targetId: id, meta: null,
    });

    const row = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first();
    return c.json({ expense: formatExpense(row) });
});

// DELETE /api/admin/expenses/:id
adminExpenses.delete('/:id', requireCapability('finances.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Expense not found' }, 404);

    await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(id).run();
    await writeAudit(c.env, {
        userId: user.id, action: 'expense.deleted', targetType: 'expense', targetId: id,
        meta: { category: existing.category, amountCents: existing.amount_cents },
    });
    return c.json({ deleted: true });
});

// ── Budgets ──────────────────────────────────────────────────────────
export const adminBudgets = new Hono();
adminBudgets.use('*', requireAuth);

// GET /api/admin/budgets?period=YYYY-MM | ?from=YYYY-MM&to=YYYY-MM
adminBudgets.get('/', requireCapability('finances.read'), async (c) => {
    const url = new URL(c.req.url);
    const period = url.searchParams.get('period');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const clauses = [];
    const binds = [];
    if (period) { clauses.push('period = ?'); binds.push(period); }
    if (from) { clauses.push('period >= ?'); binds.push(from); }
    if (to) { clauses.push('period <= ?'); binds.push(to); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT * FROM budgets ${where} ORDER BY period DESC, category ASC`
    ).bind(...binds).all();
    return c.json({ budgets: (rows.results || []).map(formatBudget), categories: EXPENSE_CATEGORIES });
});

// PUT /api/admin/budgets — upsert one (period, category) target.
adminBudgets.put('/', requireCapability('finances.write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    if (!PERIOD_RE.test(String(body.period || ''))) {
        return c.json({ error: 'period must be YYYY-MM' }, 400);
    }
    if (!CATEGORY_KEYS.has(body.category)) {
        return c.json({ error: 'unknown category' }, 400);
    }
    const amount = intCents(body.budgetedCents);
    if (!Number.isInteger(amount) || amount < 0) {
        return c.json({ error: 'budgetedCents must be a non-negative integer (cents)' }, 400);
    }

    const now = Date.now();
    const existing = await c.env.DB.prepare(
        `SELECT * FROM budgets WHERE period = ? AND category = ?`
    ).bind(body.period, body.category).first();

    let id;
    if (existing) {
        id = existing.id;
        await c.env.DB.prepare(
            `UPDATE budgets SET budgeted_cents = ?, notes = ?, updated_at = ? WHERE id = ?`
        ).bind(amount, body.notes ? String(body.notes) : null, now, id).run();
    } else {
        id = budgetId();
        await c.env.DB.prepare(
            `INSERT INTO budgets (id, period, category, budgeted_cents, notes, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, body.period, body.category, amount, body.notes ? String(body.notes) : null, user.id, now, now).run();
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: existing ? 'budget.updated' : 'budget.created',
        targetType: 'budget', targetId: id,
        meta: { period: body.period, category: body.category, budgetedCents: amount },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM budgets WHERE id = ?`).bind(id).first();
    return c.json({ budget: formatBudget(row) }, existing ? 200 : 201);
});

// DELETE /api/admin/budgets/:id
adminBudgets.delete('/:id', requireCapability('finances.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT * FROM budgets WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Budget not found' }, 404);

    await c.env.DB.prepare(`DELETE FROM budgets WHERE id = ?`).bind(id).run();
    await writeAudit(c.env, {
        userId: user.id, action: 'budget.deleted', targetType: 'budget', targetId: id,
        meta: { period: existing.period, category: existing.category },
    });
    return c.json({ deleted: true });
});
