-- Public marketing content for the /locations page, moved off the static
-- src/data/locations.js into the sites table so admins can edit it — including
-- the uploaded photo and its focal-point position.
--
-- Resolves the /locations half of feedback fb_Su6LWtWJz2FI.
--
-- PRE-MIGRATION SPOT-CHECK (2026-06)
-- ============================================================
-- - sites table on remote (migration 0044) has 16 columns; NONE of the 9
--   new columns below exist (verified via pragma_table_info('sites')).
-- - 2 rows: Ghost Town (site_3ZQ2j67XEwDG, slug ghost-town) + Foxtrot
--   (site_kZaBw4C42mkq, slug foxtrot). A 3rd, marketing-only "Trench Warfare"
--   row is INSERTed by scripts/seed-location-content.sql.
--
-- DESIGN NOTES
-- ============================================================
-- - All columns nullable / safe-defaulted so existing rows are unaffected.
-- - show_on_locations gates public visibility (default 0 — a site only shows
--   on /locations once an operator opts it in via the seed or admin editor).
-- - photo_position is a CSS background-position string, same contract as the
--   event *_image_position columns (normalized server-side before render).
-- - features_json / game_types_json hold JSON arrays of strings.
-- - location_blurb is the short marketing tagline under the name (e.g.
--   "Rural Neighborhood — 19 Buildings"); distinct from the operational
--   street-address columns.
--
-- D1 quirks
-- ============================================================
-- - Additive only (ADD COLUMN). No table-rebuild → no FK-during-DROP.
-- - No BEGIN/COMMIT (D1 parser rejects them). No email_templates seed.

ALTER TABLE sites ADD COLUMN photo_url TEXT;
ALTER TABLE sites ADD COLUMN photo_position TEXT;
ALTER TABLE sites ADD COLUMN badge TEXT;
ALTER TABLE sites ADD COLUMN site_number TEXT;
ALTER TABLE sites ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN features_json TEXT;
ALTER TABLE sites ADD COLUMN game_types_json TEXT;
ALTER TABLE sites ADD COLUMN location_blurb TEXT;
ALTER TABLE sites ADD COLUMN show_on_locations INTEGER NOT NULL DEFAULT 0;
