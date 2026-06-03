-- Per-event image focal-point (background-position) controls — one nullable
-- TEXT per cover-cropped image slot, so admins can position an off-center
-- image for best visibility instead of the hardcoded `center` crop.
--
-- Resolves feedback fb_Su6LWtWJz2FI ("position the images... for best
-- visibility"). Mirrors the 0055 overlay-opacity pattern exactly.
--
-- PRE-MIGRATION SPOT-CHECK (2026-06)
-- ============================================================
-- - events table on remote has the *_image_url columns (cover/card/hero/
--   banner/og) + the 0055 *_overlay_opacity columns.
-- - None of the 3 new *_image_position columns exist yet (formatEvent /
--   parseEventBody don't reference them).
-- - All 3 columns default NULL on insert; existing rows get NULL → the
--   public render falls back to `center` (byte-identical to today).
--
-- DESIGN NOTES
-- ============================================================
-- - TEXT nullable. Value is a CSS `background-position` string, e.g.
--   "50% 30%" or "center". NULL / empty → page default `center`.
-- - Only the 3 cover-cropped slots get a position (card, hero, banner) —
--   matching the 0055 overlay-opacity set. Cover is the universal fallback
--   (not a display context); OG is social-only (no in-page crop).
-- - No CHECK constraint — normalization to a safe "x% y%"/keyword form
--   happens at parseEventBody in worker/routes/admin/events.js, same
--   posture as the 0055 opacity clamp. Saves a schema-touch later.
--
-- D1 quirks
-- ============================================================
-- - Additive only (ADD COLUMN × 3). No table-rebuild → no FK-during-DROP.
-- - No BEGIN/COMMIT (D1 parser rejects them). No email_templates seed.

ALTER TABLE events ADD COLUMN card_image_position TEXT;
ALTER TABLE events ADD COLUMN hero_image_position TEXT;
ALTER TABLE events ADD COLUMN banner_image_position TEXT;
