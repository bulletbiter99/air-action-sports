-- M5.5 Batch 5 — Migration D: field_rentals documents + payments + SUA templates
--
-- Creates 3 new tables completing the field rentals schema substrate:
--   1. site_use_agreement_documents — versioned/immutable SUA template library
--   2. field_rental_documents        — per-rental files (SUA copies, COI, addenda)
--   3. field_rental_payments         — per-transaction payment records
--
-- After this batch, the entire field rentals schema substrate is in place.
-- B6 adds capabilities; B7 ships routes; B8 ships UI; B10 adds cron sweeps.
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-11; per Lesson #7)
-- ============================================================
-- - field_rentals exists (B4 — applied to remote at B4 close)
-- - field_rental_recurrences exists (B4)
-- - users exists; sites exists
-- - 3 target tables do NOT exist on remote (clear to create)
--
-- Canonical versioned-document pattern verified against the two existing
-- production tables (waiver_documents + vendor_contract_documents):
--
--   id TEXT PRIMARY KEY
--   version INTEGER NOT NULL UNIQUE            -- INTEGER (1, 2, 3...), NOT TEXT
--   title TEXT NOT NULL                        -- vendor_contract pattern
--   body_html TEXT NOT NULL
--   body_sha256 TEXT NOT NULL                  -- hex sha256 for integrity check
--   effective_from INTEGER NOT NULL            -- separate from created_at
--   retired_at INTEGER                         -- null = live
--   created_by TEXT REFERENCES users(id)       -- NOT created_by_user_id
--   created_at INTEGER NOT NULL
--
-- site_use_agreement_documents mirrors this pattern exactly. The Surface 7
-- draft used `version TEXT 'v1.0'` + `created_by_user_id`; both rejected
-- in favor of the production-canonical shape.
--
-- DESIGN DECISIONS (operator-confirmed during B5 plan-mode)
-- ============================================================
-- 1. SUA scope: SINGLE GLOBAL library (no scope / scoped_site_id columns).
--    Per-site SUAs deferred — Surface 7 §9's design was YAGNI for M5.5's
--    2-site footprint. Future migration can ALTER if needed.
-- 2. NO v1.0 placeholder seed. B5 is schema-only. Operator writes the
--    first SUA via /admin/site-agreements once that UI ships (B6.5/B7).
--    B7's "send agreement" flow will refuse until a live SUA row exists.
--
-- STRUCTURAL CHOICES
-- ============================================================
-- - field_rental_documents.kind discriminator: 'agreement','coi','addendum',
--   'correspondence','other'. COI-specific columns (carrier/policy/amount/
--   effective/expires) and SUA-specific columns (sua_document_id,
--   sua_body_sha256_snapshot, sua_signer_*) are nullable. Route layer (B7)
--   enforces which kind populates which columns.
-- - field_rental_payments.payment_kind: deposit/balance/full/damage/refund/other.
--   Operationally distinct from payment_method (cash/check/venmo/etc.).
-- - stripe_invoice_id nullable — Stripe Invoices is M6 territory. v1 records
--   payments off-platform; the column reserves space for the M6 integration.
-- - field_rentals.deposit_* and balance_* columns from B4 remain as
--   denormalized aggregates; field_rental_payments is the canonical
--   per-transaction record. Route layer maintains both.
-- - field_rental_documents.retired_at supports versioning (e.g. when an
--   addendum is added, the previous agreement gets retired_at set and a
--   new agreement document is inserted). The "live" version per (rental_id,
--   kind) is the one with retired_at IS NULL.
-- - file integrity check via sua_body_sha256_snapshot: at sign time the
--   route captures the SUA template's body_sha256; at read time the route
--   recomputes it and refuses on mismatch (audit_log
--   field_rental_agreement.integrity_failure). Same pattern as M3 waiver
--   integrity checks.
--
-- D1 QUIRKS OBSERVED
-- ============================================================
-- - Additive only: CREATE TABLE + CREATE INDEX. No table-rebuild;
--   FK-during-DROP gotcha not triggered.
-- - No BEGIN/COMMIT keywords; no literal "TRANSACTION" keyword anywhere.
-- - No email_templates seed; Lesson #7 not applicable.

-- ────────────────────────────────────────────────────────────────────
-- site_use_agreement_documents — versioned SUA template library
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE site_use_agreement_documents (
  id              TEXT PRIMARY KEY,
  version         INTEGER NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  body_sha256     TEXT NOT NULL,                -- hex sha256 of body_html
  effective_from  INTEGER NOT NULL,              -- when this version becomes the live one
  retired_at      INTEGER,                       -- null = live; non-null = retired
  retired_by      TEXT REFERENCES users(id),
  created_by      TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_sua_live ON site_use_agreement_documents(retired_at);

-- ────────────────────────────────────────────────────────────────────
-- field_rental_documents — per-rental file attachments
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE field_rental_documents (
  id                          TEXT PRIMARY KEY,
  rental_id                   TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  kind                        TEXT NOT NULL CHECK (kind IN (
    'agreement','coi','addendum','correspondence','other'
  )),

  -- File storage (R2)
  file_name                   TEXT NOT NULL,
  r2_key                      TEXT NOT NULL,                 -- field_rentals/<rental_id>/<frd_id>.<ext>
  content_type                TEXT NOT NULL,
  bytes                       INTEGER NOT NULL,

  -- COI-specific (nullable; populated when kind='coi')
  coi_carrier_name            TEXT,
  coi_policy_number           TEXT,
  coi_amount_cents            INTEGER,
  coi_effective_at            INTEGER,
  coi_expires_at              INTEGER,

  -- SUA-specific (nullable; populated when kind='agreement')
  sua_document_id             TEXT REFERENCES site_use_agreement_documents(id),
  sua_body_sha256_snapshot    TEXT,
  sua_signer_typed_name       TEXT,
  sua_signer_ip               TEXT,
  sua_signer_ua               TEXT,
  sua_signed_at               INTEGER,

  -- Audit + lifecycle
  uploaded_by_user_id         TEXT REFERENCES users(id),
  uploaded_at                 INTEGER NOT NULL,
  retired_at                  INTEGER,                       -- versioning support
  notes                       TEXT
);
CREATE INDEX idx_frd_rental   ON field_rental_documents(rental_id);
CREATE INDEX idx_frd_kind     ON field_rental_documents(kind);
CREATE INDEX idx_frd_live     ON field_rental_documents(rental_id, kind, retired_at);
CREATE INDEX idx_frd_sua_doc  ON field_rental_documents(sua_document_id);

-- ────────────────────────────────────────────────────────────────────
-- field_rental_payments — per-transaction payment records
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE field_rental_payments (
  id                  TEXT PRIMARY KEY,
  rental_id           TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  recurrence_id       TEXT REFERENCES field_rental_recurrences(id),  -- NULL = one-off or parent deposit

  -- Classification
  payment_kind        TEXT NOT NULL CHECK (payment_kind IN (
    'deposit','balance','full','damage','refund','other'
  )),

  -- Method + reference
  payment_method      TEXT NOT NULL CHECK (payment_method IN (
    'cash','check','venmo','ach','card_offplatform','stripe_invoice'
  )),
  reference           TEXT,                                  -- check number / venmo handle / etc.
  stripe_invoice_id   TEXT,                                  -- M6 territory; nullable for v1

  -- Amount + status
  amount_cents        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','received','refunded','void'
  )),

  -- Lifecycle
  due_at              INTEGER,
  received_at         INTEGER,
  refunded_at         INTEGER,
  refund_amount_cents INTEGER,
  refund_reason       TEXT,
  refund_method       TEXT CHECK (refund_method IS NULL OR refund_method IN (
    'cash','check','venmo','ach','card_offplatform','stripe_invoice'
  )),

  -- Audit
  received_by_user_id TEXT REFERENCES users(id),
  notes               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_frp_rental      ON field_rental_payments(rental_id);
CREATE INDEX idx_frp_recurrence  ON field_rental_payments(recurrence_id);
CREATE INDEX idx_frp_status      ON field_rental_payments(status);
CREATE INDEX idx_frp_stripe      ON field_rental_payments(stripe_invoice_id);
