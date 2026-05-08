// M5 Batch 10 — admin labor log routes (Surface 4b).
//
// Endpoints (capability-gated):
//   GET  /api/admin/labor-entries?person_id=&tax_year=
//   POST /api/admin/labor-entries (manual entry; auto-flags for approval if amount > $200)
//   PUT  /api/admin/labor-entries/:id (edit pre-approval)
//   POST /api/admin/labor-entries/:id/approve
//   POST /api/admin/labor-entries/:id/mark-paid
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

adminLaborEntries.post('/:id/approve', requireCapability('staff.schedule.write'), async (c) => {
    const id = c.req.param('id');
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

adminLaborEntries.post('/:id/mark-paid', requireCapability('staff.schedule.mark_paid'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { paymentReference } = body || {};
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
