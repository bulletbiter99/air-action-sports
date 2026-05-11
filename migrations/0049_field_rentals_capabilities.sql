-- M5.5 Batch 6 — Migration E: field rentals capabilities seed + Site Coordinator role-preset
--
-- Adds 17 new capabilities + 1 new role_preset (site_coordinator) + 45 new
-- role_preset_capabilities bindings, completing the capability inventory
-- needed for B7's field-rentals routes.
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-11; per Lesson #7)
-- ============================================================
-- Verified against production before authoring:
-- - capabilities, role_presets, role_preset_capabilities tables exist
--   (M5 staff foundation 0030)
-- - M5 already seeded 14 field_rentals/sites capabilities via 0031:
--     field_rentals.read, .read.pii, .read.financials, .write, .create,
--     .create.bypass_conflict, .cancel, .refund, .reschedule,
--     .reports.read, .reports.export
--     sites.read, .write, .archive
-- - All 4 role_presets the M5.5 prompt mentions ALREADY EXIST:
--   owner, bookkeeper, booking_coordinator, compliance_reviewer
-- - site_coordinator role_preset does NOT exist — this migration creates it
-- - Existing role_preset_capabilities bindings inventory (for field_rentals/sites):
--     owner: 14 bindings (incl. .create.bypass_conflict + sites.archive)
--     bookkeeper: 6 bindings (missing .read.pii — prompt requires it)
--     booking_coordinator: 8 bindings
--     compliance_reviewer: 0 bindings — prompt requires 5 new ones
--     event_director: 11 bindings (M5 pre-seed; not in B6 scope)
--     marketing_manager: 4 bindings (M5 pre-seed; not in B6 scope)
--     read_only_auditor: 3 bindings (M5 pre-seed; not in B6 scope)
--
-- NAMING RECONCILIATION
-- ============================================================
-- The M5.5 prompt's "field_rentals.override_conflict" capability is
-- functionally identical to the M5-seeded "field_rentals.create.bypass_conflict"
-- (both gate the conflict-override action). This migration uses the
-- existing key (.create.bypass_conflict) instead of duplicating. B7's
-- conflict-check enforcement will reference the existing key.
--
-- The prompt's "field_rentals.override_conflict" naming is documented
-- here so future readers don't search fruitlessly for that key.
--
-- DESIGN DECISIONS (operator-confirmed during B6 plan-mode)
-- ============================================================
-- 1. site_coordinator gets the 18 field-rentals/sites bindings listed
--    below. customers.read.pii + persons.read.own deferred (B7/B6.5
--    can add when route needs them).
-- 2. site_coordinator tier = 2 (manager-level, same tier as
--    event_director / bookkeeper / booking_coordinator).
--
-- CAPABILITY DEPENDENCY CHAIN (requires_capability_key column)
-- ============================================================
-- M5's requires_capability_key column lets us enforce PII gating —
-- a user with notes.write_sensitive automatically requires the
-- notes.read_sensitive capability first. The chain encoded below:
--   field_rentals.notes.read_sensitive    -> field_rentals.read.pii (existing)
--   field_rentals.notes.write_sensitive   -> field_rentals.notes.read_sensitive
--   field_rentals.send_quote              -> field_rentals.write (existing)
--   field_rentals.send_contract           -> field_rentals.write
--   field_rentals.email                   -> field_rentals.write
--   field_rentals.export                  -> field_rentals.read (existing)
--   field_rentals.archive                 -> field_rentals.write
--   field_rentals.deposit_record          -> field_rentals.write
--   field_rentals.balance_record          -> field_rentals.write
--   field_rentals.recurrence_create       -> field_rentals.create (existing)
--   field_rentals.recurrence_modify       -> field_rentals.write
--   field_rentals.recurrence_end          -> field_rentals.write
--   field_rentals.documents.read          -> field_rentals.read.pii
--   field_rentals.documents.upload        -> field_rentals.documents.read
--   field_rentals.coi.read_pii            -> field_rentals.documents.read
--   sites.blackout_create                 -> sites.write (existing)
--   events.override_conflict              -> NULL (standalone)
--
-- B7's helper walks this chain when checking capabilities and surfaces
-- the missing prereq in the 403 hint.
--
-- D1 QUIRKS OBSERVED
-- ============================================================
-- - Pure INSERT statements; no schema changes.
-- - No BEGIN/COMMIT keywords; no literal "TRANSACTION" keyword anywhere.
-- - D1 doesn't enforce FK constraints at runtime by default, but the
--   capability/role_preset/binding order in this migration is
--   dependency-correct for clarity.
-- - No email_templates seed; Lesson #7 not applicable.

-- ────────────────────────────────────────────────────────────────────
-- Block 1 — 17 new capabilities
-- ────────────────────────────────────────────────────────────────────

INSERT INTO capabilities (key, category, description, requires_capability_key, created_at) VALUES
  ('events.override_conflict',                 'events',         'Override AAS event conflict warning when creating/editing events (Owner + Operations Director)',           NULL,                                  strftime('%s','now') * 1000),

  ('field_rentals.send_quote',                 'field_rentals',  'Send a quote email to the renter pre-agreement',                                                          'field_rentals.write',                 strftime('%s','now') * 1000),
  ('field_rentals.send_contract',              'field_rentals',  'Send the site-use agreement + COI request email to the renter',                                          'field_rentals.write',                 strftime('%s','now') * 1000),
  ('field_rentals.email',                      'field_rentals',  'Send an arbitrary email to the renter from the rental detail page',                                       'field_rentals.write',                 strftime('%s','now') * 1000),
  ('field_rentals.export',                     'field_rentals',  'Export per-rental data (CSV/PDF) — distinct from existing reports.export rollup',                          'field_rentals.read',                  strftime('%s','now') * 1000),
  ('field_rentals.archive',                    'field_rentals',  'Soft-archive a completed rental (excludes from default lists; preserves history)',                        'field_rentals.write',                 strftime('%s','now') * 1000),
  ('field_rentals.deposit_record',             'field_rentals',  'Record an off-platform deposit payment (cash/check/Venmo/ACH)',                                          'field_rentals.write',                 strftime('%s','now') * 1000),
  ('field_rentals.balance_record',             'field_rentals',  'Record an off-platform balance payment',                                                                  'field_rentals.write',                 strftime('%s','now') * 1000),
  ('field_rentals.recurrence_create',          'field_rentals',  'Set up a recurring rental series (weekly / monthly / custom)',                                            'field_rentals.create',                strftime('%s','now') * 1000),
  ('field_rentals.recurrence_modify',          'field_rentals',  'Edit recurrence rules / change cadence',                                                                  'field_rentals.write',                 strftime('%s','now') * 1000),
  ('field_rentals.recurrence_end',             'field_rentals',  'End a recurring series early; future instances cancelled',                                                'field_rentals.write',                 strftime('%s','now') * 1000),

  ('field_rentals.documents.read',             'field_rentals',  'List + download field rental documents (SUA copies, COIs, addenda) — unmasks file metadata',              'field_rentals.read.pii',              strftime('%s','now') * 1000),
  ('field_rentals.documents.upload',           'field_rentals',  'Upload a new document to a rental',                                                                       'field_rentals.documents.read',        strftime('%s','now') * 1000),
  ('field_rentals.coi.read_pii',               'field_rentals',  'Unmask COI carrier name / policy number / coverage amounts on rental detail',                            'field_rentals.documents.read',        strftime('%s','now') * 1000),

  ('field_rentals.notes.read_sensitive',       'field_rentals',  'Unmask the notes_sensitive column on rental detail (PII-tier notes)',                                     'field_rentals.read.pii',              strftime('%s','now') * 1000),
  ('field_rentals.notes.write_sensitive',      'field_rentals',  'Edit notes_sensitive — requires read access first',                                                       'field_rentals.notes.read_sensitive',  strftime('%s','now') * 1000),

  ('sites.blackout_create',                    'field_rentals',  'Create site_blackouts entries (planned downtime that blocks rentals and events on the same site)',         'sites.write',                         strftime('%s','now') * 1000);

-- ────────────────────────────────────────────────────────────────────
-- Block 2 — site_coordinator role_preset (tier 2 manager-level)
-- ────────────────────────────────────────────────────────────────────

INSERT INTO role_presets (key, name, description, tier, is_legacy, created_at) VALUES
  ('site_coordinator',
   'Site Coordinator',
   'Manages field rentals end-to-end: intake / quoting / contracting / deposit + balance recording / recurrence / documents / COI. Cannot override conflicts (Owner-only).',
   2,
   0,
   strftime('%s','now') * 1000);

-- ────────────────────────────────────────────────────────────────────
-- Block 3 — 45 new role_preset_capabilities bindings
-- ────────────────────────────────────────────────────────────────────

INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  -- ─── owner: 17 new bindings (all new caps + sites.blackout_create + events.override_conflict)
  ('owner', 'events.override_conflict',                strftime('%s','now') * 1000),
  ('owner', 'field_rentals.send_quote',                strftime('%s','now') * 1000),
  ('owner', 'field_rentals.send_contract',             strftime('%s','now') * 1000),
  ('owner', 'field_rentals.email',                     strftime('%s','now') * 1000),
  ('owner', 'field_rentals.export',                    strftime('%s','now') * 1000),
  ('owner', 'field_rentals.archive',                   strftime('%s','now') * 1000),
  ('owner', 'field_rentals.deposit_record',            strftime('%s','now') * 1000),
  ('owner', 'field_rentals.balance_record',            strftime('%s','now') * 1000),
  ('owner', 'field_rentals.recurrence_create',         strftime('%s','now') * 1000),
  ('owner', 'field_rentals.recurrence_modify',         strftime('%s','now') * 1000),
  ('owner', 'field_rentals.recurrence_end',            strftime('%s','now') * 1000),
  ('owner', 'field_rentals.documents.read',            strftime('%s','now') * 1000),
  ('owner', 'field_rentals.documents.upload',          strftime('%s','now') * 1000),
  ('owner', 'field_rentals.coi.read_pii',              strftime('%s','now') * 1000),
  ('owner', 'field_rentals.notes.read_sensitive',      strftime('%s','now') * 1000),
  ('owner', 'field_rentals.notes.write_sensitive',     strftime('%s','now') * 1000),
  ('owner', 'sites.blackout_create',                   strftime('%s','now') * 1000),

  -- ─── bookkeeper: 5 new bindings (existing .read.pii not yet linked + 4 new caps)
  ('bookkeeper', 'field_rentals.read.pii',             strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.export',               strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.deposit_record',       strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.balance_record',       strftime('%s','now') * 1000),
  ('bookkeeper', 'field_rentals.documents.read',       strftime('%s','now') * 1000),

  -- ─── compliance_reviewer: 5 new bindings (had no field_rentals/sites bindings yet)
  ('compliance_reviewer', 'field_rentals.read',                  strftime('%s','now') * 1000),
  ('compliance_reviewer', 'field_rentals.read.pii',              strftime('%s','now') * 1000),
  ('compliance_reviewer', 'field_rentals.notes.read_sensitive',  strftime('%s','now') * 1000),
  ('compliance_reviewer', 'field_rentals.documents.read',        strftime('%s','now') * 1000),
  ('compliance_reviewer', 'field_rentals.coi.read_pii',          strftime('%s','now') * 1000),

  -- ─── site_coordinator: 18 new bindings (full bundle for the new role)
  ('site_coordinator', 'field_rentals.read',                     strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.write',                    strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.create',                   strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.cancel',                   strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.send_quote',               strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.send_contract',            strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.email',                    strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.export',                   strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.archive',                  strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.deposit_record',           strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.balance_record',           strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.recurrence_create',        strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.recurrence_modify',        strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.recurrence_end',           strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.documents.read',           strftime('%s','now') * 1000),
  ('site_coordinator', 'field_rentals.documents.upload',         strftime('%s','now') * 1000),
  ('site_coordinator', 'sites.read',                             strftime('%s','now') * 1000),
  ('site_coordinator', 'sites.blackout_create',                  strftime('%s','now') * 1000);
