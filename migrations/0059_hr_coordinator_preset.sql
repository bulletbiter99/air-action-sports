-- 0059_hr_coordinator_preset.sql
-- HR Coordinator role_preset — tier 2 specialized role for HR / people-ops.
--
-- Grants the minimum capability set needed to onboard and manage staff:
--   staff.read    — list / view staff profiles (existing cap, seeded in 0031)
--   staff.write   — edit staff profiles                (existing cap, seeded in 0031)
--   staff.invite  — send portal invites + create staff (existing cap, seeded in 0031)
--
-- No user assignment in this migration. When hiring an HR person, operator runs:
--   UPDATE users SET role_preset_key='hr_coordinator' WHERE email='<hr-email>';
--
-- Per docs/next-session.md Track B. Resolves the documented gap from
-- post-M5.5 work where the operator flagged HR access as a future need.

INSERT INTO role_presets (key, name, description, tier, is_legacy, created_at) VALUES
  ('hr_coordinator',
   'HR Coordinator',
   'Manages staff onboarding and people-ops: list / edit staff profiles, send portal invites. Minimal scope by design — operator adds caps via SQL if HR needs broader access.',
   2,
   0,
   strftime('%s','now') * 1000);

INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('hr_coordinator', 'staff.read',   strftime('%s','now') * 1000),
  ('hr_coordinator', 'staff.write',  strftime('%s','now') * 1000),
  ('hr_coordinator', 'staff.invite', strftime('%s','now') * 1000);
