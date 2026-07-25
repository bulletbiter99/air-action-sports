-- Companion to scripts/reschedule-hough-firestorm-to-lastlight.sql
-- Booking bk_a1KXVD7ZWV0Arb — Garrett k Hough (mtnxscape@gmail.com)
--
-- ⚠️ RUN ONLY AFTER the $21.97 partial refund has actually cleared in Stripe
--    against pi_3TqKBHGlZJAivAoT1Koezr8O. This script does NOT move money; it
--    only makes the booking row agree with what Stripe actually kept.
--
-- WHY THIS IS NEEDED
-- ------------------
-- The reschedule deliberately leaves payment untouched, so the booking still
-- records the Fire Storm amounts ($80.00 + $5.40 tax + $2.77 fee = $88.17) while
-- the customer is now on a $66.20 event. This app has no partial-refund concept
-- (issueRefund takes no amount; there is no refund_amount_cents column), so the
-- refund happens in the Stripe dashboard and the row has to be corrected here or
-- paid-revenue reporting sits $21.97 above Stripe forever.
--
-- refunded_at is deliberately NOT set. This booking is not refunded — it is a
-- live, paid Last Light booking worth $66.20. Setting refunded_at would drop it
-- out of paid revenue entirely and overcorrect in the other direction. The
-- partial refund is recorded in audit_log instead.
--
-- Amounts are the authoritative output of POST /api/bookings/quote for
-- 1x tt_NzvgjgKN8Kdc, i.e. exactly what he would have paid had he booked Last
-- Light directly:
--     ticket   $60.00
--     city tax  $1.14  (1.90%)
--     state tax $2.91  (4.85%)
--     fee       $2.15  (2.90% + $0.30)
--     TOTAL    $66.20
-- $88.17 - $66.20 = $21.97 refunded. (NOT the $20 ticket delta — tax and the
-- processing fee scale with the ticket price.)
--
-- The ticket line item's name is also corrected here: the reschedule endpoint
-- only remaps ticket_type_id, so it still read "Operation Fire Storm - Entry".

UPDATE bookings
SET line_items_json = '[{"type":"ticket","ticket_type_id":"tt_NzvgjgKN8Kdc","name":"Standard Ticket","qty":1,"unit_price_cents":6000,"line_total_cents":6000},{"type":"tax","tax_fee_id":"tf_city_tax","name":"City Tax","line_total_cents":114,"percent_bps":190,"fixed_cents":0},{"type":"tax","tax_fee_id":"tf_state_tax","name":"State Tax","line_total_cents":291,"percent_bps":485,"fixed_cents":0},{"type":"fee","tax_fee_id":"tf_processing_fees","name":"Processing Fees","line_total_cents":215,"percent_bps":290,"fixed_cents":30}]',
    subtotal_cents = 6000,
    tax_cents = 405,
    fee_cents = 215,
    total_cents = 6620
WHERE id = 'bk_a1KXVD7ZWV0Arb'
  AND event_id = 'ghost-town-iii-regular-play'
  AND status = 'paid'
  AND total_cents = 8817;   -- guard: no-op if already settled

INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
VALUES (
  'u_HGjSvaIWPIBl',
  'booking.partial_refund_recorded',
  'booking',
  'bk_a1KXVD7ZWV0Arb',
  '{"reason":"event_change_price_difference","from_total_cents":8817,"to_total_cents":6620,"refunded_cents":2197,"stripe_payment_intent":"pi_3TqKBHGlZJAivAoT1Koezr8O","refund_method":"stripe_dashboard_partial","note":"Rescheduled Fire Storm ($80) -> Last Light ($60) at customer request; refunded the difference incl. tax + processing fee. App supports full refunds only, so the refund was issued in the Stripe dashboard and the booking row corrected to the net-collected amount. refunded_at intentionally left NULL — this is a live paid booking, not a refunded one.","applied_via":"scripts/settle-hough-partial-refund.sql"}',
  strftime('%s','now') * 1000
);
