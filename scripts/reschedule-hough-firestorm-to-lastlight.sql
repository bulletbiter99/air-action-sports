-- Customer request — Garrett k Hough (mtnxscape@gmail.com, 801-917-9896)
-- Booking bk_a1KXVD7ZWV0Arb, applied 2026-07-25.
--
-- "I bought the wrong ticket I got the night game one and I need to switch it to
--  the day game for the game in Hiawatha" (general inquiry, 2026-07-07 1:26 PM)
--
--   FROM  Operation Fire Storm  (ghost-town-18hr-milsim,      25 Jul 19:45, $80)
--   TO    Operation Last Light  (ghost-town-iii-regular-play,  25 Jul 08:30, $60)
--
-- Applied as SQL rather than through the admin UI only because check-in was ~7
-- hours away. It replicates POST /api/admin/bookings/:id/reschedule
-- (worker/routes/admin/bookings.js) statement-for-statement:
--   1. bookings.event_id + line_items_json remapped; reminder sentinels cleared
--      so the NEW event's reminders fire
--   2. attendees.ticket_type_id remapped (booking id + QR token carry over)
--   3. sold released on the old ticket type, claimed on the new one
--   4. booking.rescheduled audit row
--
-- Pre-checks performed (all guards the endpoint enforces):
--   status='paid'                            OK
--   target event published=1                 OK
--   target ticket active=1, belongs to event OK
--   no attendee checked in                   OK (at_1ZxfbU3s60fatw, checked_in_at NULL)
--   target capacity                          OK (18 of 350 sold)
--
-- PRESERVED: booking id, QR token yioOAnuW6jZZXBbw58ELJLbw, signed waiver
-- wv_pI3RU44Yn51gLF, and the faction answer "Russian Forces" (Last Light uses
-- the same required Russian/NATO picker).
--
-- PAYMENT IS NOT TOUCHED HERE — exactly as the endpoint behaves. He paid $88.17;
-- Last Light is $66.20 ($60.00 + $4.05 tax + $2.15 fee, per /api/bookings/quote),
-- so $21.97 is owed back. Note that is NOT the $20 ticket-price delta: sales tax
-- and the processing fee scale with the ticket. The refund is a PARTIAL refund in
-- the Stripe dashboard against pi_3TqKBHGlZJAivAoT1Koezr8O — this app only issues
-- FULL refunds (issueRefund takes no amount; there is no refund_amount_cents).
-- The booking's money columns are corrected afterwards by the companion script
-- settle-hough-partial-refund.sql, which must run ONLY once that refund clears.

-- 1. Booking → Last Light. Line items keep qty + prices (payment unchanged);
--    only ticket_type_id is remapped, matching the endpoint.
UPDATE bookings
SET event_id = 'ghost-town-iii-regular-play',
    line_items_json = '[{"type":"ticket","ticket_type_id":"tt_NzvgjgKN8Kdc","name":"Operation Fire Storm - Entry","qty":1,"unit_price_cents":8000,"line_total_cents":8000},{"type":"tax","tax_fee_id":"tf_city_tax","name":"City Tax","line_total_cents":152,"percent_bps":190,"fixed_cents":0},{"type":"tax","tax_fee_id":"tf_state_tax","name":"State Tax","line_total_cents":388,"percent_bps":485,"fixed_cents":0},{"type":"fee","tax_fee_id":"tf_processing_fees","name":"Processing Fees","line_total_cents":277,"percent_bps":290,"fixed_cents":30}]',
    reminder_sent_at = NULL,
    reminder_1hr_sent_at = NULL
WHERE id = 'bk_a1KXVD7ZWV0Arb'
  AND event_id = 'ghost-town-18hr-milsim'
  AND status = 'paid';

-- 2. Attendee → the Last Light ticket type.
UPDATE attendees
SET ticket_type_id = 'tt_NzvgjgKN8Kdc'
WHERE booking_id = 'bk_a1KXVD7ZWV0Arb';

-- 3. Inventory: release on Fire Storm, claim on Last Light.
UPDATE ticket_types
SET sold = MAX(0, sold - 1), updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_NBVUMAr6EnUb';

UPDATE ticket_types
SET sold = sold + 1, updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_NzvgjgKN8Kdc';

-- 4. Audit row — same action + meta shape the endpoint writes.
--    price_difference_cents = (6000 * 1) - 8000 = -2000 (ticket delta only,
--    which is why the settlement script records the true $21.97 separately).
INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
VALUES (
  'u_HGjSvaIWPIBl',
  'booking.rescheduled',
  'booking',
  'bk_a1KXVD7ZWV0Arb',
  '{"from_event":"ghost-town-18hr-milsim","to_event":"ghost-town-iii-regular-play","to_ticket_type":"tt_NzvgjgKN8Kdc","ticket_qty":1,"price_difference_cents":-2000,"applied_via":"scripts/reschedule-hough-firestorm-to-lastlight.sql","reason":"customer_request_wrong_event"}',
  strftime('%s','now') * 1000
);
