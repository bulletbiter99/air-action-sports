// M3 Batch 5 — customers dual-write helpers.
//
// Two responsibilities:
//
//   findOrCreateCustomerForBooking(db, args)
//     Resolves a booking's buyer email + name to a customer_id. Idempotent
//     by email_normalized — UNIQUE INDEX on customers(email_normalized)
//     WHERE archived_at IS NULL guarantees no duplicate active rows even
//     under concurrent webhook + admin races. Returns null when the email
//     is missing or malformed (those bookings stay unlinked until B4's
//     backfill or a future B5+ correction).
//
//   recomputeCustomerDenormalizedFields(db, customerId)
//     Refreshes the aggregate columns on customers (total_bookings,
//     total_attendees, lifetime_value_cents, refund_count, first_booking_at,
//     last_booking_at) by querying the bookings linked to that customer.
//     Mirrors the backfill helper logic exactly so dual-write and backfill
//     always converge on identical values.
//
// Wiring (B5):
//   - worker/routes/webhooks.js handleCheckoutCompleted: findOrCreate after
//     the pending-booking lookup; UPDATE bookings binds customer_id;
//     each INSERT INTO attendees binds customer_id; recompute after the
//     ticket-types increment + audit log.
//   - worker/routes/admin/bookings.js POST /manual: findOrCreate before
//     the INSERT INTO bookings (both branches); INSERT INTO attendees
//     binds customer_id (immediate-paid branch); recompute after attendees
//     are inserted (immediate-paid only — card branch defers to webhook).
//   - worker/routes/admin/bookings.js POST /:id/refund: recompute after
//     the UPDATE bookings SET status='refunded' so refund_count + LTV
//     reflect the refund.
//
// Pre-B6, customer_id is nullable on bookings + attendees, and legacy rows
// (created before B5 deploy or with malformed/null email) carry NULL.
// Refund recompute on a NULL-customer booking is a no-op. The 7-day
// dual-write verification window observes audit_log for customer.created
// errors before B6 promotes the columns to NOT NULL.

import { customerId } from './ids.js';
import { normalizeEmail } from './customerEmail.js';

/**
 * Find an existing active customer matching the buyer's email, or create
 * a new one. Returns the customer id (TEXT, 'cus_*'), or null when the
 * email is missing or malformed.
 *
 * On INSERT, emits a 'customer.created' audit row with source='dual_write'.
 * On hit, no audit emission and no row mutation — recompute is the
 * caller's responsibility once attendees have been inserted.
 *
 * @param {D1Database} db
 * @param {object} args
 * @param {string|null|undefined} args.email - buyer email (raw; will be normalized)
 * @param {string|null|undefined} args.name - display name (kept first-seen)
 * @param {string|null|undefined} args.phone - display phone
 * @param {string|null} [args.actorUserId] - admin user id when called from admin manual booking; null for webhook
 * @returns {Promise<string|null>} customer id, or null when email is missing/malformed
 */
export async function findOrCreateCustomerForBooking(db, args) {
    const email = args?.email;
    const name = args?.name ?? null;
    const phone = args?.phone ?? null;
    const actorUserId = args?.actorUserId ?? null;

    const emailNormalized = normalizeEmail(email);
    if (emailNormalized == null) return null;

    const existing = await db.prepare(
        `SELECT id FROM customers WHERE email_normalized = ? AND archived_at IS NULL`,
    ).bind(emailNormalized).first();
    if (existing?.id) return existing.id;

    const id = customerId();
    const now = Date.now();
    const displayEmail = typeof email === 'string' ? email.trim() : null;

    await db.prepare(
        `INSERT INTO customers (
            id, email, email_normalized, name, phone,
            total_bookings, total_attendees, lifetime_value_cents, refund_count,
            first_booking_at, last_booking_at,
            email_transactional, email_marketing, sms_transactional, sms_marketing,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, NULL, 1, 1, 0, 0, ?, ?)`,
    ).bind(
        id,
        displayEmail || null,
        emailNormalized,
        name || null,
        phone || null,
        now,
        now,
    ).run();

    await db.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'customer.created', 'customer', ?, ?, ?)`,
    ).bind(
        actorUserId,
        id,
        JSON.stringify({ source: 'dual_write', normalized_email: emailNormalized }),
        now,
    ).run();

    return id;
}

/**
 * Recompute the denormalized aggregate columns on a customer row from
 * scratch using the current state of bookings linked to that customer.
 *
 * Mirrors backfill-customers.js computeDenormalizedFields() exactly so
 * dual-write and backfill always converge on identical values.
 *
 * Aggregates:
 *   - total_bookings: count of bookings
 *   - total_attendees: sum of player_count where status NOT IN ('abandoned')
 *   - lifetime_value_cents: sum of total_cents where status='paid' only
 *   - refund_count: count where status='refunded'
 *   - first_booking_at / last_booking_at: min/max created_at
 *
 * Post-B6 (migration 0023): bookings.customer_id and attendees.customer_id
 * are NOT NULL. Callers MUST pass a non-empty customer id.
 *
 * @param {D1Database} db
 * @param {string} cid - non-empty customer id
 * @returns {Promise<void>}
 */
export async function recomputeCustomerDenormalizedFields(db, cid) {
    const result = await db.prepare(
        `SELECT status, total_cents, player_count, created_at
         FROM bookings WHERE customer_id = ?`,
    ).bind(cid).all();
    const rows = result?.results || [];

    let totalAttendees = 0;
    let lifetimeValueCents = 0;
    let refundCount = 0;
    let firstBookingAt = null;
    let lastBookingAt = null;

    for (const b of rows) {
        if (b.status !== 'abandoned') {
            totalAttendees += b.player_count || 0;
        }
        if (b.status === 'paid') {
            lifetimeValueCents += b.total_cents || 0;
        }
        if (b.status === 'refunded') {
            refundCount += 1;
        }
        if (firstBookingAt == null || b.created_at < firstBookingAt) {
            firstBookingAt = b.created_at;
        }
        if (lastBookingAt == null || b.created_at > lastBookingAt) {
            lastBookingAt = b.created_at;
        }
    }

    await db.prepare(
        `UPDATE customers SET
            total_bookings = ?,
            total_attendees = ?,
            lifetime_value_cents = ?,
            refund_count = ?,
            first_booking_at = ?,
            last_booking_at = ?,
            updated_at = ?
         WHERE id = ?`,
    ).bind(
        rows.length,
        totalAttendees,
        lifetimeValueCents,
        refundCount,
        firstBookingAt,
        lastBookingAt,
        Date.now(),
        cid,
    ).run();
}
