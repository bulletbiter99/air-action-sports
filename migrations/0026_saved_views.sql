-- 0026_saved_views.sql
--
-- Per-user saved filter/sort views for admin list pages (Surface 2).
--
-- Migrates the M2 useSavedViews hook from localStorage to D1-backed
-- storage so views sync across an admin's devices. The hook's public
-- API surface stays stable (`{ views, saveView, deleteView, renameView }`);
-- only the storage backend swaps. Consumers (FilterBar in
-- src/components/admin/FilterBar.jsx, used by AdminFeedback / AdminCustomers
-- / future AdminBookings) require no caller-side changes.
--
-- One row per (user_id, page_key, name). UNIQUE constraint enforces a single
-- view name per user per page. The route layer (worker/routes/admin/savedViews.js)
-- handles upsert by deleting + re-inserting rather than INSERT OR REPLACE so
-- updated_at semantics stay clean.
--
-- No FK constraints — D1 does not enforce by default; matches the
-- feature_flag_user_overrides + audit_log pattern. Application-layer integrity:
--   * route handlers verify user_id ownership on PUT/DELETE
--   * route handlers reject empty name and missing pageKey
--   * hook clears views on logout (via login flow's session.clear)
--
-- IF NOT EXISTS so a re-apply is a no-op.
--
-- Operator applies via:
--   CLOUDFLARE_API_TOKEN=$TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote
-- after M4 B2a merges to main. Until applied, the route's defensive
-- "table missing" handling returns empty list on GET (no 500); POST/PUT/DELETE
-- error normally so the operator notices.

CREATE TABLE IF NOT EXISTS saved_views (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    page_key      TEXT NOT NULL,
    name          TEXT NOT NULL,
    filter_json   TEXT NOT NULL,
    sort_json     TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    UNIQUE (user_id, page_key, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_user_page
    ON saved_views(user_id, page_key);
