-- Seed initial event from src/data/events.js
-- Run with: wrangler d1 execute air-action-sports-db --remote --file=migrations/seed_events.sql

INSERT INTO events (
    id, title, date_iso, display_date, display_day, display_month,
    location, site, type, time_range, check_in, first_game, end_time,
    base_price_cents, total_slots,
    addons_json, game_modes_json,
    published, past, created_at, updated_at
) VALUES (
    'operation-nightfall',
    'Operation Nightfall',
    '2026-05-09T08:30:00',
    '9 May 2026',
    '9',
    'May 2026',
    'Ghost Town — Rural Neighborhood',
    'delta',
    'airsoft',
    '6:30 AM – 8:00 PM',
    '6:30 AM – 8:00 AM',
    '8:30 AM',
    '7:30 – 8:00 PM',
    8000,
    350,
    '[
      {"sku":"sword-rifle","name":"Sword Rifle Package","price_cents":3500,"description":"Airsoft battery-powered Sword rifle, 2 mags, 1,000 rounds, vest, and eye protection","max_per_order":null,"total_inventory":null},
      {"sku":"srs-sniper","name":"SRS Sniper Package","price_cents":2500,"description":"Bolt-action SRS sniper, 1 mag, 1,000 rounds, vest, and eye protection","max_per_order":null,"total_inventory":null},
      {"sku":"bbs-20g-10k","name":"20g BBs (10,000 count)","price_cents":3000,"description":"10,000 count 20g BBs","max_per_order":null,"total_inventory":null}
    ]',
    '["Team Deathmatch (TDM)","Red vs Blue","Capture the Flag","King of the Hill"]',
    1,
    0,
    unixepoch() * 1000,
    unixepoch() * 1000
);
