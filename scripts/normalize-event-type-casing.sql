-- Normalize events.type casing — 2026-07-03
--
-- The type column was operator free-text since inception and accumulated
-- mixed casing ("MILSIM" x2, "Airsoft" x2, "AIRSOFT" x1 as of this date).
-- The public className tint variants (.event-type.milsim etc.) are lowercase
-- and the client mapper (adaptEvent) + write boundary (parseEventBody) now
-- normalize to lowercase; this brings the existing rows in line so the DB,
-- API, and UI all agree.
--
-- Applied to remote D1 after PR #375 deployed. Reversible in principle
-- (prior values recorded above), practically a no-op to public rendering
-- since adaptEvent lowercases on read.
--
-- Verify before: SELECT type, COUNT(*) FROM events GROUP BY type;
-- Verify after:  expect only lowercase values.

UPDATE events
SET type = lower(trim(type))
WHERE type IS NOT NULL AND type != lower(trim(type));
