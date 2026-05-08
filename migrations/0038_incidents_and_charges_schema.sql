-- M5 Batches 14 + 16 (combined) — incidents + booking_charges schema.
--
-- Surface 5: incidents (per-event log of injuries, disputes, equipment
-- failures, weather events). Surface 5 addendum: booking_charges
-- (damage charge fast-path; Option B email-link payment in M5; Option A
-- silent off-session activates in M6).

-- ─────────────────────────────────────────────────────────────────
-- Incidents (Surface 5)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE incidents (
  id              TEXT PRIMARY KEY,                    -- inc_<random12>
  event_id        TEXT NOT NULL REFERENCES events(id),
  filed_by_person_id TEXT REFERENCES persons(id),
  filed_by_user_id TEXT REFERENCES users(id),         -- when filed by an admin not via portal
  type            TEXT NOT NULL CHECK (type IN ('injury', 'dispute', 'safety', 'equipment', 'weather', 'other')),
  severity        TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'moderate', 'serious')),
  location        TEXT,
  narrative       TEXT,                                -- free-text description
  -- Lifecycle
  filed_at        INTEGER NOT NULL,
  escalated_at    INTEGER,                             -- non-NULL when severity=serious paged the Owner
  resolved_at     INTEGER,
  resolved_by_user_id TEXT REFERENCES users(id),
  resolution_note TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_incidents_event ON incidents(event_id);
CREATE INDEX idx_incidents_severity ON incidents(severity, resolved_at);
CREATE INDEX idx_incidents_filed_by ON incidents(filed_by_person_id);

-- Persons involved (many per incident)
CREATE TABLE incident_persons (
  id              TEXT PRIMARY KEY,
  incident_id     TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  person_id       TEXT REFERENCES persons(id),
  attendee_id     TEXT REFERENCES attendees(id),
  free_text_name  TEXT,                                -- for non-system persons (spectator, etc.)
  involvement     TEXT NOT NULL CHECK (involvement IN ('victim', 'aggressor', 'witness', 'responder', 'other')),
  notes           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_incident_persons_incident ON incident_persons(incident_id);

-- Attachments (photos / voice memos / GPS)
CREATE TABLE incident_attachments (
  id              TEXT PRIMARY KEY,
  incident_id     TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('photo', 'voice_memo', 'gps_point', 'document', 'other')),
  r2_key          TEXT,                                -- 'incidents/<random>.<ext>' for blobs
  content_type    TEXT,
  bytes           INTEGER,
  gps_lat         REAL,                                -- for kind=gps_point
  gps_lng         REAL,
  notes           TEXT,
  uploaded_at     INTEGER NOT NULL
);
CREATE INDEX idx_incident_attachments_incident ON incident_attachments(incident_id);

-- ─────────────────────────────────────────────────────────────────
-- Booking charges (Surface 5 addendum — damage-charge fast-path)
-- ─────────────────────────────────────────────────────────────────
-- A pending charge created during equipment return. M5 ships Option B:
-- customer receives email with payment link. M6 activates Option A
-- (silent off-session via Stripe setup_future_usage).

CREATE TABLE booking_charges (
  id              TEXT PRIMARY KEY,                    -- bc_<random12>
  booking_id      TEXT NOT NULL REFERENCES bookings(id),
  attendee_id     TEXT REFERENCES attendees(id),
  rental_assignment_id TEXT REFERENCES rental_assignments(id),
  -- Charge details
  reason_kind     TEXT NOT NULL CHECK (reason_kind IN ('damage', 'lost', 'late_return', 'cleaning', 'other')),
  description     TEXT,
  amount_cents    INTEGER NOT NULL,
  -- Lifecycle
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'paid', 'waived', 'refunded', 'rejected')),
  -- Approval gating per Surface 5 addendum + decision register #64.
  -- Charges above the field-marshal cap require Lead Marshal review.
  approval_required INTEGER NOT NULL DEFAULT 0,
  approved_at     INTEGER,
  approved_by_user_id TEXT REFERENCES users(id),
  -- Payment (Option B: email-link)
  payment_link    TEXT,                                -- HMAC-signed magic link sent in additional_charge_notice email
  payment_link_expires_at INTEGER,
  paid_at         INTEGER,
  payment_method  TEXT,
  payment_reference TEXT,
  -- Waive / refund
  waived_at       INTEGER,
  waived_by_user_id TEXT REFERENCES users(id),
  waived_reason   TEXT,
  refunded_at     INTEGER,
  refund_reference TEXT,
  -- Audit
  created_by_person_id TEXT REFERENCES persons(id),    -- created via /event-day/equipment-return
  created_by_user_id TEXT REFERENCES users(id),        -- OR via /admin/booking-charges
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_booking_charges_booking ON booking_charges(booking_id);
CREATE INDEX idx_booking_charges_status ON booking_charges(status);
CREATE INDEX idx_booking_charges_approval ON booking_charges(approval_required, approved_at);

-- Per-role caps for damage charges (defaults seeded; Owner edits via SQL).
CREATE TABLE charge_caps_config (
  role_key        TEXT PRIMARY KEY,                    -- matches roles.key
  cap_cents       INTEGER NOT NULL,                    -- 0 = no charges allowed; -1 = unlimited
  notes           TEXT,
  updated_at      INTEGER NOT NULL
);
INSERT INTO charge_caps_config (role_key, cap_cents, notes, updated_at) VALUES
  ('field_marshal',     100_00, 'Field marshal: up to $100 without approval', strftime('%s','now') * 1000),
  ('lead_marshal',      250_00, 'Lead marshal: up to $250 without approval',  strftime('%s','now') * 1000),
  ('equipment_manager', -1,     'Equipment manager: unlimited (all charges audit-logged)', strftime('%s','now') * 1000);
