-- Cleanup: remove 5 leftover $0.30 cancelled test bookings for Glen Anderson.
-- Applied to remote D1 2026-06-17.
--
-- Context: Glen Anderson had 6 bookings — 1 real comp (bk_jNcrJZxc7FtP9f, kept) plus
-- 5 abandoned-checkout test artifacts from 2026-06-04, all status='cancelled',
-- total_cents=30 ($0.30), customer_id='__needs_backfill__'. Verified zero child rows
-- in attendees / waivers / rental_assignments / booking_charges, so the delete has no
-- cascade. The extra AND clauses guard against deleting anything but a cancelled $0.30
-- Glen Anderson row even if an id were mistyped. Expect exactly 5 rows deleted.
DELETE FROM bookings
WHERE id IN (
    'bk_4QBo6uTGMPACqQ',
    'bk_Kj0bdcygR7tVAm',
    'bk_6ksRVp9c7lWlOd',
    'bk_GsfqJQEIcQxFu2',
    'bk_7woporZrFIhPpI'
  )
  AND status = 'cancelled'
  AND total_cents = 30
  AND full_name = 'Glen Anderson';
