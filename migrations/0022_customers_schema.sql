-- 0022_customers_schema.sql
--
-- M3 Batch 3 — customers entity schema (additive).
--
-- Lands the customers entity per Surface 3 design. No code changes; pure
-- schema. After this migration applies, B4's backfill script populates
-- customers + customer_id columns on existing bookings/attendees.
-- B5 wires dual-write into the webhook + admin manual booking handlers.
-- B6 promotes bookings.customer_id and attendees.customer_id to NOT NULL
-- after a 7-day dual-write verification window.
--
-- Tables:
--   customers              — canonical customer record with denormalized
--                            booking aggregates and comm-pref columns
--   customer_tags          — manual + system-computed tags (B10 cron
--                            refreshes system tags nightly)
--   segments               — backs both customer segments and saved views
--                            (single table per Surface 3)
--   gdpr_deletions         — GDPR/CCPA delete audit trail (B11). FK-loose
--                            on customer_id so the row survives even when
--                            the customer is later archived/redacted.
--
-- ALTERs on existing tables:
--   bookings.customer_id   — nullable now; B6 promotes to NOT NULL
--   attendees.customer_id  — nullable now; B6 promotes to NOT NULL
--
-- Forward-only. Re-application is a no-op via the d1_migrations tracker
-- (wrangler skips applied migrations) plus IF NOT EXISTS on CREATE
-- statements as belt-and-suspenders. SQLite's ALTER TABLE ADD COLUMN
-- does not support IF NOT EXISTS, so re-applying after a successful
-- prior apply requires the migration tracker to be authoritative.
--
-- Operator-applies-remote step (post-merge, BEFORE Batch 4 starts):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Indexes follow the Surface 3 design:
--   idx_customers_email_normalized — UNIQUE WHERE archived_at IS NULL.
--     Allows multiple archived customers with the same normalized email
--     (e.g. merged duplicates) while preventing two ACTIVE rows from
--     sharing a normalized address.
--   idx_customers_archived_last_booking — admin list view ordering.
--   idx_customers_ltv — VIP segment + LTV-sort filter.
--   idx_bookings_customer / idx_attendees_customer — customer card render
--     pulls the bookings/attendees lists for one customer in O(log n).
--   idx_customer_tags_customer / idx_customer_tags_tag — tag list per
--     customer + segment evaluation by tag.
--   idx_segments_owner — "my saved views" filter.
--   idx_gdpr_deletions_customer — audit lookup by customer.

-- ────────────────────────────────────────────────────────────────────
-- customers — canonical record
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
    id                      TEXT PRIMARY KEY,            -- 'cus_*'
    -- Email split (decision register #32):
    email                   TEXT,                        -- display form (preserves case as first seen)
    email_normalized        TEXT,                        -- matching key (customerEmail.normalizeEmail)
    name                    TEXT,                        -- display name
    phone                   TEXT,
    -- Denormalized booking aggregates (B4 backfills; B5 maintains):
    total_bookings          INTEGER NOT NULL DEFAULT 0,
    total_attendees         INTEGER NOT NULL DEFAULT 0,
    lifetime_value_cents    INTEGER NOT NULL DEFAULT 0,  -- sum of paid bookings only
    refund_count            INTEGER NOT NULL DEFAULT 0,
    first_booking_at        INTEGER,                     -- ms epoch
    last_booking_at         INTEGER,                     -- ms epoch
    -- Communication preferences (decision register #34):
    email_transactional     INTEGER NOT NULL DEFAULT 1 CHECK (email_transactional IN (0, 1)),
    email_marketing         INTEGER NOT NULL DEFAULT 1 CHECK (email_marketing IN (0, 1)),
    sms_transactional       INTEGER NOT NULL DEFAULT 0 CHECK (sms_transactional IN (0, 1)),
    sms_marketing           INTEGER NOT NULL DEFAULT 0 CHECK (sms_marketing IN (0, 1)),
    -- Notes (capability gating happens at the API layer):
    notes                   TEXT,                        -- general notes (customers.write)
    notes_sensitive         TEXT,                        -- gated by customers.notes.read_sensitive
    -- Soft-archive lifecycle (merge target / GDPR redaction):
    archived_at             INTEGER,                     -- NULL = active
    archived_reason         TEXT,                        -- 'merged' / 'gdpr_delete' / 'manual'
    archived_by             TEXT REFERENCES users(id),
    merged_into             TEXT REFERENCES customers(id),  -- non-NULL when archived via merge
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

-- UNIQUE on email_normalized only for ACTIVE customers. Archived
-- duplicates from merge / GDPR archival are allowed to share the
-- normalized address with their successor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_normalized
    ON customers(email_normalized) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_archived_last_booking
    ON customers(archived_at, last_booking_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_ltv
    ON customers(archived_at, lifetime_value_cents DESC);

-- ────────────────────────────────────────────────────────────────────
-- customer_tags — manual + system tags
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_tags (
    customer_id             TEXT NOT NULL REFERENCES customers(id),
    tag                     TEXT NOT NULL,
    tag_type                TEXT NOT NULL DEFAULT 'manual'
                            CHECK (tag_type IN ('manual', 'system')),
    created_at              INTEGER NOT NULL,
    created_by              TEXT REFERENCES users(id),  -- NULL for system tags
    PRIMARY KEY (customer_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag ON customer_tags(tag);

-- ────────────────────────────────────────────────────────────────────
-- segments — customer segments + saved views (single table per Surface 3)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS segments (
    id                      TEXT PRIMARY KEY,            -- 'seg_*'
    name                    TEXT NOT NULL,
    type                    TEXT NOT NULL
                            CHECK (type IN ('customer_segment', 'saved_view')),
    query_json              TEXT NOT NULL,               -- filter spec
    owner_id                TEXT REFERENCES users(id),   -- NULL = system-wide
    shared                  INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_owner ON segments(owner_id, type);

-- ────────────────────────────────────────────────────────────────────
-- gdpr_deletions — privacy audit trail
-- ────────────────────────────────────────────────────────────────────
--
-- customer_id is intentionally NOT a foreign key. The customer record
-- itself is preserved (soft-archive with personal fields nulled per
-- Surface 3 #1) so the FK would still be valid, but we avoid the FK
-- to keep this audit row durable even if a future cleanup ever does
-- hard-delete the customer row. The audit row must survive.

CREATE TABLE IF NOT EXISTS gdpr_deletions (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id             TEXT NOT NULL,               -- preserved for audit; not FK
    reason                  TEXT,
    requested_via           TEXT NOT NULL
                            CHECK (requested_via IN ('CCPA', 'GDPR', 'manual')),
    requested_at            INTEGER,
    deleted_at              INTEGER NOT NULL,
    deleted_by              TEXT NOT NULL REFERENCES users(id),
    retention_until         INTEGER,                     -- legal retention deadline (ms epoch)
    notes                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_gdpr_deletions_customer ON gdpr_deletions(customer_id);

-- ────────────────────────────────────────────────────────────────────
-- ALTERs on existing tables — customer_id (nullable; B6 promotes to NOT NULL)
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE bookings ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE attendees ADD COLUMN customer_id TEXT REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_attendees_customer ON attendees(customer_id);
