-- Add payment_method to bookings + backfill from existing rows.
-- Values: 'stripe' (public checkout), 'card' (admin walk-in via Stripe Checkout link),
--         'cash', 'venmo', 'paypal', 'comp'.
--
-- Existing rows are backfilled by inspecting notes prefixes left by the manual-booking
-- handler ([CASH] / [COMP]). Public Stripe-paid rows default to 'stripe'.

ALTER TABLE bookings ADD COLUMN payment_method TEXT;

UPDATE bookings
SET payment_method = 'cash'
WHERE notes LIKE '[CASH]%' AND payment_method IS NULL;

UPDATE bookings
SET payment_method = 'comp'
WHERE (status = 'comp' OR notes LIKE '[COMP]%') AND payment_method IS NULL;

-- Anything else that was actually paid via Stripe (has a real payment intent
-- ID, not a 'cash_*' placeholder) is the public flow.
UPDATE bookings
SET payment_method = 'stripe'
WHERE payment_method IS NULL
  AND stripe_payment_intent IS NOT NULL
  AND stripe_payment_intent NOT LIKE 'cash_%';

CREATE INDEX idx_bookings_payment_method ON bookings(payment_method, created_at DESC);
