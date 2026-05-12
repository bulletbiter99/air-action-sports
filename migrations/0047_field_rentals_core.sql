-- M5.5 Batch 4 — Migration C: field_rentals core schema
--
-- Creates the 4 core tables for the field rentals build:
--   1. customer_contacts          — per-customer billing/signer/onsite contacts (B2B)
--   2. field_rental_recurrences   — parent series rules (for weekly/monthly/custom rentals)
--   3. field_rentals              — one occurrence (a single scheduled rental slot)
--   4. field_rental_contacts      — per-rental snapshot of contacts
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-11; per Lesson #7)
-- ============================================================
-- Verified against production air-action-sports-db before authoring:
-- - customers exists (M3 + M5.5 B3 extensions applied; 22 base cols + 5 from B3)
-- - sites exists (M5.5 B1)
-- - site_fields exists (M5.5 B1) — note: this migration does NOT FK to it
--   directly; field_rentals.site_field_ids is comma-separated TEXT (multi-field
--   per rental, denormalized)
-- - persons exists (M5 staff foundation)
-- - users exists
-- - field_rentals / field_rental_contacts / field_rental_recurrences /
--   customer_contacts do NOT exist on remote (clear to create)
--
-- DESIGN DECISIONS (operator-confirmed during B4 plan-mode)
-- ============================================================
-- 1. engagement_type enum (7 values): private_skirmish, paintball,
--    tactical_training, film_shoot, corporate, youth_program, other
-- 2. requirements checklist (5 boolean flags): coi_received,
--    agreement_signed, deposit_received, briefing_scheduled,
--    walkthrough_completed
-- 3. customer_contacts is included now (Surface 7 Option B). Currently
--    zero customers will populate it; the table is forward-looking for
--    B7's customer-create flow.
--
-- STRUCTURAL CHOICES (M5.5 prompt vs Surface 7 draft)
-- ============================================================
-- - Multi-field rentals: field_rentals.site_field_ids is comma-separated
--   TEXT, NOT a FK to a single site_field. A rental can occupy multiple
--   fields on the same site (e.g. corporate event spanning Field A + B).
--   Integrity is enforced at the route layer (B7) not the DB.
-- - Recurrence inversion: field_rentals = one occurrence (with optional
--   FK to a parent recurrence); field_rental_recurrences = the series
--   rules. The B10 cron sweeps the recurrences table nightly and
--   generates new field_rentals rows out to a 90-day horizon.
-- - Per-rental snapshot of contacts: field_rental_contacts stores
--   full_name/email/phone independently. A future B7+ create flow may
--   pre-populate from customer_contacts but the snapshot stays
--   immutable on the rental for historical record.
-- - aas_site_coordinator_person_id FK to persons (M5 staff foundation).
--   Note: not the prompt's typo "ass_site_coordinator_person_id".
-- - Sentinel columns for B10 cron sweeps included now:
--   coi_alert_60d_sent_at, _30d, _7d on field_rentals (per-rental).
--   recurrence_generated_through on field_rental_recurrences (per-series).
--
-- DEFERRED TO LATER BATCHES
-- ============================================================
-- - field_rental_documents (SUA/COI/addenda attachments) → B5
-- - field_rental_payments (Stripe Invoices off-platform records) → B5
-- - site_use_agreement_documents (versioned templates) → B5
-- - Capabilities for field_rentals.*, sites.*, etc. → B6
-- - field_rentals.lead_stale_at sentinel → B10 (added with cron)
-- - customers.billing_contact_id FK to customer_contacts → not added;
--   the "primary" billing contact is inferred from
--   customer_contacts.is_primary + role='billing'
--
-- D1 QUIRKS OBSERVED
-- ============================================================
-- - Additive only: CREATE TABLE + CREATE INDEX. No table-rebuild;
--   FK-during-DROP gotcha not triggered.
-- - No BEGIN/COMMIT keywords; no literal "TRANSACTION" keyword anywhere.
-- - No email_templates seed; Lesson #7 not applicable.

-- ────────────────────────────────────────────────────────────────────
-- customer_contacts — per-customer billing/signer/onsite contacts (B2B)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE customer_contacts (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  role              TEXT NOT NULL CHECK (role IN ('billing', 'signer', 'onsite_lead', 'ap_clerk', 'other')),
  is_primary        INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  notes             TEXT,
  archived_at       INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_customer_contacts_customer ON customer_contacts(customer_id);
CREATE INDEX idx_customer_contacts_role     ON customer_contacts(role);

-- ────────────────────────────────────────────────────────────────────
-- field_rental_recurrences — parent series rules
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE field_rental_recurrences (
  id                          TEXT PRIMARY KEY,
  customer_id                 TEXT NOT NULL REFERENCES customers(id),
  site_id                     TEXT NOT NULL REFERENCES sites(id),

  -- Series rules
  frequency                   TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'custom')),
  weekday_mask                INTEGER,         -- bitmask: 1=Sun, 2=Mon, 4=Tue, 8=Wed, 16=Thu, 32=Fri, 64=Sat (for weekly)
  monthly_pattern             TEXT,            -- JSON for monthly rules, e.g. {"kind":"nth_weekday","n":2,"weekday":2} = "2nd Tuesday"
  custom_dates_json           TEXT,            -- JSON array of YYYY-MM-DD strings for 'custom' frequency

  -- Series window
  starts_on                   TEXT NOT NULL,   -- YYYY-MM-DD first occurrence
  ends_on                     TEXT,            -- YYYY-MM-DD last occurrence; NULL = open-ended
  max_occurrences             INTEGER,         -- alternative to ends_on; NULL = unlimited

  -- Template applied to each generated instance
  template_engagement_type    TEXT NOT NULL,
  template_site_field_ids     TEXT NOT NULL,   -- comma-separated fld_* IDs
  template_starts_local       TEXT NOT NULL,   -- HH:MM local start time
  template_ends_local         TEXT NOT NULL,   -- HH:MM local end time
  template_site_fee_cents     INTEGER NOT NULL,
  template_pricing_notes      TEXT,

  -- B10 recurrence-generation cron sentinel
  recurrence_generated_through TEXT,           -- YYYY-MM-DD last date generated; NULL = nothing generated yet

  -- Lifecycle
  active                      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by                  TEXT REFERENCES users(id),
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);
CREATE INDEX idx_frr_customer ON field_rental_recurrences(customer_id);
CREATE INDEX idx_frr_site     ON field_rental_recurrences(site_id);
CREATE INDEX idx_frr_active   ON field_rental_recurrences(active, recurrence_generated_through);

-- ────────────────────────────────────────────────────────────────────
-- field_rentals — one occurrence (the workhorse table)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE field_rentals (
  id                              TEXT PRIMARY KEY,
  customer_id                     TEXT NOT NULL REFERENCES customers(id),
  site_id                         TEXT NOT NULL REFERENCES sites(id),
  site_field_ids                  TEXT NOT NULL,    -- comma-separated fld_* IDs

  -- Engagement classification
  engagement_type                 TEXT NOT NULL CHECK (engagement_type IN (
    'private_skirmish', 'paintball', 'tactical_training', 'film_shoot',
    'corporate', 'youth_program', 'other'
  )),
  lead_source                     TEXT CHECK (lead_source IS NULL OR lead_source IN (
    'inquiry_form', 'phone', 'email', 'referral', 'walkin', 'other'
  )),

  -- Recurrence linkage (nullable = one-off rental)
  recurrence_id                   TEXT REFERENCES field_rental_recurrences(id),
  recurrence_instance_index       INTEGER,          -- 1, 2, 3, ... within series

  -- Schedule windows (epoch ms)
  scheduled_starts_at             INTEGER NOT NULL,
  scheduled_ends_at               INTEGER NOT NULL,
  arrival_window_starts_at        INTEGER,          -- defaults to scheduled - site.default_arrival_buffer
  cleanup_buffer_ends_at          INTEGER,          -- defaults to scheduled + site.default_cleanup_buffer

  -- Status
  status                          TEXT NOT NULL DEFAULT 'lead' CHECK (status IN (
    'lead', 'draft', 'sent', 'agreed', 'paid', 'completed', 'cancelled', 'refunded'
  )),
  status_changed_at               INTEGER NOT NULL,
  status_change_reason            TEXT,

  -- Pricing
  site_fee_cents                  INTEGER NOT NULL DEFAULT 0,
  addon_fees_json                 TEXT NOT NULL DEFAULT '[]',  -- JSON array [{label, cents}, ...]
  discount_cents                  INTEGER NOT NULL DEFAULT 0,
  discount_reason                 TEXT,
  tax_cents                       INTEGER NOT NULL DEFAULT 0,
  total_cents                     INTEGER NOT NULL DEFAULT 0,  -- denormalized sum; computed at write time

  -- Deposit tracking
  deposit_required_cents          INTEGER,                     -- NULL = no deposit required
  deposit_due_at                  INTEGER,
  deposit_received_at             INTEGER,
  deposit_method                  TEXT CHECK (deposit_method IS NULL OR deposit_method IN (
    'cash', 'check', 'venmo', 'ach', 'card_offplatform'
  )),
  deposit_reference               TEXT,
  deposit_received_by             TEXT REFERENCES users(id),

  -- Balance tracking
  balance_due_at                  INTEGER,
  balance_received_at             INTEGER,
  balance_method                  TEXT CHECK (balance_method IS NULL OR balance_method IN (
    'cash', 'check', 'venmo', 'ach', 'card_offplatform'
  )),
  balance_reference               TEXT,
  balance_received_by             TEXT REFERENCES users(id),

  -- COI tracking (+ B10 cron sentinels)
  coi_status                      TEXT NOT NULL DEFAULT 'not_required' CHECK (coi_status IN (
    'not_required', 'pending', 'received', 'expired'
  )),
  coi_expires_at                  INTEGER,
  coi_alert_60d_sent_at           INTEGER,                     -- B10 sentinel
  coi_alert_30d_sent_at           INTEGER,                     -- B10 sentinel
  coi_alert_7d_sent_at            INTEGER,                     -- B10 sentinel

  -- Operational details
  headcount_estimate              INTEGER,
  schedule_notes                  TEXT,
  equipment_notes                 TEXT,
  staffing_notes                  TEXT,
  special_permissions_json        TEXT NOT NULL DEFAULT '{}',  -- JSON {pyrotechnics, alcohol_service, ...}

  -- Requirements checklist (5 boolean flags)
  requirements_coi_received       INTEGER NOT NULL DEFAULT 0 CHECK (requirements_coi_received IN (0, 1)),
  requirements_agreement_signed   INTEGER NOT NULL DEFAULT 0 CHECK (requirements_agreement_signed IN (0, 1)),
  requirements_deposit_received   INTEGER NOT NULL DEFAULT 0 CHECK (requirements_deposit_received IN (0, 1)),
  requirements_briefing_scheduled INTEGER NOT NULL DEFAULT 0 CHECK (requirements_briefing_scheduled IN (0, 1)),
  requirements_walkthrough_completed INTEGER NOT NULL DEFAULT 0 CHECK (requirements_walkthrough_completed IN (0, 1)),

  -- Notes (PII-gated read)
  notes                           TEXT,                        -- gated by field_rentals.read.pii
  notes_sensitive                 TEXT,                        -- gated by field_rentals.notes.read_sensitive

  -- Assignment
  aas_site_coordinator_person_id  TEXT REFERENCES persons(id),

  -- Lifecycle
  archived_at                     INTEGER,
  cancelled_at                    INTEGER,
  cancellation_reason             TEXT,
  cancellation_deposit_retained   INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_deposit_retained IN (0, 1)),

  -- Audit
  created_by                      TEXT REFERENCES users(id),
  created_at                      INTEGER NOT NULL,
  updated_at                      INTEGER NOT NULL
);
CREATE INDEX idx_field_rentals_customer    ON field_rentals(customer_id);
CREATE INDEX idx_field_rentals_site        ON field_rentals(site_id);
CREATE INDEX idx_field_rentals_status      ON field_rentals(status);
CREATE INDEX idx_field_rentals_window      ON field_rentals(site_id, scheduled_starts_at, scheduled_ends_at);
CREATE INDEX idx_field_rentals_recurrence  ON field_rentals(recurrence_id, recurrence_instance_index);
CREATE INDEX idx_field_rentals_coi         ON field_rentals(coi_status, coi_expires_at);
CREATE INDEX idx_field_rentals_archived    ON field_rentals(archived_at);
CREATE INDEX idx_field_rentals_coordinator ON field_rentals(aas_site_coordinator_person_id);

-- ────────────────────────────────────────────────────────────────────
-- field_rental_contacts — per-rental snapshot of contacts
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE field_rental_contacts (
  id                TEXT PRIMARY KEY,
  rental_id         TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  role              TEXT NOT NULL CHECK (role IN ('billing', 'onsite_lead', 'signer', 'other')),
  is_primary        INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  notes             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_frc_rental ON field_rental_contacts(rental_id);
