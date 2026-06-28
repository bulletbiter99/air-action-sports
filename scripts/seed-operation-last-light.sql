-- Build out the draft event `ghost-town-iii-regular-play` into OPERATION LAST
-- LIGHT, a single-day, 12-hour mission-based event at Ghost Town (Hiawatha, UT)
-- on 25 July 2026. Content supplied by the operator (no emojis per request).
--
-- This is the event the operator's "first day schedule" info was actually for --
-- NOT the separate `ghost-town-18hr-milsim` 2-day op (left untouched).
--
-- Stays a DRAFT (published unchanged at 0). The operator reviews in /admin/events
-- and flips published=1 to make it live.
--
-- Decisions / assumptions baked in (operator can adjust any in /admin/events):
--   * Title -> "Operation Last Light"; slug -> "operation-last-light" (event id
--     `ghost-town-iii-regular-play` unchanged; 0 bookings, draft -> safe rename).
--   * Entry fee -> $60 (operator-confirmed): base_price_cents + the lone ticket.
--   * Check-in 8:00 AM, briefing/game on 9:00 AM (operator-given).
--   * END TIME = 9:00 PM is an ASSUMPTION: "12 hour mission based event" + 9:00 AM
--     game-on. Confirm/adjust the End Time if the real ENDEX differs.
--   * site_id LEFT NULL on purpose: setting it to the Ghost Town site would raise
--     a same-day conflict with `ghost-town-18hr-milsim` (also 7/25 at that site).
--   * Team/faction picker NOT added (operator: skip for now) -> custom_questions_json
--     stays NULL; teams (Russian/NATO/civilians) are assigned on-site.
--   * Standard safety/age/eyepro/waiver lines are included in `rules` because
--     overriding `rules` replaces the page's DEFAULT_RULES; without them the page
--     would otherwise drop eyepro/age/waiver from the list.
--
-- details_json matches normalizeEventDetails() output exactly (only non-empty
-- keys) so a later admin "Detail page content" save round-trips as a no-op.
-- Single-line JSON, double-quoted, inside single-quoted SQL; content avoids
-- apostrophes so no quote-escaping is needed.

UPDATE events
SET
  title = 'Operation Last Light',
  slug = 'operation-last-light',
  location = 'Ghost Town - Hiawatha, UT',
  check_in = '8:00 AM',
  first_game = '9:00 AM',
  time_range = '8:00 AM - 9:00 PM',
  end_time = '9:00 PM',
  base_price_cents = 6000,
  short_description = 'A 12-hour, mission-based MILSIM operation at Ghost Town in Hiawatha, Utah: recon patrols, supply convoy escorts, and hostage rescue.',
  game_modes_json = '["Recon Patrols","Supply Convoy Escorts","Hostage Rescue"]',
  details_json = '{"missionBriefing":["Operation Last Light is a 12-hour, mission-based event at Ghost Town in Hiawatha, Utah. Two forces contest the field across a full day of objective play, with a civilian element caught in the middle.","The operation runs on three mission types: recon patrols to find and fix the enemy, supply convoy escorts moving two convoy trucks across contested ground, and hostage rescue operations into enemy-held terrain.","Teams: Russian forces wear green and NATO forces wear tan; civilians are split evenly and marked with colored tape on the field. Every faction is organized into Alpha, Bravo, and Charlie squads, so come ready to move and fight as part of a fireteam.","Book your tickets through airactionsport.com. If you cannot book online, cash will be accepted at the gate. Free cases of water will be on-site, but you are strongly advised to bring water in a form you can carry on the battlefield."],"rules":["350 FPS and under: no minimum engagement distance; semi and full-auto allowed past 25 ft","351 to 449 FPS: 50 ft minimum engagement distance, semi-only","450 to 550 FPS: 100 ft minimum engagement distance, semi-only","LMGs may use full-auto over 350 FPS but still require a 50 ft minimum engagement distance","All FPS readings are taken with a .20g BB; HPA and heavier-gram BBs are measured by joules","Follow the Rules of Engagement at all times","Keep proper trigger discipline","Pack out all trash and leave the site cleaner than you found it","ANSI Z87.1+ full-seal eye protection mandatory at all times; full-face protection required for under-18 players","Minimum age 12 (12 to 17 with a parent or guardian on-site)","Call your own hits honestly; marshals are the final authority","Completed waiver required (emailed after booking)"],"schedule":[{"time":"8:00 AM","label":"Arrival, check-in, and team assignment"},{"time":"9:00 AM","label":"Safety briefing and game on"},{"time":"9:00 PM","label":"ENDEX, end of the 12-hour mission window"}],"scheduleNote":"A 12-hour, mission-based event. Times are approximate and subject to command intent.","firstGameLabel":"Mission Ops","fpsLabel":"350 / 450 / 550 by class"}',
  updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-iii-regular-play';

-- The single ticket -> $60 entry (operator-confirmed). Name + capacity kept.
UPDATE ticket_types
SET price_cents = 6000, updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_NzvgjgKN8Kdc';
