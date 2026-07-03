-- Rebuild Operation Fire Storm (event `ghost-town-18hr-milsim`) as the
-- 16-HOUR NIGHT-ONLY operation per the operator's promo message (2026-07-01),
-- superseding scripts/seed-operation-fire-storm.sql's two-part (Day 1 daytime
-- + overnight) structure.
--
-- Operator decisions baked in (2026-07-01):
--   * NIGHT-ONLY, 16 hours: check-in Sat 7:45 PM, game on 8:00 PM (END OF
--     PEACE), ENDEX Sun 12:00 PM. The Day-1 daytime program is DROPPED
--     (daytime July 25 is Operation Last Light's event).
--   * Teams -> Russian Forces / NATO Forces picker (required, per player);
--     civilians are split evenly on-site with colored tape - NOT bookable.
--     (Replaces the GRG/Cinderjacks placeholder factions.)
--   * Age rule: KEEP the site standard (min 12; 12-17 with guardian) - the
--     message's "under 16 with 18+ adult" was declined.
--   * FPS tiers aligned to the message (same ruleset as Operation Last Light).
--   * NEW content from the message: LIMITED AMMO mechanic (carry what you
--     get; ammo caches / hidden caches / armor+ammo trucks to conquer;
--     achievements rewarded in ammo), bio BBs, flashlight required (NVG
--     recommended), free water on-site, cash accepted at the gate,
--     bring food/snacks/sleep gear.
--   * Price stays $80 (set in scripts/set-operation-fire-storm-price.sql);
--     the single ticket's DESCRIPTION is fixed (it referenced the dropped
--     Day-1 program).
--   * Event STAYS A DRAFT (published untouched).
--
-- D1 quirks: no BEGIN/COMMIT; JSON columns are single-line double-quoted JSON
-- inside single-quoted SQL; content avoids apostrophes so no quote-escaping.

UPDATE events
SET
  date_iso = '2026-07-25T19:45:00',
  end_date_iso = '2026-07-26T12:00:00',
  time_range = 'Sat 7:45 PM - Sun 12:00 PM',
  check_in = '7:45 PM',
  first_game = '8:00 PM',
  end_time = '12:00 PM',
  short_description = 'A 16-hour, non-stop overnight MILSIM at Ghost Town in Hiawatha, Utah: night ops, recon patrols, supply convoy escorts, and hostage rescues with limited ammo.',
  game_modes_json = '["Night Ops","Recon Patrols","Supply Convoy Escorts","Hostage Rescue"]',
  custom_questions_json = '[{"key":"faction","label":"Choose your faction","type":"select","required":true,"options":["Russian Forces","NATO Forces"],"sortOrder":0}]',
  details_json = '{"missionBriefing":["Operation Fire Storm is a 16-hour, non-stop overnight MILSIM at Ghost Town in Hiawatha, Utah. Check in Saturday at 7:45 PM; after the 8:00 PM safety briefing, END OF PEACE is declared and the field goes to war through the night to the Sunday noon ENDEX.","The operation runs on night recon patrols, supply convoy escorts, and hostage rescues, with two convoy trucks operating on the field. Ammo is LIMITED: the ammo you carry on your person is what you get. Resupply comes from the field itself - ammo caches, hidden caches, and armor and ammo trucks you must conquer - and mission achievements are rewarded in ammo.","Teams: Russian forces wear green and NATO forces wear tan; civilians are split evenly and marked with colored tape on the field. Every faction is organized into Alpha, Bravo, and Charlie squads, so come ready to move and fight as part of a fireteam.","Book your tickets through airactionsport.com. If you cannot book online, cash will be accepted at the gate. Free cases of water will be on-site, but you are strongly advised to bring water in a form you can carry on the battlefield - plus food, snacks, and sleep gear if you can carry it. You will be fighting through the night and in dark places: a flashlight is required to participate; night vision is recommended but not required."],"schedule":[{"day":1,"time":"7:45 PM","label":"Arrival, check-in, chrono, and team assignment"},{"day":1,"time":"8:00 PM","label":"Safety briefing, then END OF PEACE - Operation I First Contact: FOB establishment, recon patrols, logistics convoy, comms tower assault"},{"day":2,"time":"12:00 AM","label":"Operation II - Nightfall: special operations raid, engineer escort, high-value target, mobile logistics convoy"},{"day":2,"time":"4:00 AM","label":"Operation III - Dawn Rising: fuel depot assault, mine complex assault, territory control, counter offensive"},{"day":2,"time":"8:00 AM","label":"Operation IV - Final Stand: mobile command vehicle, prototype recovery, final offensive, last stand with all objectives active"},{"day":2,"time":"12:00 PM","label":"ENDEX - accountability, AAR, and awards"}],"scheduleNote":"A 16-hour, non-stop overnight operation. Times are approximate and subject to command intent.","rules":["350 FPS and under: no minimum engagement distance; semi and full-auto allowed past 25 ft","351 to 449 FPS: 50 ft minimum engagement distance, semi-only","450 to 550 FPS: 100 ft minimum engagement distance, semi-only","LMGs may use full-auto over 350 FPS but still require a 50 ft minimum engagement distance","All FPS readings are taken with a .20g BB; HPA and heavier-gram BBs are measured by joules","Biodegradable BBs required","LIMITED AMMO: the ammo you carry is what you get - resupply only from ammo caches, hidden caches, captured armor and ammo trucks, and mission achievement rewards","A flashlight is required to participate; night vision is recommended but not required","No fireworks, pyrotechnics, open flames, or smoke grenades - fire-restricted land","Follow the Rules of Engagement at all times","Keep proper trigger discipline","Pack out all trash and leave the site cleaner than you found it","ANSI Z87.1+ full-seal eye protection mandatory at all times; full-face protection required for under-18 players","Minimum age 12 (12 to 17 with a parent or guardian on-site)","Call your own hits honestly; marshals are the final authority","Completed waiver required (emailed after booking)"],"fpsLabel":"350 / 450 / 550 by class","firstGameLabel":"END OF PEACE","documents":[{"label":"Safety Briefing","url":"/safety","note":"Required reading before you arrive."},{"label":"Liability waiver","note":"Required. Emailed after booking; sign before arrival."},{"label":"Packing and sustainment list","note":"Bring what you can carry: water on-body, food, snacks, bio BBs, batteries, a flashlight, and sleep gear. Free water cases are on-site."}],"terrain":"Rugged canyon and plateau terrain at roughly 7,200 ft on the edge of the Manti-La Sal National Forest, around the abandoned mining town of Hiawatha. Dilapidated structures and dark interiors define the night fight. Expect large day-to-night temperature swings and cold pre-dawn hours. All mine portals and condemned buildings are hard OFF-LIMITS."}',
  updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-18hr-milsim';

-- Fix the single ticket description (it referenced the dropped Day-1 program).
UPDATE ticket_types
SET
  description = 'The full 16-hour overnight operation: Saturday 7:45 PM check-in through the Sunday noon ENDEX.',
  updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_gt_firestorm';
