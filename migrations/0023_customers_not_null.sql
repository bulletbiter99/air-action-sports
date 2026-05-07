-- 0023_customers_not_null.sql
--
-- M3 Batch 6 — promote bookings.customer_id and attendees.customer_id
-- to NOT NULL.
--
-- Pre-conditions (operator-verified before applying):
--   1. Migration 0022 applied (customer_id columns exist, nullable).
--   2. B5 dual-write code deployed (already on main as 7be634e).
--   3. Backfill ran successfully on remote:
--      `node scripts/backfill-customers.js --remote`
--   4. Spot-check: 0 rows with NULL customer_id remain in either table.
--
-- Approach: column-rename pattern (SQLite 3.35+).
--   Original `customer_id` column is nullable. We add a new column
--   `customer_id_new` with NOT NULL + sentinel DEFAULT, copy values
--   over with UPDATE, drop the old column, and rename the new one
--   into place. This avoids the table-level rebuild's FOREIGN KEY
--   constraint failure (the standard rebuild requires PRAGMA
--   foreign_keys=OFF, which D1's migration-apply path enforces ON).
--
--   The sentinel default `__needs_backfill__` is invalid as a real
--   customer reference but satisfies NOT NULL during ADD COLUMN. The
--   subsequent UPDATE replaces it with the actual customer_id (which
--   the backfill populated). After RENAME, the column matches what
--   a NOT NULL rebuild would have produced — same constraint, same
--   data — except the new column has no FOREIGN KEY clause.
--
--   Loss: the new customer_id column is declared without
--   `REFERENCES customers(id)`. D1 doesn't enforce FKs at runtime by
--   default (per Cloudflare docs), so this is documentation-only loss.
--   The backfill + dual-write code guarantees referential integrity
--   at the application layer. M4+ may revisit if Cloudflare changes
--   D1's FK posture or if a future enforcement requirement appears.
--
-- Operator-applies-remote step (post-backfill, post-spot-check):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- D1 does NOT support SQL transaction-control statements (suggests
-- db.batch() instead). This file runs as a sequence; wrangler's
-- migration runner wraps the file atomically and rolls back on
-- failure (verified during the failed table-rebuild attempt — no
-- orphan tables remained).

-- ────────────────────────────────────────────────────────────────────
-- bookings: customer_id NOT NULL via column-rename
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE bookings
    ADD COLUMN customer_id_new TEXT NOT NULL DEFAULT '__needs_backfill__';

UPDATE bookings
    SET customer_id_new = customer_id
    WHERE customer_id IS NOT NULL;

-- Old column had nullable customer_id REFERENCES customers(id); we
-- drop the indexed-on-customer_id column too (CREATE INDEX after
-- the rename re-establishes it on the new column).
DROP INDEX IF EXISTS idx_bookings_customer;

ALTER TABLE bookings DROP COLUMN customer_id;

ALTER TABLE bookings RENAME COLUMN customer_id_new TO customer_id;

CREATE INDEX idx_bookings_customer ON bookings(customer_id);

-- ────────────────────────────────────────────────────────────────────
-- attendees: customer_id NOT NULL via column-rename
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE attendees
    ADD COLUMN customer_id_new TEXT NOT NULL DEFAULT '__needs_backfill__';

UPDATE attendees
    SET customer_id_new = customer_id
    WHERE customer_id IS NOT NULL;

DROP INDEX IF EXISTS idx_attendees_customer;

ALTER TABLE attendees DROP COLUMN customer_id;

ALTER TABLE attendees RENAME COLUMN customer_id_new TO customer_id;

CREATE INDEX idx_attendees_customer ON attendees(customer_id);
