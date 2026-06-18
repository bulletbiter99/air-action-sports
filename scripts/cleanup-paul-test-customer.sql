-- Cleanup: remove the orphaned operator test customer cus_WzLgDpKe8A3t93
-- (Paul Keddington, bulletbiter99@gmail.com). Applied to remote D1 2026-06-17.
--
-- This customer was created solely by the $0.56 cutover e2e booking (bk_KV6rymsx2iaSEM),
-- which was deleted in scripts/cleanup-cutover-test-bookings.sql, leaving it orphaned
-- (total_bookings=1 / $0.56 LTV pointing at a now-deleted booking).
-- Verified zero references in bookings / attendees / customer_contacts, and the
-- marketing + field-rental + gdpr tables are globally empty. Only a single customer_tags
-- 'new' row remains. This is the operator's OWN customer record; they are a separate admin
-- user in users/persons, so this hard-delete does not affect their login. Expect 2 rows deleted.
DELETE FROM customer_tags WHERE customer_id = 'cus_WzLgDpKe8A3t93';
DELETE FROM customers WHERE id = 'cus_WzLgDpKe8A3t93' AND email = 'bulletbiter99@gmail.com';
