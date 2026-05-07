-- 0025_new_admin_dashboard_flag.sql
--
-- M3 Batch 9 — feature flag row for the persona-tailored AdminDashboard.
--
-- Ships in state='off' so the existing AdminDashboard renders unchanged
-- in production. Flipping to 'on' (or 'role_scoped') swaps in the new
-- AdminDashboardPersona shell, which renders a different widget set per
-- the user's role (owner / manager / staff) per src/admin/personaLayouts.js.
--
-- Rollback posture: the existing AdminDashboard.jsx code path stays
-- intact; flipping the flag back to 'off' immediately reverts to the
-- legacy UI without a code redeploy. Same pattern M2 B5c used for the
-- density toggle and B8a used for customers_entity.
--
-- Operator-applies-remote step (post-merge):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Operator flips via /admin/settings (M2 B5c hook) when ready to expose.
-- Suggested rollout: flip to 'role_scoped' with role_scope='owner' first
-- (only the owner sees it), then expand to 'owner,manager', then 'on'.

INSERT OR IGNORE INTO feature_flags
    (key, description, state, user_opt_in_default, role_scope, created_at, updated_at, notes)
VALUES (
    'new_admin_dashboard',
    'Persona-tailored AdminDashboard. Renders a role-specific widget set per src/admin/personaLayouts.js. Ships off; flip to role_scoped or on to enable.',
    'off',
    0,
    NULL,
    strftime('%s','now') * 1000,
    strftime('%s','now') * 1000,
    'Seeded in M3 batch 9 (migration 0025). Legacy AdminDashboard preserved as fallback when flag is off.'
);
