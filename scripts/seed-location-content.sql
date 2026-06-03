-- Seed the 3 /locations entries into the sites table (run AFTER migration 0072).
-- Ghost Town + Foxtrot already exist → UPDATE. Trench Warfare is new → INSERT
-- (marketing-only, coming-soon; no operational field-rental use).
--
-- features_json mirrors the static src/data/locations.js `fullFeatures` exactly
-- (what /locations renders today) so the data-driven page is byte-identical
-- after B4 rewires it — keeping the public visual-regression baseline green.
-- photo_position is NULL (center) on seed; an operator (or a later step) sets a
-- focal point to fix the Ghost Town crop the feedback complained about.

-- Ghost Town (open, site 01)
UPDATE sites SET
  photo_url = '/images/ghost-town.jpg',
  photo_position = NULL,
  badge = 'open',
  site_number = '01',
  sort_order = 1,
  location_blurb = 'Rural Neighborhood — 19 Buildings',
  features_json = '["Bunkers & fortified objectives","Multiple airsoft game modes"]',
  game_types_json = '["Milsim","Skirmish","Private Hire","Night Ops"]',
  show_on_locations = 1,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'site_3ZQ2j67XEwDG';

-- Foxtrot (coming soon, site 03) — static "Foxtrot Fields"
UPDATE sites SET
  photo_url = '/images/foxtrot-fields.jpeg',
  photo_position = NULL,
  badge = 'coming-soon',
  site_number = '03',
  sort_order = 3,
  location_blurb = 'Open Field Site — 25 acres',
  features_json = '["Open terrain skirmish zones","Milsim-ready staging areas","Large-scale team battles","Vehicle access routes planned","On-site catering planned","Spectator viewing area"]',
  game_types_json = '["Large-scale Skirmish","Milsim","Private Hire"]',
  show_on_locations = 1,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'site_kZaBw4C42mkq';

-- Trench Warfare (coming soon, site 02) — marketing-only, not an operational site
INSERT INTO sites (
  id, slug, name, active, sort_order, show_on_locations,
  photo_url, photo_position, badge, site_number, location_blurb,
  features_json, game_types_json,
  default_arrival_buffer_minutes, default_cleanup_buffer_minutes,
  created_at, updated_at
) VALUES (
  'site_trenchwarfare01', 'trench-warfare', 'Trench Warfare', 1, 2, 1,
  '/images/trench-warfare.jpg', NULL, 'coming-soon', '02', 'CQB Site — Echo Urban Warehouse',
  '["Indoor close-quarters layout","Multi-floor action zones","Low-light scenario capability","Climate-controlled environment","Sound system for immersive ops","Locker room facilities"]',
  '["CQB Skirmish","Milsim","Private Hire","Corporate Events"]',
  30, 30,
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
);
