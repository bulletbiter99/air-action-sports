-- Cleanup: remove leftover cutover-era test bookings (2026-06-03 Stripe live-cutover testing).
-- Applied to remote D1 2026-06-17.
--
-- All 5 verified: no attendees, waivers, rental_assignments, or booking_charges.
--   bk_KV6rymsx2iaSEM  Paul Keddington  $0.56  cancelled  — the live $0.56 e2e test; its PI
--                      was already refunded in Stripe, and deleting the row is the docs'
--                      recommended durable void (a webhook redelivery can re-pay a non-paid row).
--   bk_PLdru8Yn04gD3a  "Cutover Verify" $27.75 cancelled — literal test booking.
--   bk_AKFIsqf8pDuizC  Tyson Wright     $44.23 abandoned  — Stripe TEST-mode artifact.
--   bk_P2yfy41MQnmz2O  Tyson Wright     $44.23 abandoned  — Stripe TEST-mode artifact.
--   bk_vpQ1hkeZpUivrI  Tyson Wright     $44.23 abandoned  — Stripe TEST-mode artifact.
-- Tyson Wright's REAL reconciled paid booking (bk_v8JmtpX9L6lclQ) is deliberately NOT listed.
-- The status guard ensures only cancelled/abandoned rows can be removed. Expect 5 rows deleted.
DELETE FROM bookings
WHERE id IN (
    'bk_KV6rymsx2iaSEM',
    'bk_PLdru8Yn04gD3a',
    'bk_AKFIsqf8pDuizC',
    'bk_P2yfy41MQnmz2O',
    'bk_vpQ1hkeZpUivrI'
  )
  AND status IN ('cancelled', 'abandoned');
