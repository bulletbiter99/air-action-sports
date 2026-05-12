-- 0050_customers_client_type_not_null.sql
--
-- M5.5 Batch 9 — promote customers.client_type to NOT NULL with
-- DEFAULT 'individual', enforcing the 2-value CHECK enum at the
-- column level so booking-flow customer auto-creates keep working
-- without touching worker/lib/customers.js.
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-12; per Lesson #7)
-- ============================================================
-- Verified against production air-action-sports-db before authoring:
--   - customers table has 27 cols on remote (M3 22 + M5.5 B3 added 5).
--   - client_type column exists (M5.5 B3 / migration 0046), nullable,
--     with CHECK (client_type IS NULL OR client_type IN ('individual','business')).
--   - Index idx_customers_client_type exists (from 0046).
--   - 2 existing customers; both have client_type=NULL (M3 backfill
--     created them before 0046 added the column).
--   - 0 field_rentals (so no FK constraint risk from this migration).
--
-- APPROACH: column-rename pattern (D1 quirk #2; SQLite 3.35+)
-- ============================================================
-- Same pattern as M3 B6's 0023_customers_not_null.sql.
--
-- Why column-rename over table-rebuild: D1 enforces FK constraints
-- during DROP TABLE even though runtime FK enforcement is OFF by
-- default. The SQLite "create new table → copy → drop old → rename"
-- pattern hits FK constraint failures on customers (other tables
-- reference customers.id via REFERENCES). The column-rename pattern
-- avoids the table-level DROP entirely.
--
-- Why DEFAULT 'individual' on the new column: it auto-fills any
-- INSERT that doesn't specify client_type — including the existing
-- worker/lib/customers.js findOrCreateCustomerForBooking() INSERT
-- which today does NOT bind client_type. This keeps the booking-
-- flow customer auto-create working unmodified post-migration.
-- (Verified the lib INSERT shape at worker/lib/customers.js:78-93.)
--
-- The UPDATE step uses COALESCE so the 2 existing NULL rows get
-- 'individual' assigned atomically as part of the migration. No
-- separate backfill script needed (unlike M3's 0023 which required
-- a pre-applied backfill because customer_id needed real values, not
-- a sentinel).
--
-- BACKWARD COMPAT NOTES
-- ============================================================
-- Post-migration, the column reads identically — the public API
-- response shape on /api/admin/customers/:id stays the same except
-- client_type is now guaranteed non-null. Any test fixture that
-- previously stubbed customers without setting client_type continues
-- to work because mockD1 returns whatever the test fixture passes;
-- the route layer doesn't validate client_type on read.
--
-- B7a's worker/routes/admin/fieldRentals.js POST handler verifies
-- customer existence with `SELECT id FROM customers WHERE id = ?` —
-- it doesn't check client_type. A future B10/B11 batch may enforce
-- client_type='business' for field-rental creates; today's check is
-- "any customer can have a rental".
--
-- D1 QUIRKS OBSERVED
-- ============================================================
-- - No BEGIN/COMMIT keywords; wrangler wraps the file atomically.
-- - Column-rename pattern only (no table rebuild); FK-during-DROP
--   not triggered.
-- - No email_templates seed; Lesson #7 not applicable.
-- - The new column starts with NOT NULL DEFAULT 'individual' and a
--   CHECK constraint — both inline in the ADD COLUMN statement, which
--   D1 supports for new columns (unlike trying to ALTER existing ones).
--
-- OPERATOR-APPLIES-REMOTE STEP (post-merge, post-Workers-deploy):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Verify: SELECT client_type, COUNT(*) FROM customers GROUP BY client_type
--   Expected: 'individual' = 2 (both M3 backfill rows promoted)

-- ────────────────────────────────────────────────────────────────────
-- customers.client_type: nullable → NOT NULL DEFAULT 'individual'
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE customers
    ADD COLUMN client_type_new TEXT NOT NULL DEFAULT 'individual'
    CHECK (client_type_new IN ('individual', 'business'));

UPDATE customers
    SET client_type_new = COALESCE(client_type, 'individual');

DROP INDEX IF EXISTS idx_customers_client_type;

ALTER TABLE customers DROP COLUMN client_type;

ALTER TABLE customers RENAME COLUMN client_type_new TO client_type;

CREATE INDEX idx_customers_client_type ON customers(client_type);
