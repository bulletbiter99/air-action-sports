-- Rename event "Volga Initiative" -> "Volga Flank" (operator decision 2026-06-02,
-- reversing the earlier typo correction). The event page is fully data-driven, so the
-- title change renames the event site-wide (card, hero, tab title, booking, OG, emails).
-- slug -> volga-flank so the URL matches the name; the id STAYS 'volga-initiative'
-- (bookings/ticket_types/attendees FK + the old /events/volga-initiative URL still
-- resolve via the worker's id-OR-slug lookup, worker/routes/events.js). The details_json
-- mission-briefing is the only body mention of the name — replace() handles it (the R2
-- image URLs use the volga-hero/card/logos keys, not "Volga Initiative", so untouched).

UPDATE events
SET
  title = 'Volga Flank',
  slug = 'volga-flank',
  details_json = replace(details_json, 'Volga Initiative', 'Volga Flank'),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'volga-initiative';
