-- 0060_field_rentals_recurrence_unique.sql
-- Post-M6 D-2 polish — stronger idempotency on cron-generated rentals.
--
-- PRE-MIGRATION SPOT-CHECK (verified 2026-05-27 on remote):
-- - Existing index `idx_field_rentals_recurrence` is a plain INDEX from 0047.
-- - Production has 0 field_rentals rows with recurrence_id != NULL today,
--   so no risk of duplicate-collision during the UNIQUE index creation.
-- - Code (worker/lib/fieldRentalRecurrences.js) already pre-checks via
--   SELECT before INSERT; this constraint makes that belt-and-suspenders
--   and prevents two parallel cron runs from racing past the pre-check.
--
-- D1 quirks (per CLAUDE.md):
-- - No BEGIN/COMMIT keywords.
-- - DROP INDEX + CREATE UNIQUE INDEX is additive — no table-rebuild.
-- - The partial filter `WHERE recurrence_id IS NOT NULL` is critical:
--   SQLite treats multiple NULLs as distinct in UNIQUE, but the partial
--   index makes the intent explicit. One-off rentals (recurrence_id NULL,
--   instance_index NULL) won't collide on the unique constraint.

DROP INDEX IF EXISTS idx_field_rentals_recurrence;

CREATE UNIQUE INDEX idx_field_rentals_recurrence
  ON field_rentals(recurrence_id, recurrence_instance_index)
  WHERE recurrence_id IS NOT NULL;
