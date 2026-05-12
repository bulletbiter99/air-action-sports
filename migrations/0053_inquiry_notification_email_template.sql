-- 0053_inquiry_notification_email_template.sql
--
-- M5.5 Batch 11 — seed the inquiry_notification email template used by
-- worker/routes/inquiry.js. Sent to env.ADMIN_NOTIFY_EMAIL whenever a
-- public /contact form submission is processed (both general inquiries
-- and field-rental-routed leads). Subject-prefix routing:
--   {{subject_prefix}} = '[Field Rental Inquiry]' for private-hire/corporate
--   {{subject_prefix}} = '[General Inquiry]' for everything else
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-12; per Lesson #7)
-- ============================================================
-- - email_templates table exists. Production schema requires id +
--   created_at NOT NULL per M5 deploy hotfix; both included below.
-- - Spot-checked: no existing row with slug='inquiry_notification'.
--
-- TEMPLATE VARIABLES
-- ============================================================
--   {{subject_prefix}}    — '[Field Rental Inquiry]' or '[General Inquiry]'
--   {{name}}              — submitter's name (trimmed, CRLF-stripped by renderTemplate)
--   {{email}}             — submitter's email
--   {{phone}}             — submitter's phone (or 'not provided')
--   {{subject}}           — raw subject slug from the form ('private-hire' etc.)
--   {{message}}           — full message body
--   {{customer_id}}       — cus_xxx when a customer was looked-up or created; '—' otherwise
--   {{rental_id}}         — fr_xxx when a lead row was created; '—' otherwise
--   {{detail_url}}        — admin deep-link to the lead (when rental_id set); blank otherwise
--   {{submitted_at}}      — formatted local datetime of submission
--
-- D1 QUIRKS OBSERVED
-- ============================================================
-- - Pure INSERT; no schema changes; no table rebuild.
-- - No BEGIN/COMMIT keywords; no literal "TRANSACTION" anywhere.
-- - id + created_at + updated_at all populated per Lesson #7.
--
-- OPERATOR-APPLIES-REMOTE STEP (post-merge, post-Workers-deploy):
--   CLOUDFLARE_API_TOKEN=$TOKEN \
--     npx wrangler d1 migrations apply air-action-sports-db --remote
--
-- Verify:
--   SELECT slug FROM email_templates WHERE slug = 'inquiry_notification';
--   -- expected: 1 row.

INSERT INTO email_templates (id, slug, subject, body_html, body_text, updated_at, created_at) VALUES
  ('tpl_inquiry_notification',
   'inquiry_notification',
   '{{subject_prefix}} {{name}} <{{email}}>',
   '<p><strong>{{subject_prefix}} — new submission</strong></p>' ||
   '<table style="border-collapse:collapse">' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td>{{name}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>{{email}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>{{phone}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Subject</td><td>{{subject}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Submitted</td><td>{{submitted_at}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Customer</td><td>{{customer_id}}</td></tr>' ||
   '<tr><td style="padding:4px 12px 4px 0;color:#666">Rental lead</td><td>{{rental_id}}</td></tr>' ||
   '</table>' ||
   '<p><strong>Message:</strong></p>' ||
   '<p style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:4px">{{message}}</p>' ||
   '<p><a href="{{detail_url}}">View in admin</a> (link blank for general inquiries)</p>' ||
   '<p>— Air Action Sports public inquiry pipeline</p>',
   '{{subject_prefix}} — new submission' || char(10) || char(10) ||
   'Name:        {{name}}' || char(10) ||
   'Email:       {{email}}' || char(10) ||
   'Phone:       {{phone}}' || char(10) ||
   'Subject:     {{subject}}' || char(10) ||
   'Submitted:   {{submitted_at}}' || char(10) ||
   'Customer:    {{customer_id}}' || char(10) ||
   'Rental lead: {{rental_id}}' || char(10) || char(10) ||
   'Message:' || char(10) ||
   '{{message}}' || char(10) || char(10) ||
   'Admin link: {{detail_url}}' || char(10) || char(10) ||
   '— Air Action Sports public inquiry pipeline',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000);
