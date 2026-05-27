// M5 R16 — booking_charges (damage-charge fast-path) lib (Surface 5).
//
// Pure helpers + I/O wrappers + email send + payment-link signing.
// Schema reference: migrations/0038_incidents_and_charges_schema.sql
//   - booking_charges (status enum: pending|sent|paid|waived|refunded|rejected)
//   - charge_caps_config (role_key → cap_cents; -1 = unlimited; 0 = no charges)
//
// Lifecycle for the M5 fast-path (Option B email-link):
//   damaged/lost equipment recorded by R14 →
//   POST /api/event-day/damage-charge calls createDamageCharge →
//     - within cap → status='sent' + email link out
//     - above cap → status='pending' + approval_required=1 (admin queue)
//   admin approves → status='sent' + email link out
//   customer clicks payment link → M6 lands a Stripe Checkout (deferred)
//   admin manually marks paid (Venmo/cash) → status='paid' + receipt email
//   admin waives → status='waived' + waived email
//
// HMAC-signed payment link reuses portalSession's primitive: SHA-256
// HMAC over `${chargeId}.${expiresAt}` with SESSION_SECRET. Cleartext
// link in the email; only the HMAC roundtrip authorizes payment.

import { writeAudit } from './auditLog.js';
import { loadTemplate, renderTemplate } from './templates.js';
import { sendEmail } from './email.js';
import { retrievePaymentIntent, chargeOffSession } from './stripe.js';

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

export const REASON_KINDS = Object.freeze(['damage', 'lost', 'late_return', 'cleaning', 'other']);
export const STATUSES = Object.freeze(['pending', 'sent', 'paid', 'waived', 'refunded', 'rejected']);
export const PAYMENT_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

export function randomChargeId() {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `bc_${out}`;
}

/**
 * True iff the charge requires admin approval given the operator's
 * role cap.
 *
 *   cap = -1  → unlimited (e.g., equipment_manager)
 *   cap =  0  → no charges allowed (always requires approval)
 *   cap >  0  → requires approval if amount exceeds cap
 *
 * @param {number} amountCents
 * @param {number} roleCapCents
 * @returns {boolean}
 */
export function requiresApproval(amountCents, roleCapCents) {
    const amount = Number(amountCents || 0);
    const cap = Number(roleCapCents);
    if (cap === -1) return false;
    if (cap === 0) return true;
    return amount > cap;
}

export function formatChargeAmount(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function paymentLinkExpiresAt(now = Date.now()) {
    return now + PAYMENT_LINK_TTL_MS;
}

// ────────────────────────────────────────────────────────────────────
// HMAC payment-link signing — mirrors portalSession's primitive.
// ────────────────────────────────────────────────────────────────────

async function hmacSign(data, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    const bytes = new Uint8Array(sig);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqualStr(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Sign a payment token: `<chargeId>.<expiresAt>.<hmac>`. The cleartext
 * is included in the magic-link email; verifyPaymentToken handshakes
 * it back at /api/admin/booking-charges/pay/:token (R16 ships the
 * generator + verify pair; the actual landing page is M6).
 */
export async function signPaymentToken(chargeId, expiresAt, secret) {
    const payload = `${chargeId}.${expiresAt}`;
    const sig = await hmacSign(payload, secret);
    return `${payload}.${sig}`;
}

export async function verifyPaymentToken(token, secret, now = Date.now()) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [chargeId, expStr, sig] = parts;
    const expectedSig = await hmacSign(`${chargeId}.${expStr}`, secret);
    if (!timingSafeEqualStr(expectedSig, sig)) return null;
    const expiresAt = Number(expStr);
    if (!Number.isFinite(expiresAt) || expiresAt < now) return null;
    return { chargeId, expiresAt };
}

// ────────────────────────────────────────────────────────────────────
// I/O wrappers — cap lookup
// ────────────────────────────────────────────────────────────────────

/**
 * Returns the highest cap among the person's currently-effective roles.
 * Default 0 (no charges) when the person has no role assignment.
 *
 * Schema:
 *   person_roles (person_id, role_id, effective_to)
 *   roles (id, key)
 *   charge_caps_config (role_key, cap_cents)
 *
 * `cap_cents = -1` (unlimited) wins over any positive cap. `cap_cents = 0`
 * is treated as "no charges allowed" only when no other higher cap exists.
 */
export async function getChargeCapForPerson(env, personId) {
    if (!personId) return 0;
    const result = await env.DB.prepare(
        `SELECT cc.cap_cents
         FROM person_roles pr
         INNER JOIN roles r ON r.id = pr.role_id
         INNER JOIN charge_caps_config cc ON cc.role_key = r.key
         WHERE pr.person_id = ? AND pr.effective_to IS NULL`,
    ).bind(personId).all().catch(() => ({ results: [] }));

    const caps = (result.results || []).map((row) => Number(row.cap_cents));
    if (caps.length === 0) return 0;
    if (caps.includes(-1)) return -1; // unlimited
    return Math.max(...caps);
}

// ────────────────────────────────────────────────────────────────────
// I/O wrappers — charge lifecycle
// ────────────────────────────────────────────────────────────────────

/**
 * Inserts a booking_charges row. Routes to the within-cap fast-path
 * (status='sent' + immediate email) or the above-cap admin queue
 * (status='pending' + approval_required=1).
 */
export async function createDamageCharge(env, opts) {
    const {
        assignmentId, bookingId, attendeeId, eventId,
        reasonKind, amountCents, description,
        operatorPersonId, operatorRoleCap,
        sessionId,
    } = opts;
    if (!assignmentId) throw new Error('createDamageCharge: assignmentId required');
    if (!bookingId) throw new Error('createDamageCharge: bookingId required');
    if (!REASON_KINDS.includes(reasonKind)) throw new Error(`createDamageCharge: invalid reasonKind ${reasonKind}`);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new Error('createDamageCharge: amountCents must be a positive integer');
    }

    const id = randomChargeId();
    const now = Date.now();
    const approvalRequired = requiresApproval(amountCents, operatorRoleCap) ? 1 : 0;
    const status = approvalRequired ? 'pending' : 'sent';
    const linkExpiresAt = paymentLinkExpiresAt(now);

    let paymentLink = null;
    if (status === 'sent') {
        const token = await signPaymentToken(id, linkExpiresAt, env.SESSION_SECRET);
        paymentLink = `${env.SITE_URL || 'https://airactionsport.com'}/admin/booking-charges/pay/${token}`;
    }

    await env.DB.prepare(
        `INSERT INTO booking_charges (
            id, booking_id, attendee_id, rental_assignment_id,
            reason_kind, description, amount_cents,
            status, approval_required, approved_at, approved_by_user_id,
            payment_link, payment_link_expires_at, paid_at, payment_method, payment_reference,
            waived_at, waived_by_user_id, waived_reason,
            refunded_at, refund_reference,
            created_by_person_id, created_by_user_id,
            created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, ?)`,
    ).bind(
        id, bookingId, attendeeId || null, assignmentId,
        reasonKind, description || null, amountCents,
        status, approvalRequired,
        paymentLink, status === 'sent' ? linkExpiresAt : null,
        operatorPersonId || null,
        now, now,
    ).run();

    await writeAudit(env, {
        userId: null,
        action: approvalRequired ? 'event_day.charge_created_pending_approval' : 'event_day.charge_created',
        targetType: 'booking_charge',
        targetId: id,
        meta: {
            assignmentId,
            bookingId,
            eventId: eventId || null,
            reasonKind,
            amountCents,
            operatorPersonId: operatorPersonId || null,
            operatorRoleCap,
            sessionId: sessionId || null,
        },
    });

    if (status === 'sent') {
        await sendNoticeEmail(env, { chargeId: id, paymentLink, linkExpiresAt }).catch((err) => {
            console.error('charge_notice send failed', id, err?.message);
        });
    }

    return { id, status, approvalRequired: !!approvalRequired, paymentLink, paymentLinkExpiresAt: linkExpiresAt };
}

/**
 * Loads a charge with joined booking + attendee + rental_item context.
 */
export async function getChargeFull(env, chargeId) {
    return env.DB.prepare(
        `SELECT bc.*,
                b.full_name AS buyer_name, b.email AS buyer_email, b.event_id,
                a.first_name AS attendee_first, a.last_name AS attendee_last,
                ri.name AS item_name, ri.sku AS item_sku
         FROM booking_charges bc
         INNER JOIN bookings b ON b.id = bc.booking_id
         LEFT JOIN attendees a ON a.id = bc.attendee_id
         LEFT JOIN rental_assignments ra ON ra.id = bc.rental_assignment_id
         LEFT JOIN rental_items ri ON ri.id = ra.rental_item_id
         WHERE bc.id = ?`,
    ).bind(chargeId).first();
}

/**
 * Admin queue list. Status filter accepts comma-separated values.
 * Defaults to 'pending,sent' (active queue) when no filter.
 */
export async function listCharges(env, opts = {}) {
    const status = (opts.status || 'pending,sent').split(',').map((s) => s.trim()).filter(Boolean);
    const placeholders = status.map(() => '?').join(',');
    const args = [...status];
    let sql = `SELECT bc.*,
                      b.full_name AS buyer_name, b.email AS buyer_email, b.event_id,
                      ri.name AS item_name, ri.sku AS item_sku
               FROM booking_charges bc
               INNER JOIN bookings b ON b.id = bc.booking_id
               LEFT JOIN rental_assignments ra ON ra.id = bc.rental_assignment_id
               LEFT JOIN rental_items ri ON ri.id = ra.rental_item_id
               WHERE bc.status IN (${placeholders})`;
    if (opts.eventId) {
        sql += ` AND b.event_id = ?`;
        args.push(opts.eventId);
    }
    sql += ` ORDER BY bc.created_at DESC LIMIT 200`;
    const result = await env.DB.prepare(sql).bind(...args).all();
    return (result.results || []).map(formatChargeRow);
}

function formatChargeRow(r) {
    return {
        id: r.id,
        bookingId: r.booking_id,
        attendeeId: r.attendee_id,
        rentalAssignmentId: r.rental_assignment_id,
        reasonKind: r.reason_kind,
        description: r.description,
        amountCents: r.amount_cents,
        status: r.status,
        approvalRequired: !!r.approval_required,
        approvedAt: r.approved_at,
        approvedByUserId: r.approved_by_user_id,
        paymentLink: r.payment_link,
        paymentLinkExpiresAt: r.payment_link_expires_at,
        paidAt: r.paid_at,
        paymentMethod: r.payment_method,
        paymentReference: r.payment_reference,
        waivedAt: r.waived_at,
        waivedByUserId: r.waived_by_user_id,
        waivedReason: r.waived_reason,
        createdByPersonId: r.created_by_person_id,
        createdByUserId: r.created_by_user_id,
        createdAt: r.created_at,
        booking: { fullName: r.buyer_name, email: r.buyer_email, eventId: r.event_id },
        item: r.item_name ? { name: r.item_name, sku: r.item_sku } : null,
    };
}

export async function approveCharge(env, opts) {
    const { chargeId, userId } = opts;
    const charge = await getChargeFull(env, chargeId);
    if (!charge) return { error: 'charge_not_found' };
    if (charge.status !== 'pending') return { error: 'not_pending', currentStatus: charge.status };

    const now = Date.now();
    const linkExpiresAt = paymentLinkExpiresAt(now);
    const token = await signPaymentToken(chargeId, linkExpiresAt, env.SESSION_SECRET);
    const paymentLink = `${env.SITE_URL || 'https://airactionsport.com'}/admin/booking-charges/pay/${token}`;

    await env.DB.prepare(
        `UPDATE booking_charges
         SET status = 'sent', approval_required = 0, approved_at = ?, approved_by_user_id = ?,
             payment_link = ?, payment_link_expires_at = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(now, userId || null, paymentLink, linkExpiresAt, now, chargeId).run();

    await writeAudit(env, {
        userId: userId || null,
        action: 'charge.approved',
        targetType: 'booking_charge',
        targetId: chargeId,
        meta: { amountCents: charge.amount_cents, paymentLink },
    });

    await sendNoticeEmail(env, { chargeId, paymentLink, linkExpiresAt }).catch((err) => {
        console.error('charge_notice send failed (after approve)', chargeId, err?.message);
    });

    return { ok: true, chargeId, status: 'sent', paymentLink, paymentLinkExpiresAt: linkExpiresAt };
}

export async function waiveCharge(env, opts) {
    const { chargeId, userId, reason } = opts;
    if (!reason || !String(reason).trim()) return { error: 'reason_required' };

    const charge = await getChargeFull(env, chargeId);
    if (!charge) return { error: 'charge_not_found' };
    if (charge.status === 'paid' || charge.status === 'waived') {
        return { error: 'already_finalized', currentStatus: charge.status };
    }

    const now = Date.now();
    const trimmedReason = String(reason).trim();
    await env.DB.prepare(
        `UPDATE booking_charges
         SET status = 'waived', waived_at = ?, waived_by_user_id = ?, waived_reason = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(now, userId || null, trimmedReason, now, chargeId).run();

    await writeAudit(env, {
        userId: userId || null,
        action: 'charge.waived',
        targetType: 'booking_charge',
        targetId: chargeId,
        meta: { amountCents: charge.amount_cents, reason: trimmedReason },
    });

    await sendWaivedEmail(env, { chargeId, waivedReason: trimmedReason }).catch((err) => {
        console.error('charge_waived send failed', chargeId, err?.message);
    });

    return { ok: true, chargeId, status: 'waived' };
}

/**
 * M6 B7 — Option A activation. Charges the customer's saved payment
 * method off-session, completing the damage-charge flow without an
 * email-link round trip.
 *
 * Requires the original booking to have been checked out POST B5 deploy
 * (so `setup_future_usage: 'off_session'` saved the PM to a Stripe
 * Customer). Bookings created before B5 deployed won't have the
 * customer attached — caller falls back to Option B (email link).
 *
 * Flow:
 *   1. Load the charge + booking
 *   2. Retrieve original PaymentIntent → read customer + payment_method
 *   3. POST off-session PaymentIntent (idempotency-keyed by chargeId)
 *   4. On success: mark charge paid, audit, send paid email
 *   5. On Stripe error (declined / 3DS / etc.): return structured error,
 *      DON'T mark paid, audit the failure
 *
 * @param {object} env
 * @param {object} opts
 * @param {string} opts.chargeId
 * @param {string} [opts.userId]    Admin user id for audit attribution
 * @returns {Promise<
 *   | { ok: true, chargeId, status: 'paid', paymentIntentId, amountCents }
 *   | { error: 'charge_not_found' }
 *   | { error: 'already_finalized', currentStatus }
 *   | { error: 'booking_not_found' }
 *   | { error: 'no_saved_payment_method', detail }
 *   | { error: 'stripe_declined', code, message, paymentIntentId? }
 *   | { error: 'stripe_request_failed', message }
 * >}
 */
export async function chargeOffSessionForCharge(env, opts) {
    const { chargeId, userId } = opts;
    if (!chargeId) return { error: 'missing_charge_id' };

    const charge = await getChargeFull(env, chargeId);
    if (!charge) return { error: 'charge_not_found' };
    if (charge.status === 'paid' || charge.status === 'waived' || charge.status === 'refunded') {
        return { error: 'already_finalized', currentStatus: charge.status };
    }

    // Pull the originating booking row to get stripe_payment_intent + customer linkage.
    const booking = await env.DB.prepare(
        `SELECT id, stripe_payment_intent, stripe_session_id, email, full_name
         FROM bookings WHERE id = ?`
    ).bind(charge.booking_id).first();
    if (!booking) return { error: 'booking_not_found' };
    if (!booking.stripe_payment_intent) {
        return { error: 'no_saved_payment_method', detail: 'booking_has_no_payment_intent' };
    }

    // Retrieve the original PI to read customer + payment_method.
    let originalPI;
    try {
        originalPI = await retrievePaymentIntent(booking.stripe_payment_intent, env.STRIPE_SECRET_KEY);
    } catch (err) {
        console.error('chargeOffSessionForCharge: retrieve PI failed', chargeId, err?.message);
        return { error: 'stripe_request_failed', message: err?.message || 'retrieve_payment_intent_failed' };
    }
    const customer = originalPI?.customer;
    const paymentMethod = originalPI?.payment_method;
    if (!customer || !paymentMethod) {
        // Bookings created before B5 deploy don't have setup_future_usage,
        // so Stripe didn't create a Customer or save the PM. Caller falls
        // back to Option B (email link).
        return {
            error: 'no_saved_payment_method',
            detail: customer ? 'no_payment_method' : 'no_customer',
        };
    }

    // Off-session charge with stable idempotency key.
    const idempotencyKey = `charge_${chargeId}_offsession`;
    let newPI;
    try {
        newPI = await chargeOffSession({
            apiKey: env.STRIPE_SECRET_KEY,
            customer,
            paymentMethod,
            amount: charge.amount_cents,
            currency: 'usd',
            idempotencyKey,
            metadata: {
                booking_id: charge.booking_id,
                charge_id: chargeId,
                reason_kind: charge.reason_kind,
                source: 'damage_charge_off_session',
            },
        });
    } catch (err) {
        // Stripe rejection — declined / 3DS / etc. Don't mark paid;
        // audit the failure so the operator sees the chain in /admin/audit.
        const stripeErr = err?.stripe?.error || {};
        const code = stripeErr.code || 'unknown';
        const message = stripeErr.message || err?.message || 'unknown_stripe_error';
        const failedPI = stripeErr.payment_intent?.id || null;

        console.error('chargeOffSessionForCharge: Stripe declined', chargeId, code, message);
        await writeAudit(env, {
            userId: userId || null,
            action: 'charge.off_session_failed',
            targetType: 'booking_charge',
            targetId: chargeId,
            meta: { code, message, amountCents: charge.amount_cents, paymentIntentId: failedPI },
        });
        return { error: 'stripe_declined', code, message, paymentIntentId: failedPI };
    }

    // Stripe accepts but status may still be requires_action / requires_payment_method
    // (rare for confirmed=true off_session=true, but defensive). Treat anything
    // other than 'succeeded' as a soft failure — DO NOT mark paid.
    if (newPI.status !== 'succeeded') {
        console.warn('chargeOffSessionForCharge: PI returned non-succeeded status', chargeId, newPI.status);
        await writeAudit(env, {
            userId: userId || null,
            action: 'charge.off_session_failed',
            targetType: 'booking_charge',
            targetId: chargeId,
            meta: { code: 'non_succeeded_status', status: newPI.status, paymentIntentId: newPI.id },
        });
        return {
            error: 'stripe_declined',
            code: 'non_succeeded_status',
            message: `PaymentIntent landed in status=${newPI.status}; off-session cannot complete (3DS or similar required)`,
            paymentIntentId: newPI.id,
        };
    }

    // Success — mark paid + audit + send receipt email.
    const now = Date.now();
    await env.DB.prepare(
        `UPDATE booking_charges
         SET status = 'paid', paid_at = ?, payment_method = ?, payment_reference = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(now, 'stripe_off_session', newPI.id, now, chargeId).run();

    await writeAudit(env, {
        userId: userId || null,
        action: 'charge.off_session_succeeded',
        targetType: 'booking_charge',
        targetId: chargeId,
        meta: {
            amountCents: charge.amount_cents,
            paymentIntentId: newPI.id,
            customerId: customer,
            paymentMethodId: paymentMethod,
        },
    });

    await sendPaidEmail(env, {
        chargeId,
        paymentMethod: 'stripe_off_session',
        paymentReference: newPI.id,
    }).catch((err) => {
        console.error('charge_paid send failed (after off-session)', chargeId, err?.message);
    });

    return {
        ok: true,
        chargeId,
        status: 'paid',
        paymentIntentId: newPI.id,
        amountCents: charge.amount_cents,
    };
}

export async function markChargePaid(env, opts) {
    const { chargeId, userId, paymentMethod, paymentReference } = opts;
    if (!paymentMethod || !String(paymentMethod).trim()) return { error: 'payment_method_required' };

    const charge = await getChargeFull(env, chargeId);
    if (!charge) return { error: 'charge_not_found' };
    if (charge.status === 'paid' || charge.status === 'waived' || charge.status === 'refunded') {
        return { error: 'already_finalized', currentStatus: charge.status };
    }

    const now = Date.now();
    await env.DB.prepare(
        `UPDATE booking_charges
         SET status = 'paid', paid_at = ?, payment_method = ?, payment_reference = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(
        now,
        String(paymentMethod).trim(),
        paymentReference ? String(paymentReference).trim() : null,
        now, chargeId,
    ).run();

    await writeAudit(env, {
        userId: userId || null,
        action: 'charge.marked_paid',
        targetType: 'booking_charge',
        targetId: chargeId,
        meta: { amountCents: charge.amount_cents, paymentMethod, paymentReference: paymentReference || null },
    });

    await sendPaidEmail(env, {
        chargeId,
        paymentMethod: String(paymentMethod).trim(),
        paymentReference: paymentReference || null,
    }).catch((err) => {
        console.error('charge_paid send failed', chargeId, err?.message);
    });

    return { ok: true, chargeId, status: 'paid' };
}

// ────────────────────────────────────────────────────────────────────
// Email senders
// ────────────────────────────────────────────────────────────────────

async function loadAndSend(env, { slug, charge, vars }) {
    if (!charge?.buyer_email) return { skipped: 'no_recipient_email' };
    const template = await loadTemplate(env.DB, slug);
    if (!template) return { skipped: 'template_missing' };
    const rendered = renderTemplate(template, vars);
    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM_EMAIL || env.FROM_EMAIL || 'no-reply@airactionsport.com',
        to: charge.buyer_email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: slug },
            { name: 'charge_id', value: charge.id },
        ],
    });
}

async function sendNoticeEmail(env, { chargeId, paymentLink, linkExpiresAt }) {
    const charge = await getChargeFull(env, chargeId);
    if (!charge) return { skipped: 'charge_not_found' };
    const vars = {
        customerName: charge.buyer_name || 'there',
        eventTitle: charge.event_id || 'your event',
        itemName: charge.item_name || 'rental equipment',
        reasonKind: charge.reason_kind,
        amountDisplay: formatChargeAmount(charge.amount_cents),
        paymentLink: paymentLink || charge.payment_link || '',
        linkExpiresOn: new Date(linkExpiresAt || charge.payment_link_expires_at).toLocaleDateString(),
    };
    return loadAndSend(env, { slug: 'additional_charge_notice', charge, vars });
}

async function sendPaidEmail(env, { chargeId, paymentMethod, paymentReference }) {
    const charge = await getChargeFull(env, chargeId);
    if (!charge) return { skipped: 'charge_not_found' };
    const vars = {
        customerName: charge.buyer_name || 'there',
        itemName: charge.item_name || 'rental equipment',
        amountDisplay: formatChargeAmount(charge.amount_cents),
        paymentMethod,
        paymentReference: paymentReference ? ` (ref: ${paymentReference})` : '',
    };
    return loadAndSend(env, { slug: 'additional_charge_paid', charge, vars });
}

async function sendWaivedEmail(env, { chargeId, waivedReason }) {
    const charge = await getChargeFull(env, chargeId);
    if (!charge) return { skipped: 'charge_not_found' };
    const vars = {
        customerName: charge.buyer_name || 'there',
        itemName: charge.item_name || 'rental equipment',
        amountDisplay: formatChargeAmount(charge.amount_cents),
        waivedReason: waivedReason || 'no reason provided',
    };
    return loadAndSend(env, { slug: 'additional_charge_waived', charge, vars });
}

export { sendNoticeEmail, sendPaidEmail, sendWaivedEmail };
