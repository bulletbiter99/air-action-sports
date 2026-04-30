-- Resolve fb_Tp9RIpHdKgWw (Jesse — Rules of Engagement page request).
-- Page shipped at /rules-of-engagement. Admin note documents what was built.

UPDATE feedback
SET status = 'resolved',
    priority = 'medium',
    admin_note = 'Shipped /rules-of-engagement page (commit 531e9b2). Includes Jesse''s verbatim content (Rifle / DMR / LMG / Sniper classes, grenades, knives) plus 11 added sections closing gaps vs MilSim City''s published ROE: hit calling, ANSI Z87.1+ eye protection, age policy, safe zone procedures, chronograph policy, drugs/alcohol, sportsmanship/cheating, disputes, physical violence, transport, site conduct. Linked from Footer Info column, NewPlayers step 5, and the EventDetail Rules & Requirements section. Owner-decision gaps still open: surrender/bang rules, friendly fire, respawn/medic, sidearm requirements, photography.',
    updated_at = unixepoch() * 1000
WHERE id = 'fb_Tp9RIpHdKgWw';

SELECT id, status, priority, length(admin_note) AS note_len
FROM feedback
WHERE id = 'fb_Tp9RIpHdKgWw';
