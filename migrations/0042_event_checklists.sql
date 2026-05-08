-- M5 R15 — Event-day checklists schema (Surface 5).
--
-- Per the M5 prompt's checklist gap: when an event is created, the
-- worker auto-instantiates one checklist per active template. Each
-- checklist has a series of items the on-site staff tick off via the
-- /event/checklist UI. Completion timestamps are recorded server-
-- side; toggling on the frontend maps directly to a DB write.
--
-- Four tables:
--   checklist_templates       — admin-curated; one row per template
--   checklist_template_items  — canonical items within a template
--   event_checklists          — per-event instance of a template
--   event_checklist_items     — per-event-checklist item instance
--
-- The instance tables snapshot label/required/title fields at
-- instantiate time so subsequent template edits don't retroactively
-- alter the audit shape of historical event checklists.
--
-- (Avoid the literal SQL keyword "TRANSACTION" anywhere — wrangler's
-- parser keyword-scans uploaded SQL even inside comments.)

-- ─────────────────────────────────────────────────────────────────
-- Templates (admin-curated, M5 ships SQL-only management; future
-- M5+ polish batch may add an /admin/checklists CRUD page)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE checklist_templates (
  id              TEXT PRIMARY KEY,                  -- ckt_<random12>
  slug            TEXT NOT NULL UNIQUE,              -- 'pre_event_safety_brief'
  title           TEXT NOT NULL,
  description     TEXT,
  role_key        TEXT,                              -- e.g. 'lead_marshal' (or NULL = anyone)
  active          INTEGER NOT NULL DEFAULT 1,
  archived_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_checklist_templates_slug ON checklist_templates(slug);
CREATE INDEX idx_checklist_templates_active ON checklist_templates(active, archived_at);

CREATE TABLE checklist_template_items (
  id              TEXT PRIMARY KEY,                  -- cti_<random12>
  template_id     TEXT NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  label           TEXT NOT NULL,
  description     TEXT,
  required        INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_checklist_template_items_template ON checklist_template_items(template_id, position);

-- ─────────────────────────────────────────────────────────────────
-- Per-event instances
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE event_checklists (
  id              TEXT PRIMARY KEY,                  -- echk_<random12>
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  template_id     TEXT NOT NULL REFERENCES checklist_templates(id),
  slug            TEXT NOT NULL,                     -- denormalized for display
  title           TEXT NOT NULL,                     -- snapshot at instantiate
  role_key        TEXT,                              -- snapshot at instantiate
  completed_at    INTEGER,
  completed_by_person_id TEXT REFERENCES persons(id),
  created_at      INTEGER NOT NULL,
  UNIQUE(event_id, slug)
);
CREATE INDEX idx_event_checklists_event ON event_checklists(event_id);
CREATE INDEX idx_event_checklists_completed ON event_checklists(event_id, completed_at);

CREATE TABLE event_checklist_items (
  id              TEXT PRIMARY KEY,                  -- echki_<random12>
  event_checklist_id TEXT NOT NULL REFERENCES event_checklists(id) ON DELETE CASCADE,
  template_item_id TEXT REFERENCES checklist_template_items(id),
  position        INTEGER NOT NULL DEFAULT 0,
  label           TEXT NOT NULL,                     -- snapshot at instantiate
  required        INTEGER NOT NULL DEFAULT 1,
  done_at         INTEGER,
  done_by_person_id TEXT REFERENCES persons(id),
  notes           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_event_checklist_items_checklist ON event_checklist_items(event_checklist_id, position);
CREATE INDEX idx_event_checklist_items_done ON event_checklist_items(event_checklist_id, done_at);

-- ─────────────────────────────────────────────────────────────────
-- Default template seed (3 templates, 4 items each)
-- ─────────────────────────────────────────────────────────────────

INSERT INTO checklist_templates (id, slug, title, description, role_key, active, created_at, updated_at) VALUES
  ('ckt_pre_evt_safety',  'pre_event_safety_brief', 'Pre-event safety brief',
   'Lead Marshal must complete before first game. Covers chronograph, hazards, briefing.',
   'lead_marshal', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('ckt_medic_setup',     'medic_station_setup',    'Medic station setup',
   'Safety Marshal completes pre-event. AED, stocked kit, hospital contact.',
   'safety_marshal', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('ckt_marshal_signin',  'marshal_signin',         'Marshal sign-in + radio test',
   'Any marshal can complete. Confirms team is on-deck before doors open.',
   NULL, 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT INTO checklist_template_items (id, template_id, position, label, description, required, created_at) VALUES
  -- pre_event_safety_brief items
  ('cti_safety_brief',  'ckt_pre_evt_safety',  10, 'Pre-event safety briefing delivered to all players', NULL, 1, strftime('%s','now') * 1000),
  ('cti_chrono',        'ckt_pre_evt_safety',  20, 'Chronograph station set up + tested', NULL, 1, strftime('%s','now') * 1000),
  ('cti_hazards',       'ckt_pre_evt_safety',  30, 'Field hazards walked + flagged', NULL, 1, strftime('%s','now') * 1000),
  ('cti_med_active',    'ckt_pre_evt_safety',  40, 'Medic station confirmed active', NULL, 1, strftime('%s','now') * 1000),

  -- medic_station_setup items
  ('cti_kit_stock',     'ckt_medic_setup',     10, 'Medic kit fully stocked', NULL, 1, strftime('%s','now') * 1000),
  ('cti_aed_battery',   'ckt_medic_setup',     20, 'AED battery checked + spare on hand', NULL, 1, strftime('%s','now') * 1000),
  ('cti_hospital',      'ckt_medic_setup',     30, 'Nearest hospital contact + GPS coords saved', NULL, 1, strftime('%s','now') * 1000),
  ('cti_weather',       'ckt_medic_setup',     40, 'Weather forecast reviewed for the day', NULL, 0, strftime('%s','now') * 1000),

  -- marshal_signin items
  ('cti_marshal_chk',   'ckt_marshal_signin',  10, 'All marshals checked in', NULL, 1, strftime('%s','now') * 1000),
  ('cti_radios',        'ckt_marshal_signin',  20, 'Radios tested across all channels', NULL, 1, strftime('%s','now') * 1000),
  ('cti_roe',           'ckt_marshal_signin',  30, 'Rules-of-Engagement handouts distributed', NULL, 1, strftime('%s','now') * 1000),
  ('cti_lookouts',      'ckt_marshal_signin',  40, 'Field lookouts assigned', NULL, 1, strftime('%s','now') * 1000);
