-- 0075 — capture TRUE Stripe processing fees on bookings.
--
-- Adds nullable columns for the ACTUAL fee + net + balance-transaction id
-- pulled from each charge's Stripe balance_transaction. This is distinct from
-- bookings.fee_cents, which is the operator-entered pass-through fee (2.9% +
-- $0.30 added to the customer total to cover Stripe's cut) — NOT Stripe's
-- actual deduction. A nightly reconciliation cron (runStripeFeeSync) fills
-- these for any paid booking missing them, which also backfills existing rows.
--
-- PRE-MIGRATION SPOT-CHECK (production air-action-sports-db):
-- - bookings exists (M1) with stripe_payment_intent, total_cents, fee_cents,
--   status, paid_at. No stripe_fee_cents / stripe_net_cents /
--   stripe_balance_transaction_id columns yet.
--
-- stripe_net_cents = balance_transaction.net = the exact amount Stripe
-- deposits (charge amount − Stripe's fee). True take-home then subtracts the
-- sales tax the business remits.
--
-- D1 quirks: additive ALTER TABLE ... ADD COLUMN only; no BEGIN/COMMIT.

ALTER TABLE bookings ADD COLUMN stripe_fee_cents INTEGER;
ALTER TABLE bookings ADD COLUMN stripe_net_cents INTEGER;
ALTER TABLE bookings ADD COLUMN stripe_balance_transaction_id TEXT;
