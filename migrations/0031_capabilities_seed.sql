-- M5 Batch 2 — Capability-based RBAC schema + seeds.
--
-- Replaces the M4 `worker/lib/capabilities.js` stub with a DB-backed
-- model. Adds 4 new tables + 1 column on users, then seeds:
--   - ~75 capabilities across 9 categories
--   - 10 role_presets (owner / event_director / booking_coordinator /
--     marketing_manager / bookkeeper / event_day_lead_marshal /
--     event_day_check_in / compliance_reviewer / read_only_auditor /
--     staff_legacy)
--   - role_preset_capabilities bundle (~280 INSERTs)
--
-- Backward compatibility: the legacy `users.role` enum stays. Users with
-- `role_preset_key=NULL` fall back to the legacy role mapping inside
-- `worker/lib/capabilities.js`. By M5 close, all users will be assigned
-- an explicit role_preset_key (M5 Batch 3 backfill).
--
-- D1 quirks honored:
--   - No BEGIN / COMMIT keywords (the parser rejects the literal
--     control-statement keyword, including in comments — see CLAUDE.md
--     M3-quirk subsection)
--   - Additive only; no table rebuilds
--   - FK ordering: capabilities -> role_presets -> role_preset_capabilities
--     -> user_capability_overrides

-- ─────────────────────────────────────────────────────────────────
-- 1. Schema
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE capabilities (
  key                    TEXT PRIMARY KEY,
  category               TEXT NOT NULL,
  description            TEXT NOT NULL,
  requires_capability_key TEXT REFERENCES capabilities(key),
  created_at             INTEGER NOT NULL
);
CREATE INDEX idx_capabilities_category ON capabilities(category);

CREATE TABLE role_presets (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  tier        INTEGER CHECK (tier IN (1, 2, 3, 4)),
  is_legacy   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_role_presets_tier ON role_presets(tier);

CREATE TABLE role_preset_capabilities (
  role_preset_key TEXT NOT NULL REFERENCES role_presets(key) ON DELETE CASCADE,
  capability_key  TEXT NOT NULL REFERENCES capabilities(key) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (role_preset_key, capability_key)
);
CREATE INDEX idx_rpc_capability ON role_preset_capabilities(capability_key);

CREATE TABLE user_capability_overrides (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability_key     TEXT NOT NULL REFERENCES capabilities(key) ON DELETE CASCADE,
  granted            INTEGER NOT NULL CHECK (granted IN (0, 1)),
  reason             TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, capability_key)
);
CREATE INDEX idx_uco_user ON user_capability_overrides(user_id);

ALTER TABLE users ADD COLUMN role_preset_key TEXT REFERENCES role_presets(key);
CREATE INDEX idx_users_role_preset ON users(role_preset_key);

-- ─────────────────────────────────────────────────────────────────
-- 2. Capabilities seed
-- ─────────────────────────────────────────────────────────────────

-- M4 booking capabilities (preserved from the M4 stub)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('bookings.read.pii',         'bookings', 'See full email + phone on booking detail',                              strftime('%s','now') * 1000),
  ('bookings.email',            'bookings', 'Resend booking confirmation / waiver request emails',                   strftime('%s','now') * 1000),
  ('bookings.export',           'bookings', 'CSV export of booking filter result',                                   strftime('%s','now') * 1000),
  ('bookings.refund',           'bookings', 'Stripe refund (gateway path)',                                          strftime('%s','now') * 1000),
  ('bookings.refund.external',  'bookings', 'Out-of-band refund (cash/venmo/paypal/comp/waived)',                    strftime('%s','now') * 1000);

-- M5 staff directory capabilities (Surface 4a)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('staff.read',                       'staff', 'View staff directory list + persons detail (PII masked)',                 strftime('%s','now') * 1000),
  ('staff.read.pii',                   'staff', 'Unmask email / phone / mailing address on persons detail',                strftime('%s','now') * 1000),
  ('staff.read.compensation',          'staff', 'View compensation kind + rate on persons detail',                         strftime('%s','now') * 1000),
  ('staff.write',                      'staff', 'Create / edit persons records',                                           strftime('%s','now') * 1000),
  ('staff.archive',                    'staff', 'Soft-archive a person record',                                            strftime('%s','now') * 1000),
  ('staff.notes.read_sensitive',       'staff', 'Read notes_sensitive (HR-eyes-only notes) field',                         strftime('%s','now') * 1000),
  ('staff.notes.write_sensitive',      'staff', 'Edit notes_sensitive field',                                              strftime('%s','now') * 1000),
  ('staff.role.assign',                'staff', 'Assign or change a person role (M5 person_roles table)',                  strftime('%s','now') * 1000),
  ('staff.documents.read',             'staff', 'View staff document library (JD/SOP/Checklist/Policy/Training)',          strftime('%s','now') * 1000),
  ('staff.documents.write',            'staff', 'Create / edit / retire staff documents',                                  strftime('%s','now') * 1000),
  ('staff.documents.assign',           'staff', 'Assign a document to a role (staff_document_roles)',                      strftime('%s','now') * 1000),
  ('staff.invite',                     'staff', 'Invite a Tier 3 person to the light-access portal',                       strftime('%s','now') * 1000);

-- M5 staff certifications + 1099 thresholds + scheduling + labor (Surface 4b)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('staff.certifications.read',         'staff_4b', 'View certifications on staff detail (PII masked)',                     strftime('%s','now') * 1000),
  ('staff.certifications.read_pii',     'staff_4b', 'Unmask cert numbers + issuing authority detail',                       strftime('%s','now') * 1000),
  ('staff.certifications.write',        'staff_4b', 'Add / edit / mark renewed certifications',                             strftime('%s','now') * 1000),
  ('staff.events.read',                 'staff_4b', 'View per-event staffing assignments',                                  strftime('%s','now') * 1000),
  ('staff.events.assign',               'staff_4b', 'Assign / unassign staff to event slots',                               strftime('%s','now') * 1000),
  ('staff.events.mark_no_show',         'staff_4b', 'Mark a person as no-show post-event',                                  strftime('%s','now') * 1000),
  ('staff.schedule.read',               'staff_4b', 'View Schedule & Pay tab on staff detail',                              strftime('%s','now') * 1000),
  ('staff.schedule.read.own',           'staff_4b', 'View own Schedule & Pay tab in /portal',                               strftime('%s','now') * 1000),
  ('staff.schedule.write',              'staff_4b', 'Create / edit labor entries',                                          strftime('%s','now') * 1000),
  ('staff.schedule.mark_paid',          'staff_4b', 'Mark labor entry as paid',                                             strftime('%s','now') * 1000),
  ('staff.schedule.dispute_resolve',    'staff_4b', 'Resolve a labor entry dispute',                                        strftime('%s','now') * 1000),
  ('staff.thresholds_1099.read',        'staff_4b', 'View /admin/staff/1099-thresholds rollup',                             strftime('%s','now') * 1000),
  ('staff.thresholds_1099.export',      'staff_4b', 'Export 1099 threshold report (CSV / IRS-format)',                      strftime('%s','now') * 1000),
  ('staff.thresholds_1099.lock_year',   'staff_4b', 'Lock a tax year (no further labor entries on closed year)',            strftime('%s','now') * 1000);

-- Light-access portal (Surface 4a part 4 / Tier 3 scope)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('portal.access',                'portal', 'Sign in to /portal/* (separate from /admin)',                          strftime('%s','now') * 1000),
  ('portal.documents.read',        'portal', 'View portal-side document library (role-tagged)',                     strftime('%s','now') * 1000),
  ('portal.documents.acknowledge', 'portal', 'Sign acknowledgments on policy / SOP docs',                           strftime('%s','now') * 1000),
  ('portal.account.read',          'portal', 'View own account info in /portal',                                    strftime('%s','now') * 1000),
  ('portal.account.write',         'portal', 'Edit own account info in /portal (name, phone, mailing address)',     strftime('%s','now') * 1000);

-- Event-day mode (Surface 5)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('event_day.scan_checkin',                    'event_day', 'Use scan check-in screen at /event/check-in',                strftime('%s','now') * 1000),
  ('event_day.checkin.bypass_waiver',           'event_day', 'Override missing-waiver block on check-in (Lead Marshal)',   strftime('%s','now') * 1000),
  ('event_day.roster.read',                     'event_day', 'View roster lookup screen at /event/roster',                  strftime('%s','now') * 1000),
  ('event_day.roster.read_medical',             'event_day', 'See medical conditions on roster lookup',                     strftime('%s','now') * 1000),
  ('event_day.incident.create',                 'event_day', 'File an incident report at /event/incident',                  strftime('%s','now') * 1000),
  ('event_day.incident.escalate_serious',       'event_day', 'Mark incident as serious (auto-pages Owner)',                 strftime('%s','now') * 1000),
  ('event_day.equipment.return',                'event_day', 'Use equipment return screen at /event/equipment-return',      strftime('%s','now') * 1000),
  ('event_day.checklist.complete',              'event_day', 'Tick off event-day checklist items',                          strftime('%s','now') * 1000),
  ('event_day.hq_dashboard',                    'event_day', 'Access /event/hq dashboard (Lead Marshal / Event Director)',  strftime('%s','now') * 1000),
  ('event_day.walkup.create_booking',           'event_day', 'Create walk-up booking from /event',                          strftime('%s','now') * 1000),
  ('event_day.rental.damage_charge_create',     'event_day', 'File damage charge from equipment return (with cap)',          strftime('%s','now') * 1000);

-- Booking charges (Surface 5 addendum)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('bookings.charges.read',     'bookings_charges', 'View booking_charges on booking detail',                  strftime('%s','now') * 1000),
  ('bookings.charges.create',   'bookings_charges', 'Create a new charge (admin path; event-day path has its own)', strftime('%s','now') * 1000),
  ('bookings.charges.waive',    'bookings_charges', 'Waive a pending charge (no payment expected)',            strftime('%s','now') * 1000),
  ('bookings.charges.refund',   'bookings_charges', 'Refund a paid charge',                                    strftime('%s','now') * 1000);

-- Customers (M3 entity, formalized)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('customers.read',                  'customers', 'View customers list + detail',                                  strftime('%s','now') * 1000),
  ('customers.write',                 'customers', 'Edit customer fields (name, email, phone, notes)',              strftime('%s','now') * 1000),
  ('customers.merge',                 'customers', 'Merge two customer records',                                    strftime('%s','now') * 1000),
  ('customers.gdpr_delete',           'customers', 'GDPR-delete a customer (soft-archive + redact)',                strftime('%s','now') * 1000),
  ('customers.read.business_fields',  'customers', 'Unmask EIN / legal_name / billing_contact (Surface 7)',         strftime('%s','now') * 1000),
  ('customers.write.business_fields', 'customers', 'Edit B2B fields on customer detail',                            strftime('%s','now') * 1000);

-- Sidebar nav (M5 B0 stub formalized)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('rentals.read',  'navigation', 'View Rentals nav item + admin rentals UI',  strftime('%s','now') * 1000),
  ('roster.read',   'navigation', 'View Roster nav item + admin roster UI',    strftime('%s','now') * 1000),
  ('scan.use',      'navigation', 'View Scan nav item + admin scanner UI',     strftime('%s','now') * 1000);

-- Surface 7 field rentals (M5.5 territory; seeded now so M5.5 only ships UI)
INSERT INTO capabilities (key, category, description, created_at) VALUES
  ('sites.read',                                'field_rentals', 'View sites directory + detail',                                       strftime('%s','now') * 1000),
  ('sites.write',                               'field_rentals', 'Create / edit site records + fields + blackouts',                    strftime('%s','now') * 1000),
  ('sites.archive',                             'field_rentals', 'Archive a site (refuses if upcoming bookings)',                      strftime('%s','now') * 1000),
  ('field_rentals.read',                        'field_rentals', 'List + detail rentals (PII + financials masked unless granted)',     strftime('%s','now') * 1000),
  ('field_rentals.read.pii',                    'field_rentals', 'Unmask renter contact email/phone + notes_sensitive',                strftime('%s','now') * 1000),
  ('field_rentals.read.financials',             'field_rentals', 'View invoice + payment status + refund detail',                      strftime('%s','now') * 1000),
  ('field_rentals.create',                      'field_rentals', 'New rental flow',                                                    strftime('%s','now') * 1000),
  ('field_rentals.create.bypass_conflict',      'field_rentals', 'Override field-rental conflict detection (Owner-only)',              strftime('%s','now') * 1000),
  ('field_rentals.write',                       'field_rentals', 'Edit existing rental (notes / contacts / pre-agreement schedule)',   strftime('%s','now') * 1000),
  ('field_rentals.cancel',                      'field_rentals', 'Cancel a rental with refund per policy',                             strftime('%s','now') * 1000),
  ('field_rentals.refund',                      'field_rentals', 'Issue Stripe refund or record out-of-band refund',                   strftime('%s','now') * 1000),
  ('field_rentals.reschedule',                  'field_rentals', 'Move occurrences (re-runs conflict detection)',                      strftime('%s','now') * 1000),
  ('field_rental_agreements.read',              'field_rentals', 'View agreement library + per-rental signed copies',                  strftime('%s','now') * 1000),
  ('field_rental_agreements.write',             'field_rentals', 'Create new agreement version (Owner-only)',                          strftime('%s','now') * 1000),
  ('field_rental_agreements.send',              'field_rentals', 'Send agreement to renter for signing',                               strftime('%s','now') * 1000),
  ('field_rental_agreements.countersign',       'field_rentals', 'Countersign signed agreement (Owner-only)',                          strftime('%s','now') * 1000),
  ('field_rental_agreements.retire',            'field_rentals', 'Retire an old agreement version',                                    strftime('%s','now') * 1000),
  ('field_rentals.reports.read',                'field_rentals', 'View bookkeeper rollups (revenue by client/month/site)',             strftime('%s','now') * 1000),
  ('field_rentals.reports.export',              'field_rentals', 'Export rollup as CSV',                                               strftime('%s','now') * 1000);

-- Capability dependency wiring (capability X requires capability Y)
UPDATE capabilities SET requires_capability_key = 'staff.read' WHERE key IN (
  'staff.read.pii', 'staff.read.compensation', 'staff.notes.read_sensitive',
  'staff.notes.write_sensitive', 'staff.role.assign', 'staff.archive', 'staff.invite',
  'staff.certifications.read', 'staff.events.read', 'staff.schedule.read',
  'staff.thresholds_1099.read', 'staff.documents.assign'
);
UPDATE capabilities SET requires_capability_key = 'staff.write' WHERE key IN (
  'staff.role.assign'
);
UPDATE capabilities SET requires_capability_key = 'staff.documents.read' WHERE key IN (
  'staff.documents.write', 'staff.documents.assign'
);
UPDATE capabilities SET requires_capability_key = 'staff.certifications.read' WHERE key IN (
  'staff.certifications.read_pii', 'staff.certifications.write'
);
UPDATE capabilities SET requires_capability_key = 'staff.events.read' WHERE key IN (
  'staff.events.assign', 'staff.events.mark_no_show'
);
UPDATE capabilities SET requires_capability_key = 'staff.schedule.read' WHERE key IN (
  'staff.schedule.write', 'staff.schedule.mark_paid', 'staff.schedule.dispute_resolve'
);
UPDATE capabilities SET requires_capability_key = 'staff.thresholds_1099.read' WHERE key IN (
  'staff.thresholds_1099.export', 'staff.thresholds_1099.lock_year'
);
UPDATE capabilities SET requires_capability_key = 'portal.access' WHERE key IN (
  'portal.documents.read', 'portal.documents.acknowledge', 'portal.account.read', 'portal.account.write'
);
UPDATE capabilities SET requires_capability_key = 'portal.documents.read' WHERE key IN (
  'portal.documents.acknowledge'
);
UPDATE capabilities SET requires_capability_key = 'portal.account.read' WHERE key IN (
  'portal.account.write'
);
UPDATE capabilities SET requires_capability_key = 'event_day.roster.read' WHERE key IN (
  'event_day.roster.read_medical'
);
UPDATE capabilities SET requires_capability_key = 'event_day.incident.create' WHERE key IN (
  'event_day.incident.escalate_serious'
);
UPDATE capabilities SET requires_capability_key = 'bookings.charges.read' WHERE key IN (
  'bookings.charges.create', 'bookings.charges.waive', 'bookings.charges.refund'
);
UPDATE capabilities SET requires_capability_key = 'customers.read' WHERE key IN (
  'customers.write', 'customers.merge', 'customers.gdpr_delete', 'customers.read.business_fields'
);
UPDATE capabilities SET requires_capability_key = 'customers.read.business_fields' WHERE key IN (
  'customers.write.business_fields'
);
UPDATE capabilities SET requires_capability_key = 'sites.read' WHERE key IN (
  'sites.write', 'sites.archive'
);
UPDATE capabilities SET requires_capability_key = 'field_rentals.read' WHERE key IN (
  'field_rentals.read.pii', 'field_rentals.read.financials', 'field_rentals.create',
  'field_rentals.write', 'field_rentals.cancel', 'field_rentals.reschedule'
);
UPDATE capabilities SET requires_capability_key = 'field_rentals.create' WHERE key IN (
  'field_rentals.create.bypass_conflict'
);
UPDATE capabilities SET requires_capability_key = 'field_rentals.read.financials' WHERE key IN (
  'field_rentals.refund'
);
UPDATE capabilities SET requires_capability_key = 'field_rental_agreements.read' WHERE key IN (
  'field_rental_agreements.write', 'field_rental_agreements.send', 'field_rental_agreements.retire'
);
UPDATE capabilities SET requires_capability_key = 'field_rental_agreements.send' WHERE key IN (
  'field_rental_agreements.countersign'
);
UPDATE capabilities SET requires_capability_key = 'field_rentals.reports.read' WHERE key IN (
  'field_rentals.reports.export'
);

-- ─────────────────────────────────────────────────────────────────
-- 3. Role presets seed
-- ─────────────────────────────────────────────────────────────────

INSERT INTO role_presets (key, name, description, tier, is_legacy, created_at) VALUES
  ('owner',                   'Owner',                   'Full access. Owner of the org. All capabilities.', 1, 0, strftime('%s','now') * 1000),
  ('event_director',          'Event Director',          'Operations Manager / Event Director. Tier 1 ops, full ops.', 1, 0, strftime('%s','now') * 1000),
  ('booking_coordinator',     'Booking Coordinator',     'Tier 1 BC. Bookings + customers + walk-up.', 1, 0, strftime('%s','now') * 1000),
  ('marketing_manager',       'Marketing Manager',       'Tier 1 Marketing. Read-mostly + email send.', 1, 0, strftime('%s','now') * 1000),
  ('bookkeeper',              'Bookkeeper',              'Tier 1 Bookkeeper. Financial focus.', 1, 0, strftime('%s','now') * 1000),
  ('event_day_lead_marshal',  'Lead Marshal',            'Tier 3 senior field. Event-day HQ + checkin override.', 3, 0, strftime('%s','now') * 1000),
  ('event_day_check_in',      'Check-in Staff',          'Tier 3 check-in. Scan + roster + walk-up basics.', 3, 0, strftime('%s','now') * 1000),
  ('compliance_reviewer',     'Compliance Reviewer',     'Tier 2 doc-review. Waivers + agreements + audit log.', 2, 0, strftime('%s','now') * 1000),
  ('read_only_auditor',       'Read-only Auditor',       'Read access across the system; no write capabilities.', 2, 0, strftime('%s','now') * 1000),
  ('staff_legacy',            'Staff (legacy)',          'Pre-M5 users.role=staff backward-compat preset. Map M5+ users to a richer preset.', 4, 1, strftime('%s','now') * 1000);

-- ─────────────────────────────────────────────────────────────────
-- 4. Role-preset capability bundle
-- ─────────────────────────────────────────────────────────────────

-- Owner: every capability seeded above.
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at)
  SELECT 'owner', key, strftime('%s','now') * 1000 FROM capabilities;

-- Event Director: full ops, full staff, full event-day, read+write rentals + roster + scan,
-- bookings + refunds + charges, no Owner-only countersigns.
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('event_director', 'bookings.read.pii', strftime('%s','now') * 1000),
  ('event_director', 'bookings.email', strftime('%s','now') * 1000),
  ('event_director', 'bookings.export', strftime('%s','now') * 1000),
  ('event_director', 'bookings.refund', strftime('%s','now') * 1000),
  ('event_director', 'bookings.refund.external', strftime('%s','now') * 1000),
  ('event_director', 'staff.read', strftime('%s','now') * 1000),
  ('event_director', 'staff.read.pii', strftime('%s','now') * 1000),
  ('event_director', 'staff.write', strftime('%s','now') * 1000),
  ('event_director', 'staff.role.assign', strftime('%s','now') * 1000),
  ('event_director', 'staff.archive', strftime('%s','now') * 1000),
  ('event_director', 'staff.documents.read', strftime('%s','now') * 1000),
  ('event_director', 'staff.documents.assign', strftime('%s','now') * 1000),
  ('event_director', 'staff.invite', strftime('%s','now') * 1000),
  ('event_director', 'staff.certifications.read', strftime('%s','now') * 1000),
  ('event_director', 'staff.certifications.read_pii', strftime('%s','now') * 1000),
  ('event_director', 'staff.certifications.write', strftime('%s','now') * 1000),
  ('event_director', 'staff.events.read', strftime('%s','now') * 1000),
  ('event_director', 'staff.events.assign', strftime('%s','now') * 1000),
  ('event_director', 'staff.events.mark_no_show', strftime('%s','now') * 1000),
  ('event_director', 'staff.schedule.read', strftime('%s','now') * 1000),
  ('event_director', 'staff.schedule.write', strftime('%s','now') * 1000),
  ('event_director', 'event_day.scan_checkin', strftime('%s','now') * 1000),
  ('event_director', 'event_day.checkin.bypass_waiver', strftime('%s','now') * 1000),
  ('event_director', 'event_day.roster.read', strftime('%s','now') * 1000),
  ('event_director', 'event_day.roster.read_medical', strftime('%s','now') * 1000),
  ('event_director', 'event_day.incident.create', strftime('%s','now') * 1000),
  ('event_director', 'event_day.incident.escalate_serious', strftime('%s','now') * 1000),
  ('event_director', 'event_day.equipment.return', strftime('%s','now') * 1000),
  ('event_director', 'event_day.checklist.complete', strftime('%s','now') * 1000),
  ('event_director', 'event_day.hq_dashboard', strftime('%s','now') * 1000),
  ('event_director', 'event_day.walkup.create_booking', strftime('%s','now') * 1000),
  ('event_director', 'event_day.rental.damage_charge_create', strftime('%s','now') * 1000),
  ('event_director', 'bookings.charges.read', strftime('%s','now') * 1000),
  ('event_director', 'bookings.charges.create', strftime('%s','now') * 1000),
  ('event_director', 'bookings.charges.waive', strftime('%s','now') * 1000),
  ('event_director', 'customers.read', strftime('%s','now') * 1000),
  ('event_director', 'customers.read.business_fields', strftime('%s','now') * 1000),
  ('event_director', 'customers.write', strftime('%s','now') * 1000),
  ('event_director', 'customers.merge', strftime('%s','now') * 1000),
  ('event_director', 'rentals.read', strftime('%s','now') * 1000),
  ('event_director', 'roster.read', strftime('%s','now') * 1000),
  ('event_director', 'scan.use', strftime('%s','now') * 1000),
  ('event_director', 'sites.read', strftime('%s','now') * 1000),
  ('event_director', 'sites.write', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.read', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.read.pii', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.read.financials', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.create', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.write', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.cancel', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.refund', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.reschedule', strftime('%s','now') * 1000),
  ('event_director', 'field_rental_agreements.read', strftime('%s','now') * 1000),
  ('event_director', 'field_rental_agreements.send', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.reports.read', strftime('%s','now') * 1000),
  ('event_director', 'field_rentals.reports.export', strftime('%s','now') * 1000);

-- Booking Coordinator: bookings + customers + walk-up + portal invites
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('booking_coordinator', 'bookings.read.pii', strftime('%s','now') * 1000),
  ('booking_coordinator', 'bookings.email', strftime('%s','now') * 1000),
  ('booking_coordinator', 'bookings.export', strftime('%s','now') * 1000),
  ('booking_coordinator', 'staff.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'staff.invite', strftime('%s','now') * 1000),
  ('booking_coordinator', 'staff.events.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'staff.events.assign', strftime('%s','now') * 1000),
  ('booking_coordinator', 'event_day.walkup.create_booking', strftime('%s','now') * 1000),
  ('booking_coordinator', 'customers.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'customers.write', strftime('%s','now') * 1000),
  ('booking_coordinator', 'customers.read.business_fields', strftime('%s','now') * 1000),
  ('booking_coordinator', 'customers.merge', strftime('%s','now') * 1000),
  ('booking_coordinator', 'rentals.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'roster.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'scan.use', strftime('%s','now') * 1000),
  ('booking_coordinator', 'sites.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rentals.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rentals.read.pii', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rentals.read.financials', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rentals.create', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rentals.write', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rentals.cancel', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rentals.reschedule', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rental_agreements.read', strftime('%s','now') * 1000),
  ('booking_coordinator', 'field_rental_agreements.send', strftime('%s','now') * 1000);

-- Marketing: read-mostly + email/export
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('marketing_manager', 'bookings.email', strftime('%s','now') * 1000),
  ('marketing_manager', 'bookings.export', strftime('%s','now') * 1000),
  ('marketing_manager', 'customers.read', strftime('%s','now') * 1000),
  ('marketing_manager', 'staff.read', strftime('%s','now') * 1000),
  ('marketing_manager', 'rentals.read', strftime('%s','now') * 1000),
  ('marketing_manager', 'roster.read', strftime('%s','now') * 1000),
  ('marketing_manager', 'sites.read', strftime('%s','now') * 1000),
  ('marketing_manager', 'field_rentals.read', strftime('%s','now') * 1000),
  ('marketing_manager', 'field_rentals.reports.read', strftime('%s','now') * 1000),
  ('marketing_manager', 'field_rentals.reports.export', strftime('%s','now') * 1000);

-- Bookkeeper: financial focus
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('bookkeeper', 'bookings.read.pii', strftime('%s','now') * 1000),
  ('bookkeeper', 'bookings.export', strftime('%s','now') * 1000),
  ('bookkeeper', 'bookings.refund', strftime('%s','now') * 1000),
  ('bookkeeper', 'bookings.refund.external', strftime('%s','now') * 1000),
  ('bookkeeper', 'bookings.charges.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'bookings.charges.refund', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.read.pii', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.read.compensation', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.schedule.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.schedule.write', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.schedule.mark_paid', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.schedule.dispute_resolve', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.thresholds_1099.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.thresholds_1099.export', strftime('%s','now') * 1000),
  ('bookkeeper', 'staff.thresholds_1099.lock_year', strftime('%s','now') * 1000),
  ('bookkeeper', 'customers.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'customers.read.business_fields', strftime('%s','now') * 1000),
  ('bookkeeper', 'customers.write.business_fields', strftime('%s','now') * 1000),
  ('bookkeeper', 'sites.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.read.financials', strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.refund', strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.reports.read', strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.reports.export', strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rental_agreements.read', strftime('%s','now') * 1000);

-- Lead Marshal (Tier 3): event-day full + roster medical + checkin override + HQ
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('event_day_lead_marshal', 'portal.access', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'portal.documents.read', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'portal.documents.acknowledge', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'portal.account.read', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'portal.account.write', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.scan_checkin', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.checkin.bypass_waiver', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.roster.read', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.roster.read_medical', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.incident.create', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.incident.escalate_serious', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.equipment.return', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.checklist.complete', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.hq_dashboard', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.walkup.create_booking', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'event_day.rental.damage_charge_create', strftime('%s','now') * 1000),
  ('event_day_lead_marshal', 'staff.schedule.read.own', strftime('%s','now') * 1000);

-- Check-in Staff (Tier 3): minimal — scan + roster + walk-up + portal
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('event_day_check_in', 'portal.access', strftime('%s','now') * 1000),
  ('event_day_check_in', 'portal.documents.read', strftime('%s','now') * 1000),
  ('event_day_check_in', 'portal.documents.acknowledge', strftime('%s','now') * 1000),
  ('event_day_check_in', 'portal.account.read', strftime('%s','now') * 1000),
  ('event_day_check_in', 'portal.account.write', strftime('%s','now') * 1000),
  ('event_day_check_in', 'event_day.scan_checkin', strftime('%s','now') * 1000),
  ('event_day_check_in', 'event_day.roster.read', strftime('%s','now') * 1000),
  ('event_day_check_in', 'event_day.equipment.return', strftime('%s','now') * 1000),
  ('event_day_check_in', 'event_day.walkup.create_booking', strftime('%s','now') * 1000),
  ('event_day_check_in', 'staff.schedule.read.own', strftime('%s','now') * 1000);

-- Compliance Reviewer (Tier 2): doc-review focus
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('compliance_reviewer', 'staff.read', strftime('%s','now') * 1000),
  ('compliance_reviewer', 'staff.documents.read', strftime('%s','now') * 1000),
  ('compliance_reviewer', 'staff.documents.write', strftime('%s','now') * 1000),
  ('compliance_reviewer', 'staff.documents.assign', strftime('%s','now') * 1000),
  ('compliance_reviewer', 'staff.certifications.read', strftime('%s','now') * 1000),
  ('compliance_reviewer', 'staff.certifications.write', strftime('%s','now') * 1000),
  ('compliance_reviewer', 'field_rental_agreements.read', strftime('%s','now') * 1000);

-- Read-only Auditor (Tier 2): every read capability
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('read_only_auditor', 'bookings.read.pii', strftime('%s','now') * 1000),
  ('read_only_auditor', 'bookings.charges.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'staff.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'staff.read.pii', strftime('%s','now') * 1000),
  ('read_only_auditor', 'staff.documents.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'staff.certifications.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'staff.events.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'staff.schedule.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'staff.thresholds_1099.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'customers.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'rentals.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'roster.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'scan.use', strftime('%s','now') * 1000),
  ('read_only_auditor', 'sites.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'field_rentals.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'field_rental_agreements.read', strftime('%s','now') * 1000),
  ('read_only_auditor', 'field_rentals.reports.read', strftime('%s','now') * 1000);

-- Staff (legacy): preserves the M4 stub's `staff` mapping (no capabilities).
-- Pre-M5 users who had role='staff' fall through to this preset until
-- explicitly migrated to a richer one. The preset is intentionally empty
-- so the legacy users stay locked-down until an admin upgrades them.
-- (Inserts no role_preset_capabilities rows for this preset.)
