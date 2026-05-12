-- 0052_field_rental_cron_email_templates.sql
--
-- M5.5 Batch 10b — seed 4 email templates used by the field-rental cron
-- sweeps (worker/lib/fieldRentalCron.js):
--   - coi_alert_60d / 30d / 7d — milestone alerts to AAS staff when a
--     rental's COI is approaching expiration.
--   - field_rental_lead_stale — alert when a rental sits in lead/draft
--     for 14+ days without movement.
--
-- All alerts are staff-facing (sent to the rental's assigned
-- aas_site_coordinator, falling back to env.ADMIN_NOTIFY_EMAIL).
-- Renter-facing COI emails are out of scope per B10b plan-mode #1.
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-12; per Lesson #7)
-- ============================================================
-- - email_templates table exists (M3-era seed, multiple post-M3 batches
--   have added rows). Production schema requires id + created_at columns
--   per M5 deploy hotfix (Lesson #7) — both included below.
-- - Spot-checked: no existing rows with slug='coi_alert_60d',
--   'coi_alert_30d', 'coi_alert_7d', or 'field_rental_lead_stale'
--   (these slugs are unique to this batch).
--
-- TEMPLATE VARIABLES
-- ============================================================
-- COI alerts use:
--   {{rental_id}}             — fr_xxxx
--   {{customer_name}}         — customers.name (or 'unknown')
--   {{scheduled_starts_at}}   — formatted local date
--   {{site_name}}             — Ghost Town / Foxtrot
--   {{coi_expires_on}}        — formatted local date of COI expiration
--   {{days_until_expiry}}     — integer (60 / 30 / 7-ish, computed per-row)
--   {{detail_url}}            — /admin/field-rentals/:id deep-link
--
-- Lead-stale uses:
--   {{rental_id}}, {{customer_name}}, {{status}}, {{detail_url}}
--   {{days_since_last_update}}  — integer
--
-- D1 QUIRKS OBSERVED
-- ============================================================
-- - Pure INSERT statements; no schema changes; no table rebuild.
-- - No BEGIN/COMMIT keywords; no literal "TRANSACTION" anywhere.
-- - Every row binds id + created_at + updated_at per Lesson #7 —
--   omitting either would hit a NOT NULL constraint on remote.
--
-- OPERATOR-APPLIES-REMOTE STEP (post-merge, post-Workers-deploy):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Verify:
--   SELECT slug FROM email_templates WHERE slug LIKE 'coi_alert%' OR slug = 'field_rental_lead_stale';
--   -- expected: 4 rows.

INSERT INTO email_templates (id, slug, subject, body_html, body_text, updated_at, created_at) VALUES
  ('tpl_coi_alert_60d',
   'coi_alert_60d',
   'COI heads up — rental {{rental_id}} COI expires in {{days_until_expiry}} days',
   '<p>Hi team,</p>' ||
   '<p>The certificate of insurance for field rental <strong>{{rental_id}}</strong> ' ||
   '({{customer_name}} at {{site_name}}, scheduled for {{scheduled_starts_at}}) ' ||
   'expires on <strong>{{coi_expires_on}}</strong> — about {{days_until_expiry}} days from now.</p>' ||
   '<p>Now is a good time to ping the renter for a renewed certificate so there is no lapse.</p>' ||
   '<p><a href="{{detail_url}}">View rental in the admin</a></p>' ||
   '<p>— Air Action Sports cron</p>',
   'Hi team,' || char(10) || char(10) ||
   'The COI for field rental {{rental_id}} ({{customer_name}} at {{site_name}}, scheduled for {{scheduled_starts_at}}) expires on {{coi_expires_on}} — about {{days_until_expiry}} days from now.' || char(10) || char(10) ||
   'Now is a good time to ping the renter for a renewed certificate so there is no lapse.' || char(10) || char(10) ||
   'View: {{detail_url}}' || char(10) || char(10) ||
   '— Air Action Sports cron',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000),

  ('tpl_coi_alert_30d',
   'coi_alert_30d',
   'COI reminder — rental {{rental_id}} COI expires in {{days_until_expiry}} days',
   '<p>Hi team,</p>' ||
   '<p>The COI for field rental <strong>{{rental_id}}</strong> ' ||
   '({{customer_name}} at {{site_name}}, scheduled for {{scheduled_starts_at}}) ' ||
   'expires on <strong>{{coi_expires_on}}</strong> — about {{days_until_expiry}} days from now.</p>' ||
   '<p>If you haven''t already, please follow up with the renter for a refreshed certificate.</p>' ||
   '<p><a href="{{detail_url}}">View rental in the admin</a></p>' ||
   '<p>— Air Action Sports cron</p>',
   'Hi team,' || char(10) || char(10) ||
   'The COI for field rental {{rental_id}} ({{customer_name}} at {{site_name}}, scheduled for {{scheduled_starts_at}}) expires on {{coi_expires_on}} — about {{days_until_expiry}} days from now.' || char(10) || char(10) ||
   'If you haven''t already, please follow up with the renter for a refreshed certificate.' || char(10) || char(10) ||
   'View: {{detail_url}}' || char(10) || char(10) ||
   '— Air Action Sports cron',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000),

  ('tpl_coi_alert_7d',
   'coi_alert_7d',
   'URGENT: rental {{rental_id}} COI expires in {{days_until_expiry}} days',
   '<p>Hi team,</p>' ||
   '<p><strong>URGENT:</strong> the COI for field rental <strong>{{rental_id}}</strong> ' ||
   '({{customer_name}} at {{site_name}}, scheduled for {{scheduled_starts_at}}) ' ||
   'expires on <strong>{{coi_expires_on}}</strong> — only {{days_until_expiry}} days away.</p>' ||
   '<p>Without a refreshed COI on file, the rental cannot proceed. Please contact the renter today.</p>' ||
   '<p><a href="{{detail_url}}">View rental in the admin</a></p>' ||
   '<p>— Air Action Sports cron</p>',
   'Hi team,' || char(10) || char(10) ||
   'URGENT: the COI for field rental {{rental_id}} ({{customer_name}} at {{site_name}}, scheduled for {{scheduled_starts_at}}) expires on {{coi_expires_on}} — only {{days_until_expiry}} days away.' || char(10) || char(10) ||
   'Without a refreshed COI on file, the rental cannot proceed. Please contact the renter today.' || char(10) || char(10) ||
   'View: {{detail_url}}' || char(10) || char(10) ||
   '— Air Action Sports cron',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000),

  ('tpl_field_rental_lead_stale',
   'field_rental_lead_stale',
   'Stale lead — rental {{rental_id}} has been in {{status}} for {{days_since_last_update}} days',
   '<p>Hi team,</p>' ||
   '<p>Field rental <strong>{{rental_id}}</strong> ({{customer_name}}) has been in ' ||
   '<strong>{{status}}</strong> status for {{days_since_last_update}} days without movement.</p>' ||
   '<p>Consider following up with the renter, advancing the rental to <em>sent</em>, ' ||
   'or cancelling if the lead is dead.</p>' ||
   '<p><a href="{{detail_url}}">View rental in the admin</a></p>' ||
   '<p>— Air Action Sports cron</p>',
   'Hi team,' || char(10) || char(10) ||
   'Field rental {{rental_id}} ({{customer_name}}) has been in {{status}} status for {{days_since_last_update}} days without movement.' || char(10) || char(10) ||
   'Consider following up with the renter, advancing the rental to sent, or cancelling if the lead is dead.' || char(10) || char(10) ||
   'View: {{detail_url}}' || char(10) || char(10) ||
   '— Air Action Sports cron',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000);
