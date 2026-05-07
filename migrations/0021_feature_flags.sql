-- 0021_feature_flags.sql
--
-- Adds the feature-flag substrate for M2 batch 5a + downstream milestones.
--
-- Two tables:
--   feature_flags
--     Row per flag. `state` is one of off/on/user_opt_in/role_scoped:
--       - off          : isEnabled() always returns false
--       - on           : isEnabled() always returns true
--       - user_opt_in  : isEnabled() consults feature_flag_user_overrides;
--                        falls through to user_opt_in_default
--       - role_scoped  : isEnabled() checks user.role against role_scope
--                        (comma-separated; e.g. "owner,manager")
--
--   feature_flag_user_overrides
--     Per-user opt-in/opt-out for `state='user_opt_in'` flags. Composite
--     PK (flag_key, user_id) — one override per user per flag. INSERT OR
--     REPLACE upserts.
--
-- No FK constraints (D1 does not enforce by default; matches the
-- audit_log table's pattern). Application-layer integrity:
--   worker/lib/featureFlags.js validates flag existence before reading;
--   route handlers validate user.id before writing.
--
-- Seeds:
--   density_compact — M2's first flag. user_opt_in with default off.
--   The B5c density toggle UI in /admin/settings is the visible consumer.
--
-- IF NOT EXISTS / INSERT OR IGNORE so a re-apply is a no-op.
--
-- Operator applies via:
--   npx wrangler d1 migrations apply air-action-sports-db --remote
-- after M2 merges to main. Documented in docs/runbooks/m2-deploy.md (B7).

CREATE TABLE IF NOT EXISTS feature_flags (
    key                  TEXT PRIMARY KEY,
    description          TEXT,
    state                TEXT NOT NULL CHECK (state IN ('off', 'on', 'user_opt_in', 'role_scoped')),
    user_opt_in_default  INTEGER NOT NULL DEFAULT 0 CHECK (user_opt_in_default IN (0, 1)),
    role_scope           TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    notes                TEXT
);

CREATE TABLE IF NOT EXISTS feature_flag_user_overrides (
    flag_key   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    enabled    INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    set_at     INTEGER NOT NULL,
    PRIMARY KEY (flag_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_user_overrides_user
    ON feature_flag_user_overrides(user_id);

INSERT OR IGNORE INTO feature_flags
    (key, description, state, user_opt_in_default, role_scope, created_at, updated_at, notes)
VALUES (
    'density_compact',
    'Compact-density admin layout (rows shorter, padding tighter). User-toggleable via /admin/settings.',
    'user_opt_in',
    0,
    NULL,
    strftime('%s','now') * 1000,
    strftime('%s','now') * 1000,
    'Seeded in M2 batch 5a (migration 0021). Default off; users opt in.'
);
