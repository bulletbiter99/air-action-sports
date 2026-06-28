-- GO-LIVE for OPERATION LAST LIGHT (event id `ghost-town-iii-regular-play`).
--
-- Re-applies the full Operation Last Light build, ADDS the teams picker
-- (custom_questions_json), and PUBLISHES (published=1) -- in one statement so a
-- partial state cannot go live.
--
-- WHY RE-APPLY: between the first build (scripts/seed-operation-last-light.sql)
-- and this go-live, the EVENTS row was reverted to its pre-seed content (title
-- "Ghost Town III: Recruitment", $80, "Rural Neighborhood", details_json NULL)
-- by an out-of-band write -- the signature (whole events row clobbered, the
-- ticket_types row's $60 SURVIVED, fresh updated_at) points to an admin
-- "Save event" from a /admin/events tab left open from before the build (the
-- event PUT rewrites the full row from stale form state but does not touch
-- tickets). This script restores the intended content + goes live atomically.
--
-- Teams picker verified GO by a multi-agent review: a required `select` renders
-- a dropdown (Booking.jsx), is enforced client-side AND server-side (HTTP 400 in
-- bookings.js BEFORE pricing/Stripe), answers persist to attendees.custom_answers_json,
-- and the Critical payment path (pricing.js/stripe.js/webhooks.js) is untouched.
-- custom_questions_json matches the admin normalizer shape {key,label,type,
-- required,options,sortOrder} so a later admin save round-trips as a no-op.
-- /api/* is Cache-Control: no-store, so publishing is visible immediately.
--
-- Options are Russian / NATO only (the two pickable sides). Civilians are
-- assigned on-site via color tape per the operator copy, so not a booking option.
--
-- past stays 0 (date-future, not archived) so it shows in the public listing.
-- site_id stays NULL on purpose (avoids a same-day site conflict with the
-- separate `ghost-town-18hr-milsim` 2-day op, also 7/25 at the Ghost Town site).

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
  custom_questions_json = '[{"key":"faction","label":"Choose your faction","type":"select","required":true,"options":["Russian Forces","NATO Forces"],"sortOrder":0}]',
  published = 1,
  updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-iii-regular-play';

-- Re-assert the $60 entry (idempotent; this row survived the revert).
UPDATE ticket_types
SET price_cents = 6000, updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_NzvgjgKN8Kdc';
