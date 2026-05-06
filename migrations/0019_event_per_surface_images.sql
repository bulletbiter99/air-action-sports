-- Per-surface event cover images.
--
-- The single `cover_image_url` powers four surfaces with very different
-- effective aspect ratios (see HANDOFF §12 cover-image surface reference):
--   /events card        → ~2:1   (1200×600)
--   /events/:slug hero  → ~3.2:1 (1920×600)
--   /booking banner     → ~4:1   (1920×500)
--   OG meta image       → 1.91:1 (1200×630)
--
-- Crops are inevitable when one image serves all four. These four nullable
-- columns let admins upload a ratio-correct image per surface. Each surface
-- prefers its specific column and falls back to `cover_image_url` so existing
-- events keep working and admins aren't forced to upload all four.
--
-- Backfill: no-op. Existing `cover_image_url` keeps powering every surface
-- until an admin uploads a per-surface override.

ALTER TABLE events ADD COLUMN card_image_url TEXT;
ALTER TABLE events ADD COLUMN hero_image_url TEXT;
ALTER TABLE events ADD COLUMN banner_image_url TEXT;
ALTER TABLE events ADD COLUMN og_image_url TEXT;
