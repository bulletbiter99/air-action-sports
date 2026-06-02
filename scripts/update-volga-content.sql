-- Volga Initiative (id=volga-initiative) full event content build.
--
-- details_json: per-event structured content consumed by the (now data-driven)
--   src/pages/EventDetail.jsx — firstGameLabel (replaces the global "TDM"),
--   fpsLabel (Joule-based sidebar FPS), missionBriefing, rules (override that
--   ALLOWS blind fire + Joule energy limits), schedule (18-hr MILSIM timeline),
--   documents (RSTS SOP + Kraken/NATO + Bolotnik/RUSFOR forms), terrain, and
--   factionLinks (per-faction registration link shown inline in the booking flow).
-- custom_questions_json: the per-attendee Faction selector (Kraken / Bolotnik),
--   required; renders + validates on the existing booking flow with no code change.
-- first_game / check_in: aligned to the coordinator schedule (briefs 1730, start 1800).
-- short_description: replaces the "Coming Soon" placeholder.
--
-- All values are JSON stored as TEXT; em/en-dashes and the middle dot are UTF-8.
-- collabBannerUrl is intentionally omitted until the 3-org logo image is hosted in R2
-- (a follow-up UPDATE adds it; the banner section stays hidden until then).

UPDATE events
SET
  first_game = '6:00 PM',
  check_in = '4:00 PM – 5:30 PM',
  short_description = '18-hour force-on-force MILSIM — day and night operations, faction warfare, and overnight field conditions.',
  details_json = '{
  "firstGameLabel": "Squad Force on Force",
  "fpsLabel": "1.5J+ (Squad Support) · per SOP",
  "missionBriefing": [
    "Volga Initiative is an immersive 18-hour force-on-force MILSIM event running from 1600 on 20 June through 1000 on 21 June. This event includes day and night operations, squad-level movement, faction-based objectives, command structure, role-based gameplay, and overnight field conditions.",
    "Players are expected to arrive prepared, read the RSTS FOF SOP prior to attendance, complete the correct faction registration form, and follow all safety, uniform, weapons, and event control requirements."
  ],
  "rules": [
    "Minimum age 12 (12–17 with parent/guardian on-site)",
    "ANSI Z87.1+ full-seal eye protection mandatory; full-face mask required for under-18",
    "Energy limits per the RSTS FOF SOP — Squad Support roles 1.5J or higher",
    "Hits called honestly — honor system, marshals enforce",
    "Blind fire permitted (host ruleset); no physical contact, no impaired play",
    "Read the RSTS FOF SOP before attending",
    "Completed waiver required (emailed after booking)"
  ],
  "schedule": [
    { "time": "20 Jun · 1600", "label": "Player arrival, parking, check-in, chrono, gear inspection" },
    { "time": "1730", "label": "Safety brief, faction brief, command brief" },
    { "time": "1800", "label": "Event start" },
    { "time": "1800–2100", "label": "Daylight operations" },
    { "time": "2100–0800", "label": "Night operations" },
    { "time": "21 Jun · 0800–1000", "label": "Reveille and final assault" },
    { "time": "Overnight", "label": "Players remain in the field unless otherwise directed by RSTS Cadre" }
  ],
  "scheduleNote": "Schedule may shift based on weather, safety, player accountability, and Cadre direction.",
  "documents": [
    { "label": "RSTS FOF SOP / Ruleset — read before attending", "url": "https://docs.google.com/document/d/1PM1UWBM4oFhXEwPixgLHkqTVHxA6YrujI_boaL1VW7w/edit" },
    { "label": "Kraken (NATO) Registration — after booking", "url": "https://forms.gle/VZ1F2F4yegyqVshn9" },
    { "label": "Bolotnik (RUSFOR) Registration — after booking", "url": null, "note": "link coming soon" }
  ],
  "terrain": "Volga runs at the Foxtrot site near Kaysville — an open field complex with mixed terrain, tree lines, and purpose-built staging. Expect extended squad movement and overnight field conditions across day and night operations.",
  "factionLinks": {
    "Kraken (NATO)": { "label": "Complete your Kraken (NATO) registration", "url": "https://forms.gle/VZ1F2F4yegyqVshn9" },
    "Bolotnik (RUSFOR)": { "label": "Bolotnik (RUSFOR) registration", "url": null, "note": "link coming soon" }
  }
}',
  custom_questions_json = '[
  { "key": "faction", "label": "Faction", "type": "select", "required": true, "options": ["Kraken (NATO)", "Bolotnik (RUSFOR)"], "sortOrder": 0 }
]',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'volga-initiative';
