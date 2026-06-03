-- Item 6c — Foxtrot Jungle Warfare: seed the (operator-approved) mission
-- briefing into events.details_json + reuse the hero image as the card image.
--
-- details_json is set directly in its already-sanitized shape (just
-- missionBriefing); the other detail fields stay absent so the public
-- EventDetail page uses its hardcoded fallbacks. The operator can fill in the
-- rest (timeline / FPS / rules / docs / factions / terrain) via the new admin
-- "Detail page content" editor (item 6b) — loading this content round-trips it.
--
-- Pre-state (queried 2026-06-02): details_json NULL, card_image_url '',
-- hero_image_url set. Reversible: set details_json=NULL, card_image_url=''.

UPDATE events
SET details_json = '{"missionBriefing":["The heat hangs heavy over the Kaysville treeline as two forces commit to a day of jungle warfare. FOXTROT: Jungle Warfare drops squads into dense cover, narrow trails, and contested clearings for a full morning of close-country airsoft. Expect ambushes from the undergrowth, leapfrogging fireteams, and objectives that reward patience and communication over raw speed.","Operators muster at staging for the safety brief and mission orders before the first push at 7:00 AM. Whether you''re cutting your teeth or running point for a seasoned squad, the field is built to deliver fair, intense, objective-driven play straight through to the 2:00 PM exfil."]}',
    card_image_url = hero_image_url
WHERE slug = 'foxtrot-jungle-warfare';
