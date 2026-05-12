-- M5.5 Batch 1 — Sites schema (Migration A)
--
-- Foundation for the field-rentals build. Creates the operating-location
-- directory (sites + site_fields) plus operator-configured downtime
-- (site_blackouts). Future M5.5 batches build on these:
--   - B2 adds events.site_id and seeds Ghost Town + Foxtrot Fields
--   - B3 adds customers.client_type + business_* fields
--   - B4-B5 add field_rentals + related tables
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-11; per Lesson #7)
-- ============================================================
-- Verified against production air-action-sports-db before authoring.
--
-- 1. events table — already has BOTH `location TEXT` AND `site TEXT`
--    free-text columns (the latter is undocumented in Surface 7).
--    B2's backfill script must consider both string columns when
--    matching events to a sites.slug. Production schema is 28 cols
--    (the M5 prompt's Surface 7 §4 only mentions `location`;
--    `site` was added incrementally pre-Phase-1-audit and never
--    documented). No additional NOT NULL columns to worry about
--    that aren't already covered by the seeded ones.
--
-- 2. users table — id TEXT PRIMARY KEY confirmed; role enum is
--    ('owner','manager','staff') — fine for the FK target on
--    site_blackouts.created_by. Has persona + role_preset_key
--    columns from M4/M5 (informational; not relevant here).
--
-- 3. Last migration applied to remote: 0043_charge_templates.sql.
--    None of the three new tables (sites, site_fields,
--    site_blackouts) currently exist on remote — clear to create.
--
-- DESIGN NOTES (M5.5 prompt vs Surface 7 docs)
-- ============================================================
-- The M5.5 prompt's schema is the operational source of truth and
-- diverges from Surface 7's draft schema in three ways:
--
-- 1. Pricing is per-rental, not per-site. Surface 7 had
--    default_pricing_model + default_per_hour_cents + default_per_day_cents
--    on sites. The prompt punts pricing to field_rentals.site_fee_cents
--    (added in B4) so each rental can set its own rate without a
--    per-site default. sites stores operational buffers
--    (default_arrival_buffer_minutes / default_cleanup_buffer_minutes)
--    instead.
--
-- 2. No timezone column. events.date_iso is naive (no tz suffix)
--    and the operator works in a single tz (America/Denver). If
--    multi-tz operations become a need, a future migration can
--    add it.
--
-- 3. site_blackouts is site-scoped, not field-scoped. Surface 7
--    had site_blackouts.field_id (per-field downtime). The
--    prompt's design uses site_id (whole-site downtime — matches
--    the operational reality of a maintenance closure affecting
--    all fields at a site). If per-field downtime becomes
--    necessary, a future migration can add a nullable field_id.
--
-- default_blackout_window is TEXT for free-form policy strings
-- like "no operations 22:00-07:00 local". A stronger typed shape
-- (JSON spec, cron-style schedule) can be retrofitted if
-- operational data favors it. The operator manually composes
-- per-occurrence site_blackouts rows for known downtime; the
-- default_blackout_window column is informational guidance only.
--
-- ID PREFIXES (assigned at insert time in B2's seed-sites.js)
-- ============================================================
--   sites.id           : site_<random12>
--   site_fields.id     : fld_<random12>
--   site_blackouts.id  : blk_<random12>
--
-- worker/lib/ids.js gets a siteId() helper in B2; this migration
-- is schema-only and assigns no rows.
--
-- D1 quirks observed
-- ============================================================
-- - Additive only: CREATE TABLE + CREATE INDEX. No table-rebuild,
--   so the FK-during-DROP gotcha (D1 quirk #2) is not triggered.
-- - No BEGIN/COMMIT statements (D1 quirk #1).
-- - No email_templates seed in this migration, so Lesson #7
--   (id + created_at requirement) does not apply.

CREATE TABLE sites (
  id                                TEXT PRIMARY KEY,
  slug                              TEXT NOT NULL UNIQUE,
  name                              TEXT NOT NULL,
  address                           TEXT,
  city                              TEXT,
  state                             TEXT,
  postal_code                       TEXT,
  total_acreage                     REAL,
  notes                             TEXT,
  active                            INTEGER NOT NULL DEFAULT 1,
  archived_at                       INTEGER,
  default_arrival_buffer_minutes    INTEGER NOT NULL DEFAULT 30,
  default_cleanup_buffer_minutes    INTEGER NOT NULL DEFAULT 30,
  default_blackout_window           TEXT,
  created_at                        INTEGER NOT NULL,
  updated_at                        INTEGER NOT NULL
);
CREATE INDEX idx_sites_active ON sites(active);

CREATE TABLE site_fields (
  id                                TEXT PRIMARY KEY,
  site_id                           TEXT NOT NULL REFERENCES sites(id),
  slug                              TEXT NOT NULL,
  name                              TEXT NOT NULL,
  approximate_acreage               REAL,
  notes                             TEXT,
  active                            INTEGER NOT NULL DEFAULT 1,
  archived_at                       INTEGER,
  created_at                        INTEGER NOT NULL,
  UNIQUE (site_id, slug)
);
CREATE INDEX idx_site_fields_site ON site_fields(site_id);
CREATE INDEX idx_site_fields_active ON site_fields(active);

CREATE TABLE site_blackouts (
  id                                TEXT PRIMARY KEY,
  site_id                           TEXT NOT NULL REFERENCES sites(id),
  starts_at                         INTEGER NOT NULL,
  ends_at                           INTEGER NOT NULL,
  reason                            TEXT,
  created_by                        TEXT REFERENCES users(id),
  created_at                        INTEGER NOT NULL
);
CREATE INDEX idx_site_blackouts_window ON site_blackouts(site_id, starts_at, ends_at);
