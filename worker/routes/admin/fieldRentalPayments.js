// M5.5 Batch 7b — field rental payments route.
//
// Endpoints:
//   POST   /api/admin/field-rental-payments              record a payment (or schedule pending)
//   GET    /api/admin/field-rental-payments?rental_id=…  list payments for a rental
//   PUT    /api/admin/field-rental-payments/:paymentId   update (e.g. mark pending → received)
//   POST   /api/admin/field-rental-payments/:paymentId/refund   issue refund (canonical refund path)
//
// Capabilities per kind:
//   field_rentals.deposit_record    — kind=deposit or kind=full
//   field_rentals.balance_record    — kind=balance
//   field_rentals.write             — kind=damage, kind=other (B7 plan-mode allows these
//                                      under .write rather than mint new caps)
//   field_rentals.refund            — POST /:paymentId/refund
//   field_rentals.read.financials   — GET endpoints
//
// Reference field (check #, Venmo handle) is PII-gated by field_rentals.read.pii.
// `kind='refund'` is REJECTED on POST — refunds only via /refund endpoint (B7 plan #5).
// First received deposit/balance/full payment auto-transitions rental `agreed → paid`.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability, hasCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { rentalPaymentId as newPaymentId } from '../../lib/ids.js';

const adminFieldRentalPayments = new Hono();
adminFieldRentalPayments.use('*', requireAuth);

const PAYMENT_KINDS = new Set(['deposit', 'balance', 'full', 'damage', 'refund', 'other']);
const PAYMENT_METHODS = new Set(['cash', 'check', 'venmo', 'ach', 'card_offplatform', 'stripe_invoice']);
const PAYMENT_STATUSES = new Set(['pending', 'received', 'refunded', 'void']);
const REFUND_METHODS = new Set(['cash', 'check', 'venmo', 'ach', 'card_offplatform', 'stripe_invoice']);
const TERMINAL_RENTAL_STATUSES = new Set(['cancelled', 'refunded']);
const MASKED = '***';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function formatPayment(row, { viewerCanSeePII }) {
    if (!row) return null;
    return {
        id: row.id,
        rentalId: row.rental_id,
        recurrenceId: row.recurrence_id,
        paymentKind: row.payment_kind,
        paymentMethod: row.payment_method,
        reference: viewerCanSeePII ? row.reference : (row.reference ? MASKED : null),
        stripeInvoiceId: row.stripe_invoice_id,
        amountCents: row.amount_cents,
        status: row.status,
        dueAt: row.due_at,
        receivedAt: row.received_at,
        refundedAt: row.refunded_at,
        refundAmountCents: row.refund_amount_cents,
        refundReason: row.refund_reason,
        refundMethod: row.refund_method,
        receivedByUserId: row.received_by_user_id,
        notes: viewerCanSeePII ? row.notes : (row.notes ? MASKED : null),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function fetchRental(env, id) {
    return env.DB.prepare('SELECT * FROM field_rentals WHERE id = ?').bind(id).first();
}

async function fetchPayment(env, paymentId) {
    return env.DB.prepare('SELECT * FROM field_rental_payments WHERE id = ?').bind(paymentId).first();
}

// Returns the capability key required to record the given payment_kind.
// Reused by POST and PUT.
function recordCapabilityForKind(kind) {
    if (kind === 'deposit' || kind === 'full') return 'field_rentals.deposit_record';
    if (kind === 'balance') return 'field_rentals.balance_record';
    if (kind === 'damage' || kind === 'other') return 'field_rentals.write';
    return null;
}

// On status = received, sync the rental's denormalized aggregates per kind.
// Returns the SQL UPDATE arg list for the rental row (passed downstream).
async function syncAggregateOnReceived(env, rental, payment) {
    const now = Date.now();
    if (payment.payment_kind === 'deposit' || payment.payment_kind === 'full') {
        await env.DB.prepare(
            `UPDATE field_rentals
             SET deposit_received_at = ?, deposit_method = ?, deposit_reference = ?,
                 deposit_received_by = ?, requirements_deposit_received = 1, updated_at = ?
             WHERE id = ?`,
        ).bind(
            payment.received_at, payment.payment_method, payment.reference,
            payment.received_by_user_id, now, rental.id,
        ).run();
    }
    if (payment.payment_kind === 'balance' || payment.payment_kind === 'full') {
        await env.DB.prepare(
            `UPDATE field_rentals
             SET balance_received_at = ?, balance_method = ?, balance_reference = ?,
                 balance_received_by = ?, updated_at = ?
             WHERE id = ?`,
        ).bind(
            payment.received_at, payment.payment_method, payment.reference,
            payment.received_by_user_id, now, rental.id,
        ).run();
    }
}

// Auto-transition agreed → paid on first received payment of kind=deposit/balance/full.
// Returns true if the rental was transitioned.
async function maybeAutoFlipToPaid(env, rental, payment, user) {
    if (rental.status !== 'agreed') return false;
    if (!['deposit', 'balance', 'full'].includes(payment.payment_kind)) return false;
    const now = Date.now();
    await env.DB.prepare(
        `UPDATE field_rentals
         SET status = 'paid', status_changed_at = ?, status_change_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'agreed'`,
    ).bind(now, `Auto-transition on first received ${payment.payment_kind} payment`, now, rental.id).run();
    await writeAudit(env, {
        userId: user.id,
        action: 'field_rental.status_changed',
        targetType: 'field_rental',
        targetId: rental.id,
        meta: {
            from: 'agreed', to: 'paid',
            reason: `Auto-transition on first received ${payment.payment_kind} payment`,
            triggeredByPaymentId: payment.id,
        },
    });
    return true;
}

// On refund of a payment that previously set the rental's denormalized
// deposit_/balance_ aggregate, re-bind to the most recent OTHER received
// non-refunded payment of the same kind family. If none exist, clear the
// aggregate fields.
async function reverseAggregateOnRefund(env, rental, refundedPayment) {
    const now = Date.now();
    const kind = refundedPayment.payment_kind;

    // Helper: look up replacement payment row (same kind family, received, not refunded, not this one).
    async function findReplacement(kindFamily) {
        const kinds = kindFamily === 'deposit' ? ['deposit', 'full'] : ['balance', 'full'];
        return env.DB.prepare(
            `SELECT * FROM field_rental_payments
             WHERE rental_id = ? AND status = 'received' AND id != ?
               AND payment_kind IN (${kinds.map(() => '?').join(', ')})
             ORDER BY received_at DESC LIMIT 1`,
        ).bind(rental.id, refundedPayment.id, ...kinds).first();
    }

    // DEPOSIT side
    if (kind === 'deposit' || kind === 'full') {
        const stillAnchor = (
            rental.deposit_received_at === refundedPayment.received_at
            && rental.deposit_method === refundedPayment.payment_method
            && rental.deposit_received_by === refundedPayment.received_by_user_id
        );
        if (stillAnchor) {
            const replacement = await findReplacement('deposit');
            if (replacement) {
                await env.DB.prepare(
                    `UPDATE field_rentals
                     SET deposit_received_at = ?, deposit_method = ?, deposit_reference = ?,
                         deposit_received_by = ?, requirements_deposit_received = 1, updated_at = ?
                     WHERE id = ?`,
                ).bind(
                    replacement.received_at, replacement.payment_method, replacement.reference,
                    replacement.received_by_user_id, now, rental.id,
                ).run();
            } else {
                await env.DB.prepare(
                    `UPDATE field_rentals
                     SET deposit_received_at = NULL, deposit_method = NULL,
                         deposit_reference = NULL, deposit_received_by = NULL,
                         requirements_deposit_received = 0, updated_at = ?
                     WHERE id = ?`,
                ).bind(now, rental.id).run();
            }
        }
    }
    // BALANCE side
    if (kind === 'balance' || kind === 'full') {
        const stillAnchor = (
            rental.balance_received_at === refundedPayment.received_at
            && rental.balance_method === refundedPayment.payment_method
            && rental.balance_received_by === refundedPayment.received_by_user_id
        );
        if (stillAnchor) {
            const replacement = await findReplacement('balance');
            if (replacement) {
                await env.DB.prepare(
                    `UPDATE field_rentals
                     SET balance_received_at = ?, balance_method = ?, balance_reference = ?,
                         balance_received_by = ?, updated_at = ?
                     WHERE id = ?`,
                ).bind(
                    replacement.received_at, replacement.payment_method, replacement.reference,
                    replacement.received_by_user_id, now, rental.id,
                ).run();
            } else {
                await env.DB.prepare(
                    `UPDATE field_rentals
                     SET balance_received_at = NULL, balance_method = NULL,
                         balance_reference = NULL, balance_received_by = NULL,
                         updated_at = ?
                     WHERE id = ?`,
                ).bind(now, rental.id).run();
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────
// POST / — record a payment
// ────────────────────────────────────────────────────────────────────

adminFieldRentalPayments.post('/', requireAuth, async (c) => {
    const user = c.get('user');
    // Load capabilities so the per-kind check below uses the cached array.
    if (!Array.isArray(user.capabilities)) {
        const { listCapabilities } = await import('../../lib/capabilities.js');
        user.capabilities = await listCapabilities(c.env, user.id);
        c.set('user', user);
    }

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const rentalId = String(body.rental_id || '').trim();
    if (!rentalId) return c.json({ error: 'rental_id is required' }, 400);

    const kind = body.payment_kind;
    if (!PAYMENT_KINDS.has(kind)) {
        return c.json({ error: `payment_kind must be one of: ${[...PAYMENT_KINDS].join(', ')}` }, 400);
    }
    if (kind === 'refund') {
        return c.json({ error: 'Use POST /:paymentId/refund to record a refund' }, 400);
    }

    const requiredCap = recordCapabilityForKind(kind);
    if (!requiredCap || !hasCapability(user, requiredCap)) {
        return c.json({ error: 'Forbidden', requiresCapability: requiredCap || 'field_rentals.write' }, 403);
    }

    const method = body.payment_method;
    if (!PAYMENT_METHODS.has(method)) {
        return c.json({ error: `payment_method must be one of: ${[...PAYMENT_METHODS].join(', ')}` }, 400);
    }

    const amount = Number(body.amount_cents);
    if (!Number.isInteger(amount) || amount <= 0) {
        return c.json({ error: 'amount_cents must be a positive integer' }, 400);
    }

    const rental = await fetchRental(c.env, rentalId);
    if (!rental) return c.json({ error: 'rental_id does not exist' }, 400);
    if (rental.archived_at) return c.json({ error: 'Cannot record payment on archived rental' }, 409);
    if (TERMINAL_RENTAL_STATUSES.has(rental.status)) {
        return c.json({ error: `Cannot record payment on ${rental.status} rental` }, 409);
    }

    const recurrenceId = body.recurrence_id ? String(body.recurrence_id) : null;
    const reference = body.reference == null ? null : String(body.reference);
    const stripeInvoiceId = body.stripe_invoice_id ? String(body.stripe_invoice_id) : null;
    const dueAt = body.due_at == null ? null : Number(body.due_at);
    if (dueAt !== null && !Number.isFinite(dueAt)) {
        return c.json({ error: 'due_at must be epoch ms or null' }, 400);
    }
    const notes = body.notes == null ? null : String(body.notes);

    let receivedAt = null;
    let initialStatus = 'pending';
    if (body.received_at != null) {
        receivedAt = Number(body.received_at);
        if (!Number.isFinite(receivedAt)) {
            return c.json({ error: 'received_at must be epoch ms or null' }, 400);
        }
        initialStatus = 'received';
    }

    const paymentId = newPaymentId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO field_rental_payments (
            id, rental_id, recurrence_id, payment_kind, payment_method,
            reference, stripe_invoice_id, amount_cents, status,
            due_at, received_at, received_by_user_id,
            notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        paymentId, rentalId, recurrenceId, kind, method,
        reference, stripeInvoiceId, amount, initialStatus,
        dueAt, receivedAt, initialStatus === 'received' ? user.id : null,
        notes, now, now,
    ).run();

    const paymentRow = await fetchPayment(c.env, paymentId);

    // Aggregate sync + auto-transition on received state at creation time.
    if (initialStatus === 'received') {
        await syncAggregateOnReceived(c.env, rental, paymentRow);
        await maybeAutoFlipToPaid(c.env, rental, paymentRow, user);
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_payment.created',
        targetType: 'field_rental_payment',
        targetId: paymentId,
        meta: { rentalId, kind, method, amountCents: amount, status: initialStatus },
    });

    const refreshed = await fetchPayment(c.env, paymentId);
    return c.json({
        payment: formatPayment(refreshed, { viewerCanSeePII: hasCapability(user, 'field_rentals.read.pii') }),
    }, 201);
});

// ────────────────────────────────────────────────────────────────────
// GET /?rental_id=… — list payments
// ────────────────────────────────────────────────────────────────────

adminFieldRentalPayments.get('/', requireCapability('field_rentals.read.financials'), async (c) => {
    const user = c.get('user');
    const url = new URL(c.req.url);
    const rentalId = url.searchParams.get('rental_id');
    if (!rentalId) return c.json({ error: 'rental_id query parameter required' }, 400);

    const statusFilter = url.searchParams.get('status');
    const where = ['rental_id = ?'];
    const binds = [rentalId];
    if (statusFilter && PAYMENT_STATUSES.has(statusFilter)) {
        where.push('status = ?');
        binds.push(statusFilter);
    }

    const res = await c.env.DB.prepare(
        `SELECT * FROM field_rental_payments WHERE ${where.join(' AND ')}
         ORDER BY received_at DESC NULLS LAST, created_at DESC`,
    ).bind(...binds).all();

    const viewerCanSeePII = hasCapability(user, 'field_rentals.read.pii');
    return c.json({
        payments: (res.results || []).map((row) => formatPayment(row, { viewerCanSeePII })),
    });
});

// ────────────────────────────────────────────────────────────────────
// PUT /:paymentId — update (e.g. pending → received)
// ────────────────────────────────────────────────────────────────────

adminFieldRentalPayments.put('/:paymentId', requireAuth, async (c) => {
    const user = c.get('user');
    if (!Array.isArray(user.capabilities)) {
        const { listCapabilities } = await import('../../lib/capabilities.js');
        user.capabilities = await listCapabilities(c.env, user.id);
        c.set('user', user);
    }

    const paymentId = c.req.param('paymentId');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await fetchPayment(c.env, paymentId);
    if (!existing) return c.json({ error: 'Payment not found' }, 404);
    if (existing.status === 'refunded' || existing.status === 'void') {
        return c.json({ error: `Cannot edit ${existing.status} payment` }, 409);
    }

    const requiredCap = recordCapabilityForKind(existing.payment_kind);
    if (!requiredCap || !hasCapability(user, requiredCap)) {
        return c.json({ error: 'Forbidden', requiresCapability: requiredCap || 'field_rentals.write' }, 403);
    }

    const rental = await fetchRental(c.env, existing.rental_id);
    if (!rental) return c.json({ error: 'Parent rental not found' }, 404);

    const patch = {};
    if (body.reference !== undefined) patch.reference = body.reference == null ? null : String(body.reference);
    if (body.notes !== undefined) patch.notes = body.notes == null ? null : String(body.notes);
    if (body.due_at !== undefined) {
        if (body.due_at === null) patch.due_at = null;
        else {
            const n = Number(body.due_at);
            if (!Number.isFinite(n)) return c.json({ error: 'due_at must be epoch ms or null' }, 400);
            patch.due_at = n;
        }
    }

    // Transition pending → received
    let transitionedToReceived = false;
    if (body.received_at !== undefined && existing.status === 'pending') {
        const receivedAt = Number(body.received_at);
        if (!Number.isFinite(receivedAt)) {
            return c.json({ error: 'received_at must be epoch ms' }, 400);
        }
        patch.received_at = receivedAt;
        patch.status = 'received';
        patch.received_by_user_id = user.id;
        transitionedToReceived = true;
    } else if (body.received_at !== undefined && existing.status === 'received') {
        // Allow edit of received_at (e.g. correction) without re-syncing aggregate.
        const receivedAt = Number(body.received_at);
        if (!Number.isFinite(receivedAt)) {
            return c.json({ error: 'received_at must be epoch ms' }, 400);
        }
        patch.received_at = receivedAt;
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) return c.json({ error: 'No changes' }, 400);

    keys.push('updated_at');
    patch.updated_at = Date.now();
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(paymentId);
    await c.env.DB.prepare(`UPDATE field_rental_payments SET ${sets} WHERE id = ?`).bind(...binds).run();

    // Aggregate sync + auto-flip on a fresh transition into received.
    if (transitionedToReceived) {
        const refreshed = await fetchPayment(c.env, paymentId);
        await syncAggregateOnReceived(c.env, rental, refreshed);
        await maybeAutoFlipToPaid(c.env, rental, refreshed, user);
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_payment.updated',
        targetType: 'field_rental_payment',
        targetId: paymentId,
        meta: {
            rentalId: existing.rental_id,
            fields: keys.filter((k) => k !== 'updated_at'),
            transitionedToReceived,
        },
    });

    const updated = await fetchPayment(c.env, paymentId);
    return c.json({
        payment: formatPayment(updated, { viewerCanSeePII: hasCapability(user, 'field_rentals.read.pii') }),
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:paymentId/refund — canonical refund flow
// ────────────────────────────────────────────────────────────────────

adminFieldRentalPayments.post('/:paymentId/refund', requireCapability('field_rentals.refund'), async (c) => {
    const user = c.get('user');
    const paymentId = c.req.param('paymentId');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await fetchPayment(c.env, paymentId);
    if (!existing) return c.json({ error: 'Payment not found' }, 404);
    if (existing.status !== 'received') {
        return c.json({ error: `Can only refund payments in 'received' status (current: ${existing.status})` }, 409);
    }

    const refundAmount = Number(body.refund_amount_cents);
    if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
        return c.json({ error: 'refund_amount_cents must be a positive integer' }, 400);
    }
    if (refundAmount > existing.amount_cents) {
        return c.json({ error: `refund_amount_cents (${refundAmount}) exceeds payment amount_cents (${existing.amount_cents})` }, 400);
    }

    const refundMethod = body.refund_method;
    if (!REFUND_METHODS.has(refundMethod)) {
        return c.json({ error: `refund_method must be one of: ${[...REFUND_METHODS].join(', ')}` }, 400);
    }
    const refundReason = body.refund_reason ? String(body.refund_reason) : null;

    const rental = await fetchRental(c.env, existing.rental_id);
    if (!rental) return c.json({ error: 'Parent rental not found' }, 404);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE field_rental_payments
         SET status = 'refunded', refunded_at = ?, refund_amount_cents = ?,
             refund_reason = ?, refund_method = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(now, refundAmount, refundReason, refundMethod, now, paymentId).run();

    const refundedPayment = await fetchPayment(c.env, paymentId);
    await reverseAggregateOnRefund(c.env, rental, refundedPayment);

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental.refunded',
        targetType: 'field_rental_payment',
        targetId: paymentId,
        meta: {
            rentalId: existing.rental_id,
            paymentKind: existing.payment_kind,
            originalAmountCents: existing.amount_cents,
            refundAmountCents: refundAmount,
            refundMethod, refundReason,
        },
    });

    const refreshed = await fetchPayment(c.env, paymentId);
    return c.json({
        payment: formatPayment(refreshed, { viewerCanSeePII: hasCapability(user, 'field_rentals.read.pii') }),
    });
});

export default adminFieldRentalPayments;
