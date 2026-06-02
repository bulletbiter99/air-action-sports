-- Volga Initiative images. All three uploaded to R2 (bucket air-action-sports-uploads,
-- keys events/volga-*) and verified serving 200 image/jpeg:
--   hero  = night group photo  -> hero_image_url (event-detail hero banner)
--   card  = tablet/recon photo -> card_image_url (events grid) + og_image_url (social)
--   logos = MILSIM CITY / Air Action Sport / RSTS banner -> details_json.collabBannerUrl
--           (added via json_set so the existing details payload is preserved).

UPDATE events
SET
  hero_image_url = 'https://airactionsport.com/uploads/events/volga-hero-3dfe99d37edd.jpg',
  card_image_url = 'https://airactionsport.com/uploads/events/volga-card-2ac49b172fcf.jpg',
  og_image_url = 'https://airactionsport.com/uploads/events/volga-card-2ac49b172fcf.jpg',
  details_json = json_set(details_json, '$.collabBannerUrl', 'https://airactionsport.com/uploads/events/volga-logos-b6f50908e644.jpg'),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'volga-initiative';
