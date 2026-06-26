-- Cancel the 2 unpaid Foxtrot (foxtrot-vietnam) bookings.
--
-- These are the cutover-remediation invoices that were never collected:
--   Kayden Case  bk_HabP7q2dPblyHA  $27.75
--   Eduardo Ames bk_BusRxaodwLrQN6  $27.75
-- They were left as status='unpaid' after the 2026-06-03 Stripe live-cutover fix so
-- they would drop out of paid-revenue totals (PR #286). On 2026-06-25 the operator
-- decided to stop carrying them as owed and remove them from the active bookings set.
--
-- This is a CANCEL (reversible), not a delete: status -> 'cancelled' + cancelled_at set.
-- The signed waivers, attendee/QR records, and customer rows are intentionally KEPT.
-- Kayden's separate PAID booking (bk_3Gl3fiv76IuKOJ) and both customer rows are untouched.
-- No revenue change (unpaid was already excluded from paid totals).
--
-- Each statement is guarded so a re-run is a no-op (rows_written drops to 0).

UPDATE bookings
SET status = 'cancelled',
    cancelled_at = strftime('%s','now') * 1000
WHERE id IN ('bk_HabP7q2dPblyHA', 'bk_BusRxaodwLrQN6')
  AND status = 'unpaid';

UPDATE attendees
SET cancelled_at = strftime('%s','now') * 1000
WHERE booking_id IN ('bk_HabP7q2dPblyHA', 'bk_BusRxaodwLrQN6')
  AND cancelled_at IS NULL;

INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
VALUES
  (NULL, 'booking.cancelled', 'booking', 'bk_HabP7q2dPblyHA',
   '{"reason":"unpaid_cutover_invoice_abandoned","prior_status":"unpaid","total_cents":2775,"event_id":"foxtrot-vietnam","kept":"waiver_attendee_customer"}',
   NULL, strftime('%s','now') * 1000),
  (NULL, 'booking.cancelled', 'booking', 'bk_BusRxaodwLrQN6',
   '{"reason":"unpaid_cutover_invoice_abandoned","prior_status":"unpaid","total_cents":2775,"event_id":"foxtrot-vietnam","kept":"waiver_attendee_customer"}',
   NULL, strftime('%s','now') * 1000);
