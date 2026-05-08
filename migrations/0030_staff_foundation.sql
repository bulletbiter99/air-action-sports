-- M5 Batch 1 — Staff schema foundation per Surface 4a design.
--
-- Additive only. No existing column renamed. All tables new.
--
-- Sequencing within this migration: D1 wraps each statement implicitly;
-- explicit BEGIN/COMMIT keywords are not allowed (wrangler parser rejects
-- the literal keyword everywhere — see CLAUDE.md M3 D1-quirk subsection).
-- Statement-level isolation is what we get; the FK ordering below ensures
-- referenced tables exist before referring tables.
--
-- Order:
--   1. roles (depends only on nothing)
--   2. persons (FK -> users)
--   3. person_roles (FK -> persons + roles)
--   4. person_tags (FK -> persons)
--   5. staff_documents (FK -> roles + users)
--   6. staff_document_roles (FK -> staff_documents + roles)
--   7. staff_document_acknowledgments (FK -> persons + staff_documents)
--   8. person_documents (FK -> persons + users)
--   9. portal_sessions (FK -> persons + users)
--
-- Code that depends on these tables ships in M5 Batches 2-6 (capabilities lib,
-- persons backfill, staff directory, library + JD import, portal foundation).

-- ─────────────────────────────────────────────────────────────────
-- 1. roles
-- ─────────────────────────────────────────────────────────────────
-- Catalog of position roles independent of people. NOT users.role
-- (the existing 3-tier auth role hierarchy stays). These are job titles
-- people hold — Event Director, Lead Marshal, Field Marshal, Equipment
-- Manager, Bookkeeper, Marketing Manager, Compliance Reviewer, etc.
-- See docs/staff-job-descriptions.md for the 22-role inventory.
CREATE TABLE roles (
  id              TEXT PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  tier            INTEGER NOT NULL CHECK (tier IN (1, 2, 3, 4)),
  department      TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  archived_at     INTEGER,
  archived_reason TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_roles_key ON roles(key);
CREATE INDEX idx_roles_tier ON roles(tier);
CREATE INDEX idx_roles_active ON roles(active);

-- ─────────────────────────────────────────────────────────────────
-- 2. persons
-- ─────────────────────────────────────────────────────────────────
-- Canonical record for every human in the org chart. user_id is NULL
-- for Tier 4 (occasional / no login). M5 Batch 3 backfills one persons
-- row per existing users row.
--
-- mailing_address_ciphertext is at-rest encrypted (per Surface 4a).
-- Encryption helper ships in M5 Batch 4 (worker/lib/personEncryption.js).
-- Until then, the column accepts cleartext from migrations / SQL
-- INSERTs but admin-side writes path through the helper. PII gating on
-- read uses staff.read.pii capability.
CREATE TABLE persons (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id),
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  preferred_name  TEXT,
  pronouns        TEXT,
  mailing_address_ciphertext TEXT,
  compensation_kind TEXT CHECK (compensation_kind IN ('w2_salary','w2_hourly','1099_per_event','1099_hourly','volunteer','none')),
  compensation_rate_cents INTEGER,
  notes           TEXT,
  notes_sensitive TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','onboarding','on_leave','offboarding','inactive')),
  archived_at     INTEGER,
  archived_reason TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  hired_at        INTEGER,
  separated_at    INTEGER
);
CREATE INDEX idx_persons_user ON persons(user_id);
CREATE INDEX idx_persons_status ON persons(status);
CREATE INDEX idx_persons_email ON persons(email);
CREATE INDEX idx_persons_full_name ON persons(full_name);

-- ─────────────────────────────────────────────────────────────────
-- 3. person_roles
-- ─────────────────────────────────────────────────────────────────
-- Many-to-many person-to-role with history. effective_to NULL = current.
-- The "primary role" rule (exactly one is_primary=1 per person) is
-- enforced in the route layer, not by SQL constraint (SQLite partial
-- unique indexes work but get awkward with NULL effective_to).
CREATE TABLE person_roles (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role_id         TEXT NOT NULL REFERENCES roles(id),
  is_primary      INTEGER NOT NULL DEFAULT 0,
  effective_from  INTEGER NOT NULL,
  effective_to    INTEGER,
  notes           TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_person_roles_person ON person_roles(person_id);
CREATE INDEX idx_person_roles_role ON person_roles(role_id);
CREATE INDEX idx_person_roles_current ON person_roles(person_id, effective_to);

-- ─────────────────────────────────────────────────────────────────
-- 4. person_tags
-- ─────────────────────────────────────────────────────────────────
-- Per-person tag set — both system-derived (e.g. cpr_cert when a
-- certification record exists in M5 B7) and admin-manual.
CREATE TABLE person_tags (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('system','manual')),
  created_at      INTEGER NOT NULL,
  UNIQUE(person_id, tag, source)
);
CREATE INDEX idx_person_tags_person ON person_tags(person_id);
CREATE INDEX idx_person_tags_tag ON person_tags(tag);

-- ─────────────────────────────────────────────────────────────────
-- 5. staff_documents
-- ─────────────────────────────────────────────────────────────────
-- Versioned JD/SOP/Checklist/Policy/Training documents. New version
-- retires previous (mirrors waiver_documents pattern from migration
-- 0011). Past acks stay pinned to whatever version was acknowledged.
--
-- M5 B5 imports docs/staff-job-descriptions.md into 22 v1.0 rows
-- with kind='jd', one per role section in that doc.
CREATE TABLE staff_documents (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('jd','sop','checklist','policy','training')),
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  body_sha256     TEXT NOT NULL,
  version         TEXT NOT NULL,
  primary_role_id TEXT REFERENCES roles(id),
  description     TEXT,
  retired_at      INTEGER,
  retired_by_user_id TEXT REFERENCES users(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  UNIQUE(slug, version)
);
CREATE INDEX idx_staff_documents_kind_live ON staff_documents(kind, retired_at);
CREATE INDEX idx_staff_documents_role ON staff_documents(primary_role_id);
CREATE INDEX idx_staff_documents_slug ON staff_documents(slug);

-- ─────────────────────────────────────────────────────────────────
-- 6. staff_document_roles
-- ─────────────────────────────────────────────────────────────────
-- Many-to-many doc-to-role tagging. A Safety SOP can apply to multiple
-- roles (Lead Marshal, Field Marshal, Check-in Staff). required=1 means
-- the role must acknowledge the doc before working an event (M5 B6
-- portal flow surfaces required-doc gates).
CREATE TABLE staff_document_roles (
  id              TEXT PRIMARY KEY,
  staff_document_id TEXT NOT NULL REFERENCES staff_documents(id) ON DELETE CASCADE,
  role_id         TEXT NOT NULL REFERENCES roles(id),
  required        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  UNIQUE(staff_document_id, role_id)
);
CREATE INDEX idx_sdr_doc ON staff_document_roles(staff_document_id);
CREATE INDEX idx_sdr_role ON staff_document_roles(role_id);

-- ─────────────────────────────────────────────────────────────────
-- 7. staff_document_acknowledgments
-- ─────────────────────────────────────────────────────────────────
-- Per-person policy ack records. Snapshot version + body_sha256 at ack
-- time so even if the doc is later retired/replaced, the ack record
-- preserves which version was acknowledged.
CREATE TABLE staff_document_acknowledgments (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  staff_document_id TEXT NOT NULL REFERENCES staff_documents(id),
  document_version TEXT NOT NULL,
  body_sha256_snapshot TEXT NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  source          TEXT NOT NULL CHECK (source IN ('admin_assigned','portal_self_serve')),
  UNIQUE(person_id, staff_document_id, document_version)
);
CREATE INDEX idx_sda_person ON staff_document_acknowledgments(person_id);
CREATE INDEX idx_sda_doc ON staff_document_acknowledgments(staff_document_id);

-- ─────────────────────────────────────────────────────────────────
-- 8. person_documents
-- ─────────────────────────────────────────────────────────────────
-- Per-person files: W-9, signed contract, ID copies, direct-deposit
-- forms, etc. R2 keys under persons/<random>.<ext>; magic-byte sniff
-- on upload (worker/lib/magicBytes.js, same as vendor docs).
-- retired_at non-null when superseded by a newer doc of same kind.
CREATE TABLE person_documents (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('w9','contract','id','direct_deposit','tax_form','other')),
  file_name       TEXT NOT NULL,
  r2_key          TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  bytes           INTEGER NOT NULL,
  uploaded_by_user_id TEXT REFERENCES users(id),
  uploaded_at     INTEGER NOT NULL,
  notes           TEXT,
  retired_at      INTEGER
);
CREATE INDEX idx_person_documents_person ON person_documents(person_id);
CREATE INDEX idx_person_documents_kind ON person_documents(kind);

-- ─────────────────────────────────────────────────────────────────
-- 9. portal_sessions
-- ─────────────────────────────────────────────────────────────────
-- Magic-link sessions for Tier 3 light-access portal users. Workflow:
--   1. Admin clicks "Invite to portal" on a persons row → POST mints
--      a row with token_hash + expires_at. The cleartext token is sent
--      via email; the row stores only the SHA-256 hash.
--   2. Person clicks link → GET /portal/auth/consume?token=... sets
--      consumed_at + cookie_session_id + cookie_expires_at + IP/UA.
--   3. From here, the person uses cookie-based sessions for ~30 days.
--      Bumping token_version revokes outstanding cookies (single
--      mechanism for instant revoke; mirrors vendor portal pattern).
--
-- Strict separation from /admin/* enforced in route layer:
-- worker/routes/admin/* refuses portal-session cookies (M5 B6).
CREATE TABLE portal_sessions (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  token_version   INTEGER NOT NULL DEFAULT 1,
  consumed_at     INTEGER,
  expires_at      INTEGER NOT NULL,
  cookie_session_id TEXT,
  cookie_expires_at INTEGER,
  ip_address      TEXT,
  user_agent      TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  revoked_reason  TEXT
);
CREATE INDEX idx_portal_sessions_person ON portal_sessions(person_id);
CREATE INDEX idx_portal_sessions_token ON portal_sessions(token_hash);
CREATE INDEX idx_portal_sessions_active ON portal_sessions(person_id, expires_at, consumed_at);
