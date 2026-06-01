-- Marketing milestone B6 — marketing.* capability seed + role bindings.
--
-- Seeds the capability keys the segments / campaigns / automations routes will
-- gate on, and binds the full set to `owner` + `marketing_manager`. This lands
-- the capability INFRASTRUCTURE; the actual requireAuth → requireCapability swap
-- on those routes is a deliberate FOLLOW-UP (do it only after this migration is
-- verified on remote — swapping before would 403 owners, whose preset bindings
-- wouldn't yet include marketing.*). See docs/runbooks/marketing-deploy.md.
--
-- PRE-MIGRATION SPOT-CHECK (mirrors 0062's verified shape):
-- - capabilities columns: (key, category, description, requires_capability_key, created_at)
--   — column is `category`, NOT `scope` (D1 quirk #5).
-- - role_preset_capabilities columns: (role_preset_key, capability_key, created_at).
-- - Target presets exist: owner, marketing_manager (the latter from 0062 spot-check).
--
-- D1 quirks: no BEGIN/COMMIT; additive INSERT only.
--
-- Dependency chain: every marketing.<feature>.<action> requires marketing.read
-- (the section gate); the userHasCapability walker follows requires_capability_key.

INSERT INTO capabilities (key, category, description, requires_capability_key, created_at) VALUES
  ('marketing.read',                'marketing', 'View the Marketing section (segments / campaigns / automations)', NULL,             strftime('%s','now') * 1000),
  ('marketing.segments.read',       'marketing', 'View customer segments',                                          'marketing.read', strftime('%s','now') * 1000),
  ('marketing.segments.write',      'marketing', 'Create / edit customer segments',                                 'marketing.read', strftime('%s','now') * 1000),
  ('marketing.segments.delete',     'marketing', 'Delete customer segments',                                        'marketing.read', strftime('%s','now') * 1000),
  ('marketing.campaigns.read',      'marketing', 'View campaigns',                                                  'marketing.read', strftime('%s','now') * 1000),
  ('marketing.campaigns.write',     'marketing', 'Create / edit / send campaigns',                                  'marketing.read', strftime('%s','now') * 1000),
  ('marketing.campaigns.delete',    'marketing', 'Delete campaigns',                                                'marketing.read', strftime('%s','now') * 1000),
  ('marketing.automations.read',    'marketing', 'View automations',                                                'marketing.read', strftime('%s','now') * 1000),
  ('marketing.automations.write',   'marketing', 'Create / edit / activate automations',                            'marketing.read', strftime('%s','now') * 1000),
  ('marketing.automations.delete',  'marketing', 'Delete automations',                                              'marketing.read', strftime('%s','now') * 1000);

-- Bind the full marketing set to owner + marketing_manager.
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('owner',             'marketing.read',               strftime('%s','now') * 1000),
  ('owner',             'marketing.segments.read',      strftime('%s','now') * 1000),
  ('owner',             'marketing.segments.write',     strftime('%s','now') * 1000),
  ('owner',             'marketing.segments.delete',    strftime('%s','now') * 1000),
  ('owner',             'marketing.campaigns.read',     strftime('%s','now') * 1000),
  ('owner',             'marketing.campaigns.write',    strftime('%s','now') * 1000),
  ('owner',             'marketing.campaigns.delete',   strftime('%s','now') * 1000),
  ('owner',             'marketing.automations.read',   strftime('%s','now') * 1000),
  ('owner',             'marketing.automations.write',  strftime('%s','now') * 1000),
  ('owner',             'marketing.automations.delete', strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.read',               strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.segments.read',      strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.segments.write',     strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.segments.delete',    strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.campaigns.read',     strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.campaigns.write',    strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.campaigns.delete',   strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.automations.read',   strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.automations.write',  strftime('%s','now') * 1000),
  ('marketing_manager', 'marketing.automations.delete', strftime('%s','now') * 1000);
