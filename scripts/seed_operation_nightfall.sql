-- Seed Operation Nightfall (the launch event) with featured flag,
-- short description, and custom booking questions.
--
-- Cover image is NOT touched here — must be uploaded via /admin/events
-- (the picker writes to R2 + sets cover_image_url).
--
-- Custom questions JSON shape matches what parseEventBody expects in
-- worker/routes/admin/events.js: {key, label, type, required, options, sortOrder}.

UPDATE events
SET
    featured = 1,
    short_description = 'AAS''s inaugural event. 350 players, 14 hours of nonstop action across the full Ghost Town site — bunker systems, urban CQB, and long-range engagement zones.',
    custom_questions_json = '[{"key":"emergency_contact","label":"Emergency contact (name + phone)","type":"text","required":true,"options":[],"sortOrder":0},{"key":"experience_level","label":"Experience level","type":"select","required":false,"options":["First-timer","Played a few times","Regular player","Veteran (10+ events)"],"sortOrder":1},{"key":"team_name","label":"Team or squad name (if applicable)","type":"text","required":false,"options":[],"sortOrder":2},{"key":"vest_size","label":"Vest size (if renting gear)","type":"select","required":false,"options":["S","M","L","XL","XXL","Not renting"],"sortOrder":3}]',
    updated_at = unixepoch() * 1000
WHERE id = 'operation-nightfall';

SELECT id, featured, length(short_description) AS desc_len, length(custom_questions_json) AS q_json_len
FROM events
WHERE id = 'operation-nightfall';
