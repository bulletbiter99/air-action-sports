-- 0029_command_palette_flag.sql
--
-- M4 Batch 7 — feature flag row for the keyboard-driven Command Palette.
--
-- Ships in state='off' so no production users see the palette by default.
-- Flipping to 'on' enables Cmd+K (Mac) / Ctrl+K (Win/Linux) globally
-- inside the admin shell. Renders src/admin/CommandPalette.jsx — a
-- centered overlay with fuzzy-match navigation commands derived from
-- src/admin/sidebarConfig.js (B5).
--
-- Orthogonal to the new admin shell (B4-B6 features). The palette
-- works whether or not new_admin_dashboard is on; same Cmd+K shortcut
-- triggers the same overlay in both modes. Sharing the SIDEBAR config
-- means the palette automatically picks up nav items added in future
-- batches.
--
-- Rollback posture: flipping the flag back to 'off' immediately
-- removes the global keydown listener and the modal — no functional
-- residue. Same pattern as 0024 (customers_entity) and 0025
-- (new_admin_dashboard).
--
-- Operator-applies-remote step (post-merge):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Verify with:
--   npx wrangler d1 execute air-action-sports-db --remote \
--     --command="SELECT key, state, description FROM feature_flags WHERE key='command_palette'"
--
-- Operator flips via SQL UPDATE (no admin UI for this flag yet — power
-- user feature; flip when ready):
--   UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000
--     WHERE key='command_palette';

INSERT OR IGNORE INTO feature_flags
    (key, description, state, user_opt_in_default, role_scope, created_at, updated_at, notes)
VALUES (
    'command_palette',
    'Keyboard-driven Command Palette (Cmd+K / Ctrl+K). Centered overlay with fuzzy-match navigation. Admin-only. Ships off; flip to on to enable globally.',
    'off',
    0,
    NULL,
    strftime('%s','now') * 1000,
    strftime('%s','now') * 1000,
    'Seeded in M4 batch 7 (migration 0029). Orthogonal to new_admin_dashboard; works alongside both legacy and new sidebars.'
);
