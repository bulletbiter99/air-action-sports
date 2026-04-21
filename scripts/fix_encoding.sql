-- One-time fix: replace mojibake em/en-dashes with clean ASCII
-- Reason: seed SQL was interpreted as CP1252 during upload, corrupting
-- UTF-8 em/en-dashes into "a^euro"" sequences.
-- Going forward, seed files use plain ASCII; admin UI (phase 5) will
-- let typographic dashes be entered directly via JSON bodies.

UPDATE events SET
    location   = 'Ghost Town - Rural Neighborhood',
    time_range = '6:30 AM - 8:00 PM',
    check_in   = '6:30 AM - 8:00 AM',
    end_time   = '7:30 - 8:00 PM',
    updated_at = unixepoch() * 1000
WHERE id = 'operation-nightfall';

UPDATE ticket_types SET
    description = 'Full-day airsoft event access - all game modes, marshals, and field time included.',
    updated_at  = unixepoch() * 1000
WHERE id = 'tt_nightfall_standard';
