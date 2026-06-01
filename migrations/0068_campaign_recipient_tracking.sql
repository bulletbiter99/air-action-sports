-- Marketing milestone B4 — per-recipient engagement tracking.
--
-- The B2b sender already stamps resend_email_id when a campaign email is sent.
-- B4 correlates Resend (Svix) webhook events back to that row by resend_email_id
-- and records the engagement timestamp. These columns drive the per-campaign
-- stats endpoint (delivered/opened/clicked/bounced/complained rates).
--
-- Separate from the global email_events log (migration 0065): email_events is
-- the deliverability audit trail across ALL sends; these columns are the
-- campaign-scoped funnel. A campaign email that bounces writes both.

ALTER TABLE campaign_recipients ADD COLUMN delivered_at INTEGER;
ALTER TABLE campaign_recipients ADD COLUMN opened_at INTEGER;
ALTER TABLE campaign_recipients ADD COLUMN clicked_at INTEGER;
ALTER TABLE campaign_recipients ADD COLUMN bounced_at INTEGER;
ALTER TABLE campaign_recipients ADD COLUMN complained_at INTEGER;
