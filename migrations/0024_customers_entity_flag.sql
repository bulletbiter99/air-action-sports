-- 0024_customers_entity_flag.sql
--
-- M3 Batch 8a — feature flag row for the customers admin entity.
--
-- Ships in state='off' so the Customers admin UI (sidebar entry +
-- /admin/customers list/detail/merge pages, all in B8b) stays hidden
-- until the owner explicitly flips the flag on. This decouples the
-- code roll-out from the operational rollout: the endpoints + UI live
-- in main from B8 forward, but no end-user sees them until the owner
-- flips state to 'on' (or 'role_scoped' to scope to specific admin
-- roles).
--
-- Flag-state semantics (per migration 0021):
--   off          — UI hidden, route still mounted but the front-end
--                  hook returns false so the link/page doesn't render.
--                  The route itself remains queryable for ops triage
--                  (auth still required).
--   on           — UI visible to every admin.
--   role_scoped  — set role_scope='owner,manager' to grant manager+.
--   user_opt_in  — N/A; not a per-user toggle.
--
-- Operator-applies-remote step (post-merge):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Operator flips the flag via /admin/settings (M2 B5c hook) when
-- ready to expose the customers UI. No code redeploy needed.

INSERT OR IGNORE INTO feature_flags
    (key, description, state, user_opt_in_default, role_scope, created_at, updated_at, notes)
VALUES (
    'customers_entity',
    'Customers admin UI: list, detail, merge. Ships off; owner flips on when ready.',
    'off',
    0,
    NULL,
    strftime('%s','now') * 1000,
    strftime('%s','now') * 1000,
    'Seeded in M3 batch 8a (migration 0024). Backend routes live regardless of state; UI gated client-side.'
);
