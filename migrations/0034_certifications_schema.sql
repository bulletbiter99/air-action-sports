-- M5 Batch 7 — Certifications schema (Surface 4b).
--
-- Adds two tables for tracking per-person certifications + which roles
-- require which certifications. Cert expiration alerts ship in Batch 8
-- via a new cron sweep at 60d/30d/7d windows.
--
-- D1 quirks honored: no BEGIN/COMMIT keywords, no literal "control-keyword"
-- usage; additive only, no rebuilds.

-- ─────────────────────────────────────────────────────────────────
-- 1. certifications — per-person credential records
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE certifications (
  id              TEXT PRIMARY KEY,                    -- cert_<random12>
  person_id       TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,                       -- 'cpr' / 'first_aid' / 'emt_basic' / 'state_ref' / 'sora_marshal' / etc.
  display_name    TEXT NOT NULL,                       -- "CPR/AED — American Heart Association"
  certificate_number TEXT,                             -- card number / cert number from issuing authority
  issuing_authority TEXT,                              -- "American Heart Association", "AAS Internal", etc.
  issued_at       INTEGER,                             -- ms when first granted
  expires_at      INTEGER,                             -- ms; NULL = never expires
  document_id     TEXT REFERENCES person_documents(id), -- optional scan/photo of the cert
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  -- Lifecycle
  added_by_user_id TEXT REFERENCES users(id),
  added_at        INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  -- Renewal tracking — when cert is renewed, this points to the previous
  -- certifications row (lineage); the previous row's status flips to 'expired'.
  previous_cert_id TEXT REFERENCES certifications(id)
);
CREATE INDEX idx_certifications_person ON certifications(person_id);
CREATE INDEX idx_certifications_kind ON certifications(kind);
CREATE INDEX idx_certifications_expires ON certifications(expires_at);
CREATE INDEX idx_certifications_status ON certifications(status);

-- ─────────────────────────────────────────────────────────────────
-- 2. role_required_certifications — which roles need which certs
-- ─────────────────────────────────────────────────────────────────
-- Drives the "missing required cert" badge on the Issues tab + the cron
-- alert at 60d/30d/7d-to-expiry. Editable via a future admin UI in B8.
CREATE TABLE role_required_certifications (
  id              TEXT PRIMARY KEY,                    -- rrc_<random12>
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  cert_kind       TEXT NOT NULL,                       -- matches certifications.kind
  required        INTEGER NOT NULL DEFAULT 1,          -- 1=hard requirement; 0=recommended
  created_at      INTEGER NOT NULL,
  UNIQUE(role_id, cert_kind)
);
CREATE INDEX idx_rrc_role ON role_required_certifications(role_id);
CREATE INDEX idx_rrc_kind ON role_required_certifications(cert_kind);

-- ─────────────────────────────────────────────────────────────────
-- 3. Seed default required-cert mappings per docs/staff-job-descriptions.md
-- ─────────────────────────────────────────────────────────────────
-- Tier 3 field roles need basic safety certs. Lead Marshal additionally
-- needs the AAS internal marshaling cert. EMT role needs medical certs.
-- These can be edited at runtime via the future B8 admin UI.

INSERT INTO role_required_certifications (id, role_id, cert_kind, required, created_at) VALUES
  -- Lead Marshal: CPR + First Aid + AAS Marshaling
  ('rrc_lm_cpr',          'role_lead_marshal',     'cpr',           1, strftime('%s','now') * 1000),
  ('rrc_lm_first_aid',    'role_lead_marshal',     'first_aid',     1, strftime('%s','now') * 1000),
  ('rrc_lm_aas_marshal',  'role_lead_marshal',     'aas_marshal',   1, strftime('%s','now') * 1000),
  -- Field Marshal: AAS Marshaling cert
  ('rrc_fm_aas_marshal',  'role_field_marshal',    'aas_marshal',   1, strftime('%s','now') * 1000),
  -- Safety Officer / Chrono: AAS Marshaling
  ('rrc_so_aas_marshal',  'role_safety_officer',   'aas_marshal',   1, strftime('%s','now') * 1000),
  -- Event EMT: EMT-Basic + CPR + First Aid (CPR/FA implied by EMT but list explicitly)
  ('rrc_emt_emt_basic',   'role_event_emt',        'emt_basic',     1, strftime('%s','now') * 1000),
  ('rrc_emt_cpr',         'role_event_emt',        'cpr',           1, strftime('%s','now') * 1000),
  ('rrc_emt_first_aid',   'role_event_emt',        'first_aid',     1, strftime('%s','now') * 1000),
  -- Check-in Staff: First Aid (recommended, not hard requirement)
  ('rrc_ci_first_aid',    'role_check_in_staff',   'first_aid',     0, strftime('%s','now') * 1000);
