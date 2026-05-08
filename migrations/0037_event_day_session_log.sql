-- M5 Batch 12 — event-day session log (Surface 5).
--
-- Event-day reuses the portal_sessions magic-link mechanism but scopes
-- the session to a specific event. event_day_sessions tracks which
-- person was active in event-day mode for which event, when they logged
-- in, and what they did (audit-summary).
--
-- The actual cookie session reuses worker/lib/portalSession.js — the
-- magic link encodes the event_id which event_day_sessions records.

CREATE TABLE event_day_sessions (
  id              TEXT PRIMARY KEY,                    -- eds_<random12>
  event_id        TEXT NOT NULL REFERENCES events(id),
  person_id       TEXT NOT NULL REFERENCES persons(id),
  -- Reuses portal_sessions for cookie state; this row is the
  -- event-scoped audit record.
  portal_session_id TEXT REFERENCES portal_sessions(id),
  -- Activity counters (denormalized for fast HQ dashboard queries)
  checkins_performed INTEGER NOT NULL DEFAULT 0,
  walkups_created INTEGER NOT NULL DEFAULT 0,
  incidents_filed INTEGER NOT NULL DEFAULT 0,
  equipment_returns INTEGER NOT NULL DEFAULT 0,
  -- Timestamps
  signed_in_at    INTEGER NOT NULL,
  last_activity_at INTEGER,
  signed_out_at   INTEGER,
  ip_address      TEXT,
  user_agent      TEXT,
  -- Metadata
  created_at      INTEGER NOT NULL,
  UNIQUE(event_id, person_id, signed_in_at)
);
CREATE INDEX idx_event_day_sessions_event ON event_day_sessions(event_id);
CREATE INDEX idx_event_day_sessions_person ON event_day_sessions(person_id);
CREATE INDEX idx_event_day_sessions_active ON event_day_sessions(event_id, signed_out_at);
