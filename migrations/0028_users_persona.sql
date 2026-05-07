-- 0028_users_persona.sql
--
-- M4 B4a — adds users.persona column for the persona-tailored AdminDashboard.
--
-- Decision D08 (docs/decisions.md): persona is a "lens preference" decoupled
-- from the 3-value role hierarchy that gates capabilities. Six persona enum
-- values (owner / booking_coordinator / marketing / bookkeeper /
-- generic_manager / staff) let users in the same role see different widget
-- sets — e.g., a manager who books trips ("booking_coordinator") versus a
-- manager who runs marketing campaigns ("marketing").
--
-- Schema addition:
--   persona TEXT  (nullable; CHECK enumerates the six values + NULL)
--
-- Backfill mapping (per D08):
--   role = owner    -> persona = owner
--   role = manager  -> persona = generic_manager
--   role = staff    -> persona = staff
--
-- Why nullable, not NOT NULL:
--   * B4b application code reads `user.persona ?? roleDerivedDefault(user.role)`,
--     so NULL is tolerable for new rows inserted between B4a and B4c (when
--     create-user paths start setting persona explicitly).
--   * Avoids the SQLite 3.35+ column-rename pattern needed for NOT NULL
--     additions on D1 (M3 B6 / migration 0023 hit this — DROP TABLE during
--     table-rebuild fails on FK enforcement). Future NOT NULL enforcement,
--     if ever needed, ships as a separate operator-paced migration.
--
-- D1 quirks reminder (from CLAUDE.md):
--   * No BEGIN / COMMIT keywords — wrangler keyword-scans uploaded SQL,
--     even comment text containing the literal word for a transaction-control
--     statement. This migration uses no such keywords.
--   * Column-rename pattern not needed (column is nullable; CHECK allows NULL).
--
-- Operator command (after PR merges to main + Workers Builds redeploy):
--   CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Verification SELECT (post-apply):
--   SELECT role, persona, COUNT(*) AS n FROM users GROUP BY role, persona;

ALTER TABLE users ADD COLUMN persona TEXT
  CHECK (persona IS NULL OR persona IN (
    'owner',
    'booking_coordinator',
    'marketing',
    'bookkeeper',
    'generic_manager',
    'staff'
  ));

UPDATE users SET persona = 'owner'           WHERE role = 'owner';
UPDATE users SET persona = 'generic_manager' WHERE role = 'manager';
UPDATE users SET persona = 'staff'           WHERE role = 'staff';
