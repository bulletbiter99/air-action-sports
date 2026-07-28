// M5 Batch 10 — admin labor log routes (Surface 4b).
// Sprint 4 C9 — the PUT edit this header always advertised finally exists,
// plus /:id/reject (the rejected_at/rejection_reason columns sat unwritten
// since migration 0036) and tax-year-lock enforcement on the financial
// mutations, per 0036's contract: "no further labor entries can be created
// OR MODIFIED for that year". Dispute/resolve stay lock-exempt on purpose —
// they're annotations, and recording a dispute against a filed year is
// legitimate information, not a change to the filed totals.
//
// Endpoints (capability-gated):
//   GET  /api/admin/labor-entries?person_id=&tax_year=
//   POST /api/admin/labor-entries (manual entry; auto-flags for approval if amount > $200)
//   PUT  /api/admin/labor-entries/:id (edit pre-approval; lock-enforced)
//   POST /api/admin/labor-entries/:id/approve   (lock-enforced)
//   POST /api/admin/labor-entries/:id/reject    (lock-enforced; requires a reason)
//   POST /api/admin/labor-entries/:id/mark-paid (lock-enforced)
//   POST /api/admin/labor-entries/:id/dispute
//   POST /api/admin/labor-entries/:id/resolve

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminLaborEntries = new Hono();
adminLaborEntries.use('*', requireAuth);

// HR self-approval cap per decision register #54: $200
const SELF_APPROVAL_CAP_CENTS = 200_00;

function randomLeId() {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let out = '';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `le_${out}`;
}

function taxYearOf(ms) {
    return new Date(ms).getUTCFullYear();
}

// Mirrors migration 0036's CHECK on labor_entries.pay_kind. Note w2_salary is
// deliberately NOT here — it's a persons.compensation_kind value the CHECK
// never permitted, so accepting it would 500 at INSERT/UPDATE time (and the
// dead `pay_kind = 'w2_salary'` terms in thresholds1099.js can never match
// until a migration widens the CHECK — a product decision, parked while
// labor_entries has zero rows).
const PAY_KINDS = ['w2_hourly', '1099_per_event', '1099_hourly', 'volunteer', 'comp'];

async function getEntry(env, id) {
    return env.DB.prepare('SELECT * FROM labor_entries WHERE id = ?').bind(id).first();
}

// 409-shaped lock check. Returns the error Response or null when unlocked.
async function lockedYearError(c, taxYear) {
    const lock = await c.env.DB.prepare('SELECT * FROM tax_year_locks WHERE tax_year = ?')
        .bind(taxYear).first();
    if (lock) return c.json({ error: `Tax year ${taxYear} is locked` }, 409);
    return null;
}

adminLaborEntries.get('/', requireCapability('staff.schedule.read'), async (c) => {
    const url = new URL(c.req.url);
    const personId = url.searchParams.get('person_id');
    const taxYear = url.searchParams.get('tax_year');

    const where = [];
    const binds = [];
    if (personId) { where.push('person_id = ?'); binds.push(personId); }
    if (taxYear) { where.push('tax_year = ?'); binds.push(Number(taxYear)); }
    if (where.length === 0) {
        return c.json({ error: 'person_id or tax_year required' }, 400);
    }

    const rows = await c.env.DB.prepare(
        `SELECT * FROM labor_entries WHERE ${where.join(' AND ')} ORDER BY worked_at DESC`,
    ).bind(...binds).all();
    return c.json({ entries: rows.results || [] });
});

adminLaborEntries.post('/', requireCapability('staff.schedule.write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { personId, eventStaffingId, source, workedAt, hours,
            payKind, amountCents, notes } = body || {};

    if (!personId || !workedAt || !payKind || amountCents == null) {
        return c.json({ error: 'personId, workedAt, payKind, amountCents required' }, 400);
    }
    const validSources = ['event_completion', 'manual_entry', 'adjustment'];
    const computedSource = validSources.includes(source) ? source : 'manual_entry';

    // Tax year lock check
    const ty = taxYearOf(workedAt);
    const lock = await c.env.DB.prepare('SELECT * FROM tax_year_locks WHERE tax_year = ?').bind(ty).first();
    if (lock) return c.json({ error: `Tax year ${ty} is locked` }, 409);

    const approvalRequired = computedSource === 'manual_entry' && amountCents > SELF_APPROVAL_CAP_CENTS ? 1 : 0;
    const id = randomLeId();
    const now = Date.now();

    await c.env.DB.prepare(
        `INSERT INTO labor_entries (id, person_id, event_staffing_id, source, worked_at, hours,
                                     pay_kind, amount_cents, notes, approval_required,
                                     created_by_user_id, created_at, updated_at, tax_year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        id, personId, eventStaffingId || null, computedSource,
        workedAt, hours || null, payKind, amountCents,
        notes || null, approvalRequired, user.id, now, now, ty,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'labor_entry.created',
        targetType: 'labor_entry',
        targetId: id,
        meta: { personId, source: computedSource, amountCents, approvalRequired },
    });

    return c.json({ ok: true, id, approvalRequired: approvalRequired === 1 }, 201);
});

// PUT /api/admin/labor-entries/:id — edit an entry BEFORE it is approved,
// rejected or paid. Editable: workedAt, hours, payKind, amountCents, notes.
// `source` is identity, not data — not editable. approval_required is
// RECOMPUTED from the new amount, so editing a $150 entry up to $500 sends
// it back through the approval gate rather than smuggling it past the cap.
adminLaborEntries.put('/:id', requireCapability('staff.schedule.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const entry = await getEntry(c.env, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    if (entry.approved_at || entry.rejected_at || entry.paid_at) {
        return c.json({ error: 'Only entries that are not yet approved, rejected or paid can be edited' }, 409);
    }

    const workedAt = body.workedAt != null ? Number(body.workedAt) : entry.worked_at;
    if (!Number.isFinite(workedAt)) return c.json({ error: 'workedAt must be a timestamp' }, 400);
    const payKind = body.payKind != null ? String(body.payKind) : entry.pay_kind;
    if (!PAY_KINDS.includes(payKind)) {
        return c.json({ error: `payKind must be one of ${PAY_KINDS.join(', ')}` }, 400);
    }
    const amountCents = body.amountCents != null ? Number(body.amountCents) : entry.amount_cents;
    if (!Number.isFinite(amountCents) || amountCents < 0) {
        return c.json({ error: 'amountCents must be a non-negative number' }, 400);
    }
    const hours = body.hours !== undefined ? (body.hours == null ? null : Number(body.hours)) : entry.hours;
    const notes = body.notes !== undefined ? (body.notes || null) : entry.notes;

    // Lock check on BOTH years: the entry's current year (its totals may be
    // filed) and the year it would move into.
    const oldYear = entry.tax_year;
    const newYear = taxYearOf(workedAt);
    const lockedOld = await lockedYearError(c, oldYear);
    if (lockedOld) return lockedOld;
    if (newYear !== oldYear) {
        const lockedNew = await lockedYearError(c, newYear);
        if (lockedNew) return lockedNew;
    }

    const approvalRequired = entry.source === 'manual_entry' && amountCents > SELF_APPROVAL_CAP_CENTS ? 1 : 0;
    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE labor_entries
         SET worked_at = ?, hours = ?, pay_kind = ?, amount_cents = ?, notes = ?,
             approval_required = ?, tax_year = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(workedAt, hours, payKind, amountCents, notes, approvalRequired, newYear, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'labor_entry.updated',
        targetType: 'labor_entry',
        targetId: id,
        meta: {
            amountCents,
            priorAmountCents: entry.amount_cents,
            payKind,
            taxYear: newYear,
            approvalRequired: approvalRequired === 1,
        },
    });
    return c.json({ ok: true, approvalRequired: approvalRequired === 1 });
});

adminLaborEntries.post('/:id/approve', requireCapability('staff.schedule.write'), async (c) => {
    const id = c.req.param('id');

    // C9 — locked-year guard. Needs the row's tax_year, so the blind UPDATE
    // gained a SELECT; the guarded-UPDATE predicate below is unchanged.
    const entry = await getEntry(c.env, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    const locked = await lockedYearError(c, entry.tax_year);
    if (locked) return locked;

    const now = Date.now();
    const r = await c.env.DB.prepare(
        `UPDATE labor_entries SET approved_at = ?, approved_by_user_id = ?, updated_at = ?
         WHERE id = ? AND approval_required = 1 AND approved_at IS NULL AND rejected_at IS NULL`,
    ).bind(now, c.get('user').id, now, id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or not approvable' }, 404);

    await writeAudit(c.env, {
        userId: c.get('user').id,
        action: 'labor_entry.approved',
        targetType: 'labor_entry',
        targetId: id,
    });
    return c.json({ ok: true });
});

// POST /api/admin/labor-entries/:id/reject — the other half of the approval
// gate. rejected_at + rejection_reason existed since migration 0036 with no
// writer; approve's WHERE even guarded on rejected_at IS NULL. A reason is
// required — a rejection is consequential to the staffer and the reason is
// the only trace of why.
adminLaborEntries.post('/:id/reject', requireCapability('staff.schedule.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return c.json({ error: 'A rejection reason is required' }, 400);

    const entry = await getEntry(c.env, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    const locked = await lockedYearError(c, entry.tax_year);
    if (locked) return locked;

    const now = Date.now();
    const r = await c.env.DB.prepare(
        `UPDATE labor_entries SET rejected_at = ?, rejection_reason = ?, updated_at = ?
         WHERE id = ? AND approval_required = 1 AND approved_at IS NULL AND rejected_at IS NULL AND paid_at IS NULL`,
    ).bind(now, reason, now, id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or not in a rejectable state' }, 409);

    await writeAudit(c.env, {
        userId: user.id,
        action: 'labor_entry.rejected',
        targetType: 'labor_entry',
        targetId: id,
        meta: { reason },
    });
    return c.json({ ok: true });
});

adminLaborEntries.post('/:id/mark-paid', requireCapability('staff.schedule.mark_paid'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { paymentReference } = body || {};

    // C9 — locked-year guard (payment records for a filed year are final).
    const entry = await getEntry(c.env, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    const locked = await lockedYearError(c, entry.tax_year);
    if (locked) return locked;

    const now = Date.now();
    const r = await c.env.DB.prepare(
        `UPDATE labor_entries SET paid_at = ?, paid_by_user_id = ?, payment_reference = ?, updated_at = ?
         WHERE id = ? AND paid_at IS NULL`,
    ).bind(now, c.get('user').id, paymentReference || null, now, id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or already paid' }, 404);

    await writeAudit(c.env, {
        userId: c.get('user').id,
        action: 'labor_entry.paid',
        targetType: 'labor_entry',
        targetId: id,
        meta: { paymentReference },
    });
    return c.json({ ok: true });
});

adminLaborEntries.post('/:id/dispute', requireCapability('staff.schedule.read'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { note } = body || {};
    const now = Date.now();
    const r = await c.env.DB.prepare(
        `UPDATE labor_entries SET disputed_at = ?, disputed_by_user_id = ?, dispute_note = ?, updated_at = ?
         WHERE id = ? AND disputed_at IS NULL`,
    ).bind(now, c.get('user').id, note || null, now, id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or already disputed' }, 404);

    await writeAudit(c.env, {
        userId: c.get('user').id,
        action: 'labor_entry.disputed',
        targetType: 'labor_entry',
        targetId: id,
        meta: { note },
    });
    return c.json({ ok: true });
});

adminLaborEntries.post('/:id/resolve', requireCapability('staff.schedule.dispute_resolve'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { note } = body || {};
    const now = Date.now();
    const r = await c.env.DB.prepare(
        `UPDATE labor_entries SET resolved_at = ?, resolved_by_user_id = ?, resolution_note = ?, updated_at = ?
         WHERE id = ? AND disputed_at IS NOT NULL AND resolved_at IS NULL`,
    ).bind(now, c.get('user').id, note || null, now, id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or not in disputed state' }, 404);

    await writeAudit(c.env, {
        userId: c.get('user').id,
        action: 'labor_entry.resolved',
        targetType: 'labor_entry',
        targetId: id,
        meta: { note },
    });
    return c.json({ ok: true });
});

export default adminLaborEntries;
