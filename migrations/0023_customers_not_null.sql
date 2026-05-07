-- 0023_customers_not_null.sql
--
-- M3 Batch 6 — promote bookings.customer_id and attendees.customer_id
-- to NOT NULL via SQLite's table-rebuild pattern.
--
-- Pre-conditions (operator-verifiable before applying):
--   1. Migration 0022 applied (customer_id columns exist, nullable).
--   2. B5 dual-write code deployed (already on main as 7be634e).
--   3. Backfill ran successfully on remote:
--      `node scripts/backfill-customers.js --remote`
--   4. Spot-check: 0 rows with NULL customer_id remain in either table:
--      SELECT COUNT(*) FROM bookings  WHERE customer_id IS NULL;  -- expect 0
--      SELECT COUNT(*) FROM attendees WHERE customer_id IS NULL;  -- expect 0
--
-- The rebuild copies all rows verbatim into a new table with the NOT
-- NULL constraint, drops the old table, renames the new one, and
-- recreates indexes. SQLite's ALTER TABLE doesn't support adding NOT
-- NULL directly; the rebuild is the canonical workaround.
--
-- D1 has foreign key enforcement disabled by default (per Cloudflare
-- docs), so no PRAGMA foreign_keys=OFF/ON dance is needed. Wrapping in
-- a transaction so a partial failure leaves the original tables intact.
--
-- Operator-applies-remote step (post-backfill, post-spot-check):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Original column order is preserved verbatim from production (queried
-- via sqlite_master 2026-05-07). The new tables retain every column,
-- index, and FK reference of the originals — only the NOT NULL on
-- customer_id changes.

BEGIN TRANSACTION;

-- ────────────────────────────────────────────────────────────────────
-- bookings rebuild
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE bookings_new (
    id                      TEXT PRIMARY KEY,
    event_id                TEXT NOT NULL REFERENCES events(id),
    full_name               TEXT NOT NULL,
    email                   TEXT NOT NULL,
    phone                   TEXT NOT NULL,
    player_count            INTEGER NOT NULL,
    line_items_json         TEXT NOT NULL,
    subtotal_cents          INTEGER NOT NULL,
    tax_cents               INTEGER NOT NULL DEFAULT 0,
    total_cents             INTEGER NOT NULL,
    stripe_session_id       TEXT,
    stripe_payment_intent   TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending',
    notes                   TEXT,
    referral                TEXT,
    created_at              INTEGER NOT NULL,
    paid_at                 INTEGER,
    refunded_at             INTEGER,
    cancelled_at            INTEGER,
    discount_cents          INTEGER NOT NULL DEFAULT 0,
    promo_code_id           TEXT,
    fee_cents               INTEGER NOT NULL DEFAULT 0,
    pending_attendees_json  TEXT,
    reminder_sent_at        INTEGER,
    reminder_1hr_sent_at    INTEGER,
    payment_method          TEXT,
    customer_id             TEXT NOT NULL REFERENCES customers(id)
);

INSERT INTO bookings_new (
    id, event_id, full_name, email, phone, player_count, line_items_json,
    subtotal_cents, tax_cents, total_cents, stripe_session_id,
    stripe_payment_intent, status, notes, referral, created_at, paid_at,
    refunded_at, cancelled_at, discount_cents, promo_code_id, fee_cents,
    pending_attendees_json, reminder_sent_at, reminder_1hr_sent_at,
    payment_method, customer_id
)
SELECT
    id, event_id, full_name, email, phone, player_count, line_items_json,
    subtotal_cents, tax_cents, total_cents, stripe_session_id,
    stripe_payment_intent, status, notes, referral, created_at, paid_at,
    refunded_at, cancelled_at, discount_cents, promo_code_id, fee_cents,
    pending_attendees_json, reminder_sent_at, reminder_1hr_sent_at,
    payment_method, customer_id
FROM bookings;

DROP TABLE bookings;
ALTER TABLE bookings_new RENAME TO bookings;

CREATE INDEX idx_bookings_created        ON bookings(created_at);
CREATE INDEX idx_bookings_customer       ON bookings(customer_id);
CREATE INDEX idx_bookings_email          ON bookings(email);
CREATE INDEX idx_bookings_event_status   ON bookings(event_id, status);
CREATE INDEX idx_bookings_payment_method ON bookings(payment_method, created_at DESC);
CREATE INDEX idx_bookings_stripe_session ON bookings(stripe_session_id);

-- ────────────────────────────────────────────────────────────────────
-- attendees rebuild
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE attendees_new (
    id                      TEXT PRIMARY KEY,
    booking_id              TEXT NOT NULL REFERENCES bookings(id),
    ticket_type_id          TEXT NOT NULL REFERENCES ticket_types(id),
    first_name              TEXT NOT NULL,
    last_name               TEXT,
    email                   TEXT,
    phone                   TEXT,
    qr_token                TEXT NOT NULL UNIQUE,
    waiver_id               TEXT,
    checked_in_at           INTEGER,
    checked_in_by           TEXT REFERENCES users(id),
    cancelled_at            INTEGER,
    created_at              INTEGER NOT NULL,
    custom_answers_json     TEXT,
    customer_id             TEXT NOT NULL REFERENCES customers(id)
);

INSERT INTO attendees_new (
    id, booking_id, ticket_type_id, first_name, last_name, email, phone,
    qr_token, waiver_id, checked_in_at, checked_in_by, cancelled_at,
    created_at, custom_answers_json, customer_id
)
SELECT
    id, booking_id, ticket_type_id, first_name, last_name, email, phone,
    qr_token, waiver_id, checked_in_at, checked_in_by, cancelled_at,
    created_at, custom_answers_json, customer_id
FROM attendees;

DROP TABLE attendees;
ALTER TABLE attendees_new RENAME TO attendees;

CREATE INDEX idx_attendees_booking     ON attendees(booking_id);
CREATE INDEX idx_attendees_customer    ON attendees(customer_id);
CREATE INDEX idx_attendees_qr          ON attendees(qr_token);
CREATE INDEX idx_attendees_ticket_type ON attendees(ticket_type_id);

COMMIT;
