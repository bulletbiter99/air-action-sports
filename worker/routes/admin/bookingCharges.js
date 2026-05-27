// M5 R16 — Admin booking_charges queue + lifecycle endpoints
// (Surface 5 addendum).
//
// Mounted at /api/admin/booking-charges. Routes:
//   GET   /                   — list charges with status filter
//   POST  /:id/approve        — approve a pending (above-cap) charge
//                               (sends additional_charge_notice email)
//   POST  /:id/waive          — waive a pending/sent charge with reason
//                               (sends additional_charge_waived email)
//   POST  /:id/mark-paid      — manually mark paid (Venmo/cash/etc.)
//                               (sends additional_charge_paid email)
//
// Gated by requireAuth + manager+ role. Owner-only restriction matches
// the M5 prompt's "Lead Marshal review" — the legacy hierarchy maps
// 'manager' to operations leadership; future M5+ polish can swap to
// the proper capability check via worker/lib/capabilities.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import {
    listCharges,
    approveCharge,
    waiveCharge,
    markChargePaid,
    chargeOffSessionForCharge,
} from '../../lib/bookingCharges.js';

const adminBookingCharges = new Hono();
adminBookingCharges.use('*', requireAuth);

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/booking-charges
// ────────────────────────────────────────────────────────────────────

adminBookingCharges.get('/', requireRole('owner', 'manager'), async (c) => {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status') || undefined; // default in lib
    const eventId = url.searchParams.get('event_id') || undefined;

    const charges = await listCharges(c.env, { status, eventId });
    return c.json({
        charges,
        total: charges.length,
        filter: { status: status || 'pending,sent', eventId: eventId || null },
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/booking-charges/:id/approve
// ────────────────────────────────────────────────────────────────────

adminBookingCharges.post('/:id/approve', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const chargeId = c.req.param('id');

    const result = await approveCharge(c.env, { chargeId, userId: user.id });
    if (result.error === 'charge_not_found') return c.json({ error: 'charge_not_found' }, 404);
    if (result.error === 'not_pending') {
        return c.json({ error: 'not_pending', currentStatus: result.currentStatus }, 409);
    }
    return c.json(result);
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/booking-charges/:id/waive
// ────────────────────────────────────────────────────────────────────

adminBookingCharges.post('/:id/waive', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const chargeId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const reason = body.reason ? String(body.reason).trim() : '';
    if (!reason) return c.json({ error: 'reason_required' }, 400);

    const result = await waiveCharge(c.env, { chargeId, userId: user.id, reason });
    if (result.error === 'charge_not_found') return c.json({ error: 'charge_not_found' }, 404);
    if (result.error === 'already_finalized') {
        return c.json({ error: 'already_finalized', currentStatus: result.currentStatus }, 409);
    }
    return c.json(result);
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/booking-charges/:id/mark-paid
// ────────────────────────────────────────────────────────────────────

adminBookingCharges.post('/:id/mark-paid', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const chargeId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const paymentMethod = body.paymentMethod ? String(body.paymentMethod).trim() : '';
    const paymentReference = body.paymentReference ? String(body.paymentReference).trim() : null;
    if (!paymentMethod) return c.json({ error: 'payment_method_required' }, 400);

    const result = await markChargePaid(c.env, {
        chargeId, userId: user.id, paymentMethod, paymentReference,
    });
    if (result.error === 'charge_not_found') return c.json({ error: 'charge_not_found' }, 404);
    if (result.error === 'already_finalized') {
        return c.json({ error: 'already_finalized', currentStatus: result.currentStatus }, 409);
    }
    return c.json(result);
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/booking-charges/:id/charge-card  (M6 B7)
//
// Off-session capture against the saved payment method (B5 substrate).
// Success → charge marked paid + receipt email. Failure → structured
// error (4xx) so the operator can fall back to Option B (email link)
// or "Mark paid" (Venmo/cash) without losing context.
// ────────────────────────────────────────────────────────────────────

adminBookingCharges.post('/:id/charge-card', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const chargeId = c.req.param('id');

    const result = await chargeOffSessionForCharge(c.env, {
        chargeId,
        userId: user.id,
    });

    if (result.error === 'charge_not_found') return c.json({ error: 'charge_not_found' }, 404);
    if (result.error === 'already_finalized') {
        return c.json({ error: 'already_finalized', currentStatus: result.currentStatus }, 409);
    }
    if (result.error === 'booking_not_found') return c.json({ error: 'booking_not_found' }, 404);
    if (result.error === 'no_saved_payment_method') {
        // 422 = unprocessable — booking didn't go through B5's setup_future_usage
        // so no PM is saved. Operator falls back to email link or manual mark-paid.
        return c.json({
            error: 'no_saved_payment_method',
            detail: result.detail,
            fallback: 'use_email_link_or_mark_paid',
        }, 422);
    }
    if (result.error === 'stripe_declined') {
        // 402 = payment required — card declined / 3DS required / etc.
        return c.json({
            error: 'stripe_declined',
            code: result.code,
            message: result.message,
            paymentIntentId: result.paymentIntentId,
            fallback: 'use_email_link_or_mark_paid',
        }, 402);
    }
    if (result.error === 'stripe_request_failed') {
        return c.json({ error: 'stripe_request_failed', message: result.message }, 502);
    }
    return c.json(result);
});

export default adminBookingCharges;
