-- Volga Flank (id 'volga-initiative') — hero photo refresh, 2026-06-02.
--
-- The previous hero (events/volga-hero-3dfe99d37edd.jpg) is served with an
-- immutable, 1-year Cache-Control (serveUpload in worker/index.js), so a
-- same-key overwrite would NOT reach already-visited browsers or the CDN edge.
-- Per the content-addressed pattern, the replacement photo was uploaded under a
-- fresh content-hashed key and hero_image_url is repointed at it:
--   new key = events/volga-hero-be1eee1d2f74.jpg   (sha256[:12] of the new file)
--   verified serving 200 image/jpeg at the public /uploads URL (ETag == local MD5).
--
-- card_image_url / og_image_url / details_json.collabBannerUrl are UNCHANGED
-- (those use the separate volga-card / volga-logos keys). The old hero object is
-- left in R2 (orphaned, harmless) and may be deleted later if desired.

UPDATE events
SET
  hero_image_url = 'https://airactionsport.com/uploads/events/volga-hero-be1eee1d2f74.jpg',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'volga-initiative';
