-- Add a "featured" flag to events.
--
-- Why: when there are 3+ concurrent upcoming events, the earliest by date_iso
-- isn't always the "headliner" we want in the homepage countdown / TickerBar.
-- The flag lets admins explicitly pick what gets surfaced.
--
-- Sort order in /api/events becomes: featured DESC, date_iso ASC.
-- Featured events float to the top among the upcoming set; ties within
-- featured (or non-featured) still resolve by date.
--
-- Default 0 — backfill is a no-op; existing single-event behavior unchanged.

ALTER TABLE events ADD COLUMN featured INTEGER DEFAULT 0;
