-- 0062_reports_capabilities.sql
-- M7 Batch 1a — Reports section capability seed.
--
-- Seeds 6 capabilities for the Reports admin section + 4 role_preset bundles
-- (owner, bookkeeper, marketing_manager, site_coordinator).
--
-- PRE-MIGRATION SPOT-CHECK (verified 2026-05-27, Batch 0 docs):
-- - capabilities table production column is `category`, NOT `scope` (D1 quirk #5)
-- - role_preset_capabilities table: (role_preset_key, capability_key, created_at)
-- - All target presets exist in production: owner, bookkeeper, marketing_manager,
--   site_coordinator (last one from M5.5 B6 migration 0049)
--
-- D1 quirks (per CLAUDE.md):
-- - No BEGIN/COMMIT keywords
-- - Additive INSERT only — no table-rebuild
-- - Column name `category` not `scope` (post-M6 polish session lesson)
--
-- Bundles (per docs/m7-discovery/reports-scope.md):
-- - owner: all reports.* + reports.export
-- - bookkeeper: read + bookkeeper tab + owner tab (financial overlap) + export
-- - marketing_manager: read + marketing tab + export
-- - site_coordinator: read + site_coordinator tab + export
-- - All others (event_director, booking_coordinator, generic_manager, staff,
--   read_only_auditor): NO reports.* — nav entry hidden via the capability gate.
--
-- Dependency chain: reports.read.* and reports.export all require reports.read
-- (the route gate). The capability dependency walker (worker/lib/capabilities.js
-- userHasCapability) follows requires_capability_key chains.

INSERT INTO capabilities (key, category, description, requires_capability_key, created_at) VALUES
  ('reports.read',
   'reports',
   'View Reports section (gates /admin/reports nav entry)',
   NULL,
   strftime('%s','now') * 1000),
  ('reports.read.owner',
   'reports',
   'View Owner reports tab (revenue trends, retention, refund rate, repeat customers, AOV)',
   'reports.read',
   strftime('%s','now') * 1000),
  ('reports.read.bookkeeper',
   'reports',
   'View Bookkeeper reports tab (payouts, tax/fee summary, period comparison; 1099 thresholds link)',
   'reports.read',
   strftime('%s','now') * 1000),
  ('reports.read.marketing',
   'reports',
   'View Marketing reports tab (conversion funnel, promo performance, customer cohorts, channel attribution)',
   'reports.read',
   strftime('%s','now') * 1000),
  ('reports.read.site_coordinator',
   'reports',
   'View Site Coordinator reports tab (field rental revenue by site, COI compliance, lead-to-booking, recurrence retention)',
   'reports.read',
   strftime('%s','now') * 1000),
  ('reports.export',
   'reports',
   'Export reports as CSV (per-report Export button)',
   'reports.read',
   strftime('%s','now') * 1000);

-- Role preset bundles per docs/m7-discovery/reports-scope.md.
-- Owner gets all 6 capabilities. Bookkeeper sees Owner tab too for financial
-- overlap. Marketing manager + site coordinator see only their own tab + export.

INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  -- Owner: all reports.* + export
  ('owner',              'reports.read',                    strftime('%s','now') * 1000),
  ('owner',              'reports.read.owner',              strftime('%s','now') * 1000),
  ('owner',              'reports.read.bookkeeper',         strftime('%s','now') * 1000),
  ('owner',              'reports.read.marketing',          strftime('%s','now') * 1000),
  ('owner',              'reports.read.site_coordinator',   strftime('%s','now') * 1000),
  ('owner',              'reports.export',                  strftime('%s','now') * 1000),

  -- Bookkeeper: read + bookkeeper + owner (financial overlap) + export
  ('bookkeeper',         'reports.read',                    strftime('%s','now') * 1000),
  ('bookkeeper',         'reports.read.bookkeeper',         strftime('%s','now') * 1000),
  ('bookkeeper',         'reports.read.owner',              strftime('%s','now') * 1000),
  ('bookkeeper',         'reports.export',                  strftime('%s','now') * 1000),

  -- Marketing manager: read + marketing + export
  ('marketing_manager',  'reports.read',                    strftime('%s','now') * 1000),
  ('marketing_manager',  'reports.read.marketing',          strftime('%s','now') * 1000),
  ('marketing_manager',  'reports.export',                  strftime('%s','now') * 1000),

  -- Site coordinator: read + site_coordinator + export
  ('site_coordinator',   'reports.read',                    strftime('%s','now') * 1000),
  ('site_coordinator',   'reports.read.site_coordinator',   strftime('%s','now') * 1000),
  ('site_coordinator',   'reports.export',                  strftime('%s','now') * 1000);
