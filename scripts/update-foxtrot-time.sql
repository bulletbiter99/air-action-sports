-- Foxtrot Jungle Warfare (id=foxtrot-vietnam): set the day-game window to 7am-2pm
-- per event-coordinator input, and fix the stale display_date (was "20 May 2026";
-- the event is 20 June 2026 — display_day/display_month were already "20"/"June").
-- Cosmetic display/time strings only; date_iso is untouched so the event-conflict
-- gate does not fire. En-dash (U+2013) characters are intentional (match site convention).

UPDATE events
SET
  time_range = '7:00 AM – 2:00 PM',
  check_in = '7:00 AM – 8:00 AM',
  first_game = '8:00 AM',
  end_time = '2:00 PM',
  display_date = '20 June 2026',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'foxtrot-vietnam';
