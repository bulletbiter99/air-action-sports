-- Per-event overlay-opacity controls — one nullable REAL per image slot
-- that renders an overlay on the public site.
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-13)
-- ============================================================
-- - events table on remote has the M5.5 B2 site_id column + the
--   M4-era *_image_url columns (cover/card/hero/banner/og).
-- - None of the 3 new columns exist (verified by reading the
--   formatEvent / parseEventBody surface — neither references them).
-- - Existing rows: 1 (operation-nightfall). All 3 columns default
--   NULL on insert; existing row gets NULL automatically.
--
-- DESIGN NOTES
-- ============================================================
-- - REAL nullable. NULL means "use the page's hardcoded default":
--     hero  → 0.78 (Home page flat overlay)
--             0.70 (EventDetail page gradient peak)
--     card  → 0.65 (Events listing card gradient peak)
--     banner→ 0.80 (Booking page banner gradient peak)
-- - No CHECK constraint — clamping to 0-1 happens at parseEventBody
--   in worker/routes/admin/events.js. Saves a schema-touch later
--   if the range ever needs widening (e.g. >1.0 for "extra dark").
-- - The Cover and OG image slots intentionally get no opacity field.
--   Cover is the universal fallback image, not a display context.
--   OG is social meta only — no on-site overlay renders.
-- - The hero slot's opacity drives BOTH Home + EventDetail pages
--   (one upload area, two display contexts; consumer pages scale
--   top/bottom gradient ends proportionally where the existing
--   overlay is a gradient).
--
-- D1 quirks observed
-- ============================================================
-- - Additive only (ADD COLUMN × 3). No table-rebuild → no D1
--   FK-during-DROP issue.
-- - No BEGIN/COMMIT (D1 parser rejects them anyway).
-- - No email_templates seed; Lesson #7 not applicable.

ALTER TABLE events ADD COLUMN card_overlay_opacity REAL;
ALTER TABLE events ADD COLUMN hero_overlay_opacity REAL;
ALTER TABLE events ADD COLUMN banner_overlay_opacity REAL;
