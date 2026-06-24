// Nightly reconciliation sweep — fills bookings.stripe_fee_cents /
// stripe_net_cents / stripe_balance_transaction_id with the TRUE Stripe fee +
// net from each charge's balance_transaction.
//
// Why a cron (not a webhook): the payment-path webhook (worker/routes/
// webhooks.js) stays byte-untouched — zero risk to payment confirmation — and
// a reconciliation pass is robust to Stripe's no-guaranteed-event-ordering AND
// automatically backfills bookings that were already paid before this shipped.
//
// Idempotent: a booking is a candidate ONLY while stripe_fee_cents IS NULL, so
// once captured it drops out of the next sweep. Each row is guarded so one bad
// PaymentIntent never aborts the batch.

import { retrieveChargeFees } from './stripe.js';

const LIMIT_DEFAULT = 50;

export async function runStripeFeeSync(env, { limit = LIMIT_DEFAULT } = {}) {
    const startedAt = Date.now();
    if (!env?.STRIPE_SECRET_KEY) {
        return { scanned: 0, updated: 0, failed: 0, skipped: 'no_stripe_key', durationMs: Date.now() - startedAt };
    }

    let rows;
    try {
        rows = await env.DB.prepare(
            `SELECT id, stripe_payment_intent FROM bookings
             WHERE status = 'paid'
               AND stripe_payment_intent IS NOT NULL
               AND stripe_fee_cents IS NULL
             ORDER BY paid_at DESC
             LIMIT ?`
        ).bind(limit).all();
    } catch (err) {
        return { scanned: 0, updated: 0, failed: 1, error: err?.message, durationMs: Date.now() - startedAt };
    }

    const candidates = rows?.results || [];
    let updated = 0;
    let failed = 0;

    for (const row of candidates) {
        try {
            const { feeCents, netCents, balanceTransactionId } = await retrieveChargeFees(
                row.stripe_payment_intent, env.STRIPE_SECRET_KEY,
            );
            // Not settled yet (no balance_transaction) — leave NULL to retry.
            if (feeCents == null || balanceTransactionId == null) { failed += 1; continue; }
            await env.DB.prepare(
                `UPDATE bookings
                 SET stripe_fee_cents = ?, stripe_net_cents = ?, stripe_balance_transaction_id = ?, updated_at = ?
                 WHERE id = ?`
            ).bind(feeCents, netCents, balanceTransactionId, Date.now(), row.id).run();
            updated += 1;
        } catch {
            failed += 1;
        }
    }

    return { scanned: candidates.length, updated, failed, durationMs: Date.now() - startedAt };
}
