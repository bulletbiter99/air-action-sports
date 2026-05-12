-- 0054_promo_codes_email_binding.sql
--
-- Post-M5.5 — adds per-promo-code email restriction + seeds the
-- promo_code_issued email template used by the new batch-create flow
-- on /admin/promo-codes (worker/routes/admin/promoCodes.js POST /batch).
--
-- ADDS
-- ============================================================
-- - promo_codes.restricted_to_email TEXT NULL
--     When non-null, the booking flow rejects the code unless the
--     booking's customer email matches (case-insensitive) at quote +
--     checkout time. Enforcement lives in worker/routes/bookings.js
--     resolvePromoCode(); pricing.js (Critical DNT) is NOT modified.
-- - email_templates row `promo_code_issued`
--     Sent by the batch-create endpoint when sendEmails=true, one
--     email per recipient with their personal single-use code.
--
-- TEMPLATE VARIABLES
-- ============================================================
--   {{code}}              — the unique code string (e.g. AAS-X3K2M9)
--   {{discount_display}}  — formatted discount (e.g. "25% off" or "$10 off")
--   {{expires_at}}        — formatted expiry date (or 'no expiration')
--   {{event_name}}        — event name if code is event-scoped, else 'any event'
--   {{site_url}}          — booking root URL
--   {{recipient_name}}    — best-effort name from customers table or '' fallback
--
-- D1 QUIRKS OBSERVED
-- ============================================================
-- - Plain ALTER TABLE ADD COLUMN — no FK enforcement risk (column is nullable).
-- - No BEGIN/COMMIT keywords; no literal "TRANSACTION" anywhere.
-- - email_templates seed includes id + created_at per M5 Lesson #7.
-- - Spot-checked production schema: promo_codes has no existing
--   restricted_to_email column; email_templates has no existing
--   `promo_code_issued` row.
--
-- OPERATOR-APPLIES-REMOTE STEP (post-merge):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Verify:
--   PRAGMA table_info(promo_codes);  -- expect restricted_to_email TEXT
--   SELECT slug FROM email_templates WHERE slug = 'promo_code_issued';  -- 1 row

ALTER TABLE promo_codes ADD COLUMN restricted_to_email TEXT;

INSERT INTO email_templates (id, slug, subject, body_html, body_text, updated_at, created_at) VALUES
  ('tpl_promo_code_issued',
   'promo_code_issued',
   'Your Air Action Sports promo code: {{code}}',
   '<p>Hi {{recipient_name}},</p>' ||
   '<p>Thanks for being part of Air Action Sports. Here''s your personal promo code:</p>' ||
   '<p style="font-size:24px;font-weight:bold;padding:16px;background:#1c1d18;color:#d4541a;text-align:center;letter-spacing:2px;border-radius:4px">{{code}}</p>' ||
   '<table style="border-collapse:collapse;margin:16px 0">' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Discount</td><td>{{discount_display}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Valid for</td><td>{{event_name}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Expires</td><td>{{expires_at}}</td></tr>' ||
   '</table>' ||
   '<p>This code is single-use and tied to this email address — please use it from the same email at checkout.</p>' ||
   '<p><a href="{{site_url}}/events" style="display:inline-block;padding:12px 24px;background:#d4541a;color:white;text-decoration:none;border-radius:4px;font-weight:bold">Book your next event</a></p>' ||
   '<p>See you on the field,<br>The Air Action Sports team</p>',
   'Hi {{recipient_name}},' || char(10) || char(10) ||
   'Thanks for being part of Air Action Sports. Here''s your personal promo code:' || char(10) || char(10) ||
   '  {{code}}' || char(10) || char(10) ||
   'Discount:  {{discount_display}}' || char(10) ||
   'Valid for: {{event_name}}' || char(10) ||
   'Expires:   {{expires_at}}' || char(10) || char(10) ||
   'This code is single-use and tied to this email address. Use it from the same email at checkout.' || char(10) || char(10) ||
   'Book your next event: {{site_url}}/events' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000);
