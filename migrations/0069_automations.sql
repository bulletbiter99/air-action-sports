-- Marketing milestone B5 — automations + automation_sends.
--
-- An automation is a standing rule that emails customers when a trigger fires,
-- evaluated by the 15-min cron (worker/lib/automations.js). v1 triggers:
--   recurring  — re-send to the segment (or whole base) every intervalDays.
--   tag_added  — send once to each customer that holds a given tag.
-- (date_relative — "N days before/after an event" — is a documented follow-up;
--  it needs an events→bookings→customers join not yet wired.)
--
-- automation_sends is the idempotency ledger: a UNIQUE dedup_key prevents the
-- same customer from being re-sent for the same trigger instance (per-period
-- for recurring; once-ever for tag_added). No FKs (D1 quirk #2).

CREATE TABLE IF NOT EXISTS automations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  trigger_type  TEXT NOT NULL,                 -- 'recurring' | 'tag_added'
  trigger_config TEXT NOT NULL,                -- JSON, shape per trigger_type
  segment_id    TEXT,                          -- optional audience narrowing (recurring)
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  body_text     TEXT,
  from_name     TEXT,
  status        TEXT NOT NULL DEFAULT 'paused', -- 'active' | 'paused'
  last_run_at   INTEGER,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automations_status ON automations(status);

CREATE TABLE IF NOT EXISTS automation_sends (
  id             TEXT PRIMARY KEY,
  automation_id  TEXT NOT NULL,
  customer_id    TEXT NOT NULL,
  email          TEXT NOT NULL,
  dedup_key      TEXT NOT NULL,                -- '<automationId>:<customerId>[:<period>]'
  status         TEXT NOT NULL DEFAULT 'sent', -- 'sent' | 'failed'
  resend_email_id TEXT,
  error          TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_sends_automation ON automation_sends(automation_id);
-- Idempotency backstop: one send per trigger instance per customer.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_automation_send ON automation_sends(dedup_key);
