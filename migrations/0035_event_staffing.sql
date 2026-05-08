-- M5 Batch 9 — Per-event staffing schema (Surface 4b).
--
-- Tracks which persons are assigned to which events in which roles, plus
-- RSVP state, no-show tracking, and per-event staffing notes.
--
-- D1 quirks honored: additive, no rebuilds, no BEGIN/COMMIT keywords.

CREATE TABLE event_staffing (
  id              TEXT PRIMARY KEY,                    -- es_<random12>
  event_id        TEXT NOT NULL REFERENCES events(id),
  person_id       TEXT NOT NULL REFERENCES persons(id),
  role_id         TEXT NOT NULL REFERENCES roles(id),
  -- RSVP lifecycle
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'declined', 'no_show', 'completed')),
  -- Compensation snapshot at-assignment time
  pay_kind        TEXT CHECK (pay_kind IN ('w2_hourly', '1099_per_event', '1099_hourly', 'volunteer', 'comp')),
  pay_rate_cents  INTEGER,
  shift_start_at  INTEGER,                              -- ms
  shift_end_at    INTEGER,
  notes           TEXT,
  -- RSVP timestamps
  invited_at      INTEGER,
  responded_at    INTEGER,
  no_show_at      INTEGER,                              -- non-NULL when marked no-show post-event
  completed_at    INTEGER,
  -- Audit
  invited_by_user_id TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(event_id, person_id, role_id)
);
CREATE INDEX idx_event_staffing_event ON event_staffing(event_id);
CREATE INDEX idx_event_staffing_person ON event_staffing(person_id);
CREATE INDEX idx_event_staffing_status ON event_staffing(status);

-- Reminder cron sentinel columns: track when the 7d/3d/1d reminder
-- emails were sent so the sweep doesn't double-fire.
CREATE TABLE event_staffing_reminders (
  id              TEXT PRIMARY KEY,
  event_staffing_id TEXT NOT NULL REFERENCES event_staffing(id) ON DELETE CASCADE,
  window_label    TEXT NOT NULL CHECK (window_label IN ('7d', '3d', '1d', 'day_of')),
  sent_at         INTEGER NOT NULL,
  result          TEXT NOT NULL DEFAULT 'sent' CHECK (result IN ('sent', 'skipped', 'failed')),
  UNIQUE(event_staffing_id, window_label)
);
CREATE INDEX idx_esr_es ON event_staffing_reminders(event_staffing_id);
