-- Marketing milestone Batch 2 — campaigns + campaign_recipients.
--
-- A campaign is a one-off marketing email to a customer segment (or to the
-- whole marketing-opted base when segment_id is null). The send pipeline
-- (B2b) enqueues one campaign_recipients row per resolved customer at
-- send-trigger time (a snapshot — editing/deleting the segment afterward
-- doesn't change who already received it) and a cron drains them in batches.
--
-- No FK constraints (D1 enforces FKs during DROP even with runtime FK off —
-- see CLAUDE.md D1 quirk #2; the repo avoids them). segment_id is a soft
-- reference into segments(id); recipients snapshot the customer.
--
-- Status lifecycle (enforced in worker/lib/campaigns.js, not the DB):
--   draft → scheduled → sending → sent
--   draft → sending → sent           (send now)
--   draft|scheduled → canceled
--
-- email_templates is NOT used here — campaign body is stored inline on the
-- row (Lesson #7's id/created_at seed rule doesn't apply to this migration).

CREATE TABLE IF NOT EXISTS campaigns (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  body_text       TEXT,
  segment_id      TEXT,                                   -- null = whole marketing-opted base
  status          TEXT NOT NULL DEFAULT 'draft',          -- draft|scheduled|sending|sent|canceled
  scheduled_at    INTEGER,                                -- when status='scheduled', cron fires at/after this
  from_name       TEXT,                                   -- optional display-name override
  recipient_count INTEGER NOT NULL DEFAULT 0,             -- snapshot at enqueue
  sent_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  sent_at         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
-- Drives the B2b cron: pick up 'scheduled' rows whose time has come + 'sending' rows mid-drain.
CREATE INDEX IF NOT EXISTS idx_campaigns_status_scheduled ON campaigns(status, scheduled_at);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL,
  customer_id     TEXT NOT NULL,
  email           TEXT NOT NULL,                          -- snapshot at enqueue
  name            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',        -- pending|sent|failed|skipped
  resend_email_id TEXT,                                   -- Resend message id (B4 tracking correlation)
  error           TEXT,
  sent_at         INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
-- Drives the per-campaign drain: WHERE campaign_id = ? AND status = 'pending'.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_drain ON campaign_recipients(campaign_id, status);
-- Idempotent enqueue: a customer can't be double-added to one campaign.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_recipient ON campaign_recipients(campaign_id, customer_id);
