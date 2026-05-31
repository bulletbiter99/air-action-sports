-- 0065_email_events.sql
--
-- M7 Batch 8 — deliverability-event log for the Resend bounce/complaint
-- webhook consumer (POST /api/webhooks/resend).
--
-- A single, unified log of the two Resend events we act on:
--   email.bounced     → type='bounce'    (bounce_type 'hard' | 'soft')
--   email.complained  → type='complaint' (recipient marked us as spam)
--
-- The consumer (worker/routes/webhooks.js handleResendEmailEvent) INSERTs one
-- row per event here, ALSO writes an audit_log row (so events surface in the
-- admin audit log + Batch 6 FTS search), and — on a hard bounce or any
-- complaint that matches a known customer — flips customers.email_marketing=0
-- (never email_transactional). The Batch 10 alert-email templates and any
-- admin "Deliverability" read surface build on this table.
--
-- PRE-MIGRATION SPOT-CHECK (read-only, remote, 2026-05-31)
-- ============================================================
--   SELECT name FROM sqlite_master WHERE type='table'
--     AND name IN ('customers','email_events','audit_log');
--     → customers ✓, audit_log ✓, email_events ABSENT (no collision — safe to CREATE)
--   customers schema confirmed to carry: email_normalized, email_marketing,
--     created_at, updated_at (the suppression UPDATE stamps updated_at).
--
-- Lesson #7: N/A — this migration seeds NO email_templates rows (it creates a
--   new table). The bounce/complaint ALERT templates land in Batch 10 (0066).
--
-- D1 quirks: N/A — single CREATE TABLE + indexes; no TRANSACTION keyword, no
--   table rebuild (no FK-during-DROP risk), no email_templates NOT NULL trap.
--
-- Forward-only. IF NOT EXISTS guards make re-application a no-op alongside the
-- d1_migrations tracker.
--
-- Operator-applies-remote (post-merge, standard M7 rule):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote

CREATE TABLE IF NOT EXISTS email_events (
    id                    TEXT PRIMARY KEY,                 -- 'eev_*'
    type                  TEXT NOT NULL CHECK (type IN ('bounce', 'complaint')),
    bounce_type           TEXT,                             -- 'hard' | 'soft' | NULL (complaints)
    recipient_email       TEXT NOT NULL,                    -- raw recipient from the payload
    recipient_normalized  TEXT,                             -- normalizeEmail() match key
    customer_id           TEXT REFERENCES customers(id),    -- nullable → orphan-safe
    resend_email_id       TEXT,                             -- payload data.email_id
    svix_message_id       TEXT,                             -- idempotency key (svix-id header)
    suppressed_marketing  INTEGER NOT NULL DEFAULT 0 CHECK (suppressed_marketing IN (0, 1)),
    payload_json          TEXT,                             -- raw event.data, forensics
    created_at            INTEGER NOT NULL
);

-- Idempotency backstop: Resend/svix redelivers the same message on our 5xx or
-- on a manual resend. The consumer checks this key before inserting; the UNIQUE
-- index guarantees we never double-record even under a race. Partial (WHERE NOT
-- NULL) so any row lacking a svix id still inserts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_events_svix
    ON email_events(svix_message_id) WHERE svix_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_events_customer  ON email_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient ON email_events(recipient_normalized);
CREATE INDEX IF NOT EXISTS idx_email_events_created   ON email_events(created_at);
