-- M5 Batch 3 — seed the 22 position-role catalog from
-- docs/staff-job-descriptions.md. These are the role rows referenced by:
--   - person_roles (Batch 3 backfill assigns primary roles)
--   - staff_documents.primary_role_id (Batch 5 JD import links 22 JDs)
--   - staff_document_roles (multi-role doc tagging)
--
-- IDs are deterministic (role_<key>) so the backfill script + JD import
-- can refer to them by string without a lookup query. key is also unique
-- (UNIQUE constraint on roles.key from migration 0030).
--
-- Tier breakdown per the JD doc preamble:
--   Tier 1 — Primary admin (full dashboard, desktop)         | roles 1-5
--   Tier 2 — Operational specialists (scoped)                | roles 6-10
--   Tier 3 — Event-day field (mobile/tablet kiosk)           | roles 11-17
--   Tier 4 — Occasional / pass-through (magic-link / none)   | roles 18-22

INSERT INTO roles (id, key, name, description, tier, department, active, created_at, updated_at) VALUES
  ('role_event_director',     'event_director',     'Event Director / Operations Manager', 'Owns the entire event day from setup through pack-out. Final say on safety, weather, marshal disputes.', 1, 'Operations', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_booking_coordinator','booking_coordinator','Booking / Customer Service Coordinator', 'Customer-facing inbox + walk-up creation + booking edits. Primary BC persona.',                       1, 'Customer Service', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_marketing_manager',  'marketing_manager',  'Marketing / Social Media Manager',     'Public site copy, social, email campaigns, asset library.',                                              1, 'Marketing', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_bookkeeper',         'bookkeeper',         'Bookkeeper / Finance Coordinator',     'Reconciliation, refunds, 1099 thresholds, year-end close.',                                              1, 'Finance', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_hr_coordinator',     'hr_coordinator',     'HR Coordinator',                       'Hiring, onboarding, certifications, labor disputes.',                                                    1, 'HR', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('role_equipment_manager',  'equipment_manager',  'Equipment / Rental Manager',           'Inventory of rental gear, repairs, damage charges.',                                                     2, 'Operations', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_game_designer',      'game_designer',      'Game Designer / Scenario Writer',      'Designs milsim scenarios + objective sheets + game-master notes.',                                       2, 'Operations', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_site_coordinator',   'site_coordinator',   'Site Coordinator / Permits Manager',   'Site access negotiation, permits with Carbon County Sheriff, hospital notifications.',                   2, 'Operations', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_compliance_reviewer','compliance_reviewer','Compliance / Waiver Reviewer',         'Versioned waiver + vendor agreement review. Insurance integration.',                                     2, 'Legal/Compliance', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_read_only_auditor',  'read_only_auditor',  'Read-only Auditor',                    'External auditor / accountant / counsel — read-only access for review.',                                 2, 'External', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('role_check_in_staff',     'check_in_staff',     'Check-In / Registration Staff',        'Front-of-house at events: scan tickets, walk-up bookings, basic roster lookup.',                         3, 'Field Crew', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_lead_marshal',       'lead_marshal',       'Lead Marshal / Head Referee',          'On-site referee leadership; final on-field calls; check-in override authority.',                          3, 'Field Crew', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_field_marshal',      'field_marshal',      'Field Marshal',                        'Rovers during gameplay; enforce ROE; call hits and adjudicate disputes.',                                3, 'Field Crew', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_safety_officer',     'safety_officer',     'Safety Officer / Chronograph Operator','Pre-game chrono of every weapon. Fail = no play. Manages safe zones during events.',                     3, 'Field Crew', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_event_emt',          'event_emt',          'Event EMT / Medic',                    'Onsite first responder. CPR/First Aid certified minimum; EMT preferred.',                                3, 'Field Crew', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_event_photographer', 'event_photographer', 'Event Media / Photographer',           'Captures hero shots + post-event highlight reel + social content.',                                      3, 'Field Crew', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_setup_teardown',     'setup_teardown',     'Setup / Teardown Crew',                'Pre-event field prep + post-event cleanup. Often paid per-event.',                                       3, 'Field Crew', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('role_vendor_coordinator', 'vendor_coordinator', 'Vendor / Sponsor Coordinator',         'Manages food trucks + sponsor packages + on-site vendor logistics.',                                     4, 'External', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_junior_field_designer','junior_field_designer','Junior Field Designer / Construction','Builds + maintains physical bunkers, props, set pieces between events.',                              4, 'Operations', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_graphic_designer',   'graphic_designer',   'Graphic Designer',                     'Posters, social graphics, event branding. Contract per-project.',                                        4, 'Marketing', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_insurance_broker',   'insurance_broker',   'Insurance Broker',                     'External — manages liability + property + worker comp policies.',                                        4, 'External', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('role_attorney',           'attorney',           'Attorney',                             'External counsel for contracts, incidents, disputes.',                                                   4, 'External', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000);
