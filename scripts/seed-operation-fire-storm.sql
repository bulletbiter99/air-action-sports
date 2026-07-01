-- Rebuild the draft event `ghost-town-18hr-milsim` into OPERATION FIRE STORM,
-- combining the operator's two July 25-26 planning docs into ONE event:
--   * "operations for july 25-26.docx"  -> Day 1 daytime program (Sat).
--   * "operation fire storm.docx"        -> the 18-hour overnight operation.
-- (The safety briefing doc is published separately at /safety and linked below
--  under Required Documents.)
--
-- Operator decisions baked in (2026-06-30):
--   * Both docs are THIS event; Operation Last Light is left UNTOUCHED.
--   * Dates: Sat 25 -> Sun 26 overnight (daytime program flows into the night op).
--   * Ticket model: a SINGLE full-event ticket; the 3 day-passes are deactivated.
--   * Safety briefing: published at /safety, linked as a Required Document.
--   * Title -> "Operation Fire Storm"; slug -> "operation-fire-storm".
--   * Factions KEPT (GRG vs Cinderjacks) -> custom_questions_json NOT touched.
--   * Stays a DRAFT (published NOT set) -> operator reviews in /admin/events.
--
-- FLAGS for operator review before publishing:
--   * PRICE IS A PLACEHOLDER ($110). base_price_cents + the single ticket = 11000.
--   * The two source timelines OVERLAP on Saturday evening (daytime ENDEX vs the
--     overnight op's 6:15 PM registration). This build reconciles them by dropping
--     the overnight op's redundant re-registration/briefing (check-in already
--     happens Sat morning) and starting the night op at END OF PEACE 8:00 PM.
--     Confirm the Saturday-evening handoff time.
--   * The schedule is day-keyed: Day 1 = Saturday; Day 2 = the overnight op's
--     post-midnight (Sunday) blocks. The 8:00 PM END OF PEACE row sits at the end
--     of Day 1 (still Saturday). scheduleNote explains the overnight flow.
--
-- D1 quirks: no BEGIN/COMMIT; JSON columns are single-line double-quoted JSON
-- inside single-quoted SQL; content avoids apostrophes so no quote-escaping.

UPDATE events
SET
  title = 'Operation Fire Storm',
  slug = 'operation-fire-storm',
  date_iso = '2026-07-25T08:00:00',
  end_date_iso = '2026-07-26T12:00:00',
  display_date = '25-26 July 2026',
  display_day = '25',
  display_month = 'July 2026',
  time_range = 'Sat 8:00 AM - Sun 12:00 PM',
  check_in = '8:00 AM',
  first_game = '9:30 AM',
  end_time = '12:00 PM',
  base_price_cents = 11000,
  short_description = 'A two-day MILSIM at Ghost Town in Hiawatha, Utah: a full Saturday daytime program that flows into an 18-hour continuous overnight operation to the Sunday dawn push.',
  game_modes_json = '["Objective Missions","Convoy Escort","Recon Patrols","18-Hour Overnight Operation"]',
  details_json = '{"missionBriefing":["Operation Fire Storm is a two-day MILSIM at Ghost Town in Hiawatha, Utah. Saturday runs a full daytime program of objective missions; that evening, at END OF PEACE, the field goes to war for an 18-hour continuous operation that runs through the night to the Sunday dawn push.","The setting is the abandoned King Coal complex. Two forces contest the town and the seam beneath it across recon patrols, supply and logistics convoys (two pickup trucks operate on the field), comms-tower and fuel-depot assaults, high-value-target grabs, and a prototype recovery.","Come self-sufficient. This is an overnight operation with large day-to-night temperature swings and cold pre-dawn hours: bring water you can carry, food, batteries, BBs, a first-aid kit, and a warm layer. A completed waiver is required and is emailed after booking."],"schedule":[{"day":1,"time":"8:00 AM","label":"Registration, check-in, chrono, team assignment, and gear inspection"},{"day":1,"time":"8:45 AM","label":"Command and safety briefing"},{"day":1,"time":"9:15 AM","label":"Teams move to starting positions"},{"day":1,"time":"9:30 AM","label":"Operation I - First Contact: strategic building capture, supply convoy escort, intelligence recovery, sector control"},{"day":1,"time":"12:30 PM","label":"Lunch and field reset"},{"day":1,"time":"1:30 PM","label":"Operation II - Black Vein: mine assault, engineer escort, fuel convoy, VIP rescue"},{"day":1,"time":"5:00 PM","label":"Break and reset"},{"day":1,"time":"5:30 PM","label":"Operation III - Last Stand: mobile command vehicle, prototype recovery, final offensive"},{"day":1,"time":"7:30 PM","label":"Daytime ENDEX; refit and prep for the night operation"},{"day":1,"time":"8:00 PM","label":"END OF PEACE - Night Op I First Contact: FOB establishment, recon patrols, logistics convoy, comms-tower assault"},{"day":2,"time":"12:00 AM","label":"Night Op II - Nightfall: special operations raid, engineer escort, high-value target, mobile logistics convoy"},{"day":2,"time":"4:00 AM","label":"Night Op III - Dawn Rising: fuel depot assault, mine complex assault, territory control, counter offensive"},{"day":2,"time":"8:00 AM","label":"Night Op IV - Final Stand: mobile command vehicle, prototype recovery, final offensive, last stand"},{"day":2,"time":"12:00 PM","label":"ENDEX - accountability, AAR, and awards"}],"scheduleNote":"Day 1 is a full daytime program that flows into the night. The 18-hour operation begins Saturday at END OF PEACE (8:00 PM) and runs continuously overnight to the Sunday noon ENDEX. Times are approximate and subject to command intent.","rules":["Minimum age 12 (12 to 17 with a parent or guardian on-site)","ANSI Z87.1+ full-seal eye protection mandatory at all times; full-face protection required for under-18 players","FPS by class with .20g: rifle 400, DMR 450 (50 ft MED), bolt 550 (100 ft MED). Chrono at check-in plus random on-field spot-checks","NO tracers, pyrotechnics, open flame, or smokes due to central Utah fire restrictions. Spark arrestors required on all engines","Five-minute bleed-out; tourniquet buddy-aid; medic IV (water-bottle) heal; two-bandage cap, then return to FOB or CCP","Call your own hits honestly and never call others. Marshals are the only authority for disputes","Night ops: weapon-light on or semi-only after dusk; red kill-light required; no high-FPS sniper or MBR class after dark","A completed waiver is required and is emailed after booking"],"fpsLabel":"Rifle 400 / DMR 450 / Bolt 550","firstGameLabel":"First Contact","documents":[{"label":"Safety Briefing","url":"/safety","note":"Required reading before you arrive."},{"label":"Liability waiver","note":"Required. Emailed after booking; sign before arrival."},{"label":"Event TACSOP and ruleset","note":"Read before the event."},{"label":"Packing and sustainment list","note":"Self-sufficient FOB bag: 2L water minimum on-body, food, BBs, batteries, first aid, and a warm layer for the night."}],"terrain":"Rugged canyon and plateau terrain at roughly 7,200 ft on the edge of the Manti-La Sal National Forest. Two canyons flank the old King Coal works, with dilapidated structures and the historic mine office as the central objective. Expect large day-to-night temperature swings and cold pre-dawn hours. All mine portals and condemned buildings are hard OFF-LIMITS."}',
  updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-18hr-milsim';

-- Ticket model -> a SINGLE full-event ticket. Deactivate the 3 day-passes
-- (all 0 sold, so safe): they drop out of the booking flow (active=1 filter)
-- without deleting the rows.
UPDATE ticket_types
SET active = 0, updated_at = strftime('%s','now') * 1000
WHERE id IN ('tt_gt18_weekend', 'tt_gt18_day1', 'tt_gt18_day2');

-- The single full-event ticket (PRICE IS A PLACEHOLDER: $110 = 11000).
INSERT INTO ticket_types
  (id, event_id, name, description, price_cents, capacity, sold, min_per_order, max_per_order, sale_starts_at, sale_ends_at, sort_order, active, created_at, updated_at)
VALUES
  ('tt_gt_firestorm', 'ghost-town-18hr-milsim', 'Operation Fire Storm - Full Event', 'Full two-day access: the Saturday daytime program plus the 18-hour overnight operation.', 11000, 150, 0, 1, 10, NULL, NULL, 1, 1, strftime('%s','now')*1000, strftime('%s','now')*1000);
