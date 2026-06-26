-- Build out the draft event `ghost-town-18hr-milsim` into the 2-day "King Coal"
-- MILSIM operation at Ghost Town (Hiawatha, UT), 25-26 July 2026.
--
-- TITLE is intentionally KEPT ("Ghost Town: 18HR MILSIM"); every other field is
-- set per the operator (dates 25-26 July, 150/day capacity) + the planning
-- research packet (Concept A "King Coal": GRG PMC vs the Cinderjacks militia).
--
-- Seeded as a DRAFT: published stays 0. The operator reviews in /admin/events
-- and flips published=1 to make it live.
--
-- PRICES ARE PLACEHOLDERS pending the pricing discussion (Day 1 $45 / Day 2 $85
-- / Full Weekend $110). Capacity = 150 per PHYSICAL day via independent pools:
-- Full Weekend 100 + Day-1-only 50 = 150 on Day 1; Full Weekend 100 + Day-2-only
-- 50 = 150 on Day 2 (the operator-chosen independent-caps model).
--
-- D1 quirks: no BEGIN/COMMIT; the JSON columns are single-line JSON (double-
-- quoted) inside single-quoted SQL strings; content avoids apostrophes so no
-- quote-escaping is needed.

UPDATE events
SET
  date_iso = '2026-07-25T09:00:00',
  end_date_iso = '2026-07-26T20:00:00',
  display_date = '25-26 July 2026',
  display_day = '25',
  display_month = 'July 2026',
  location = 'Ghost Town - Hiawatha, UT',
  total_slots = 150,
  base_price_cents = 4500,
  time_range = 'Sat 9:00 AM - Sun (overnight op)',
  check_in = '9:00 AM',
  first_game = '10:30 AM',
  end_time = '6:00 PM',
  site_id = 'site_3ZQ2j67XEwDG',
  details_json = '{"missionBriefing":["The King Coal complex at Hiawatha has sat dark for decades. A multinational private military contractor, the Gentry Resource Group (GRG), has been hired to secure and reactivate the strategic coal and rare-earth works before the seam can be claimed by anyone else.","The interior will not go quietly. The Miller Creek Free Company, the Cinderjacks, claim the canyons and the seam beneath them and intend to deny GRG the prize. Two forces, two canyons, one contested town.","Day 1 is your shakedown: skills lanes, gear checks, and squad-cohesion games to get you and your kit ready. Day 2 is the main event, an 18-hour continuous force-on-force operation through the night to the dawn push. Bring your A-game and your sustainment."],"schedule":[{"day":1,"time":"9:00 AM","label":"Check-in, chrono, and gear inspection"},{"day":1,"time":"10:30 AM","label":"Skills lanes: chrono and zero, bounding, medic and radio drills"},{"day":1,"time":"12:30 PM","label":"Ammo-limited domination (fire-discipline warm-up)"},{"day":1,"time":"2:30 PM","label":"VIP escort and extraction"},{"day":1,"time":"4:00 PM","label":"Attack and defend on the town"},{"day":1,"time":"6:00 PM","label":"Day 1 ENDEX, AAR, and faction briefings"},{"day":2,"time":"9:00 AM","label":"Check-in, chrono, medical-card and tourniquet issue"},{"day":2,"time":"1:00 PM","label":"Faction formation and OPORD"},{"day":2,"time":"2:30 PM","label":"STARTEX: Phase 1 daylight objectives"},{"day":2,"time":"8:30 PM","label":"Night ROE active: patrols, raids, infiltration"},{"day":2,"time":"2:00 AM","label":"Sustainment and security-halt window (sleep rotation)"},{"day":2,"time":"4:30 AM","label":"Stand-to and pre-dawn repositioning"},{"day":2,"time":"5:30 AM","label":"Dawn final push to the decisive objective"},{"day":2,"time":"7:45 AM","label":"ENDEX: accountability, AAR, and awards"}],"scheduleNote":"Times are approximate and subject to command intent. Day 2 runs continuously overnight into the dawn push.","rules":["Minimum age 12 (12 to 17 with a parent or guardian on-site)","ANSI Z87.1+ full-seal eye protection mandatory at all times; full-face protection required for under-18 players","FPS by class with .20g: rifle 400, DMR 450 (50 ft MED), bolt 550 (100 ft MED). Chrono at check-in plus random on-field spot-checks","NO tracers, pyrotechnics, open flame, or smokes due to central Utah fire restrictions. Spark arrestors required on all engines","Five-minute bleed-out; tourniquet buddy-aid; medic IV (water-bottle) heal; two-bandage cap, then return to FOB or CCP","Call your own hits honestly and never call others. Marshals are the only authority for disputes","Night ops: weapon-light on or semi-only after dusk; red kill-light required; no high-FPS sniper or MBR class after dark","A completed waiver is required and is emailed after booking"],"fpsLabel":"Rifle 400 / DMR 450 / Bolt 550","firstGameLabel":"Skills Lanes","documents":[{"label":"Liability waiver","note":"Required. Emailed after booking; sign before arrival."},{"label":"Event TACSOP and ruleset","note":"Read before the event."},{"label":"Packing and sustainment list","note":"Self-sufficient FOB bag: 2L water minimum on-body, food, BBs, batteries, first aid, and a warm layer for the night."}],"terrain":"Rugged canyon and plateau terrain at roughly 7,200 ft on the edge of the Manti-La Sal National Forest. Two canyons flank the old King Coal works, with dilapidated structures and the historic mine office as the central objective. Expect large day-to-night temperature swings and cold pre-dawn hours. All mine portals and condemned buildings are hard OFF-LIMITS."}',
  custom_questions_json = '[{"key":"faction","label":"Choose your faction","type":"select","required":true,"options":["Gentry Resource Group (GRG)","Miller Creek Free Company (Cinderjacks)"],"sortOrder":0}]',
  updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-18hr-milsim';

-- Retire the old single 350-cap "Standard Ticket" (0 sold): deactivate so it
-- drops out of the booking flow (active=1 filter) without deleting the row.
UPDATE ticket_types
SET active = 0, updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_NBVUMAr6EnUb';

-- The 3 day-passes (prices are PLACEHOLDERS; capacities sum to 150 per day).
INSERT INTO ticket_types
  (id, event_id, name, description, price_cents, capacity, sold, min_per_order, max_per_order, sale_starts_at, sale_ends_at, sort_order, active, created_at, updated_at)
VALUES
  ('tt_gt18_weekend', 'ghost-town-18hr-milsim', 'Full Weekend (Day 1 + Day 2)', 'Both days: Day 1 skills and prep games plus the Day 2 18-hour operation.', 11000, 100, 0, 1, 10, NULL, NULL, 1, 1, strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('tt_gt18_day1', 'ghost-town-18hr-milsim', 'Day 1 only - Skills and Prep', 'Saturday only: skills lanes, gear shakedown, and squad-cohesion games.', 4500, 50, 0, 1, 10, NULL, NULL, 2, 1, strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('tt_gt18_day2', 'ghost-town-18hr-milsim', 'Day 2 only - 18HR Operation', 'Sunday only: the 18-hour continuous force-on-force operation.', 8500, 50, 0, 1, 10, NULL, NULL, 3, 1, strftime('%s','now')*1000, strftime('%s','now')*1000);
