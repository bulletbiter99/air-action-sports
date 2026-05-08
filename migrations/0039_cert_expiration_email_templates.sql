-- M5 R8 — seed cert_expiration_60d / 30d / 7d email templates used by
-- worker/lib/certifications.js runCertExpirationSweep cron.
--
-- Variables provided per send:
--   {{personName}}        — recipient's full_name from persons row
--   {{certName}}          — certifications.display_name
--   {{certKind}}          — certifications.kind (cpr, first_aid, etc.)
--   {{expiresOn}}         — formatted local date of expiration
--   {{issuingAuthority}}  — certifications.issuing_authority (or fallback)
--
-- The cron uses audit_log rows as the idempotency sentinel — each cert
-- receives at most one warning per milestone window.
--
-- (Avoid the literal SQL keyword "TRANSACTION" anywhere — wrangler's
-- parser keyword-scans uploaded SQL even inside comments.)

INSERT INTO email_templates (slug, subject, body_html, body_text, updated_at) VALUES
  ('cert_expiration_60d',
   'Heads up — {{certName}} expires in 60 days ({{expiresOn}})',
   '<p>Hi {{personName}},</p>' ||
   '<p>Your <strong>{{certName}}</strong> certification expires on <strong>{{expiresOn}}</strong> — about 60 days from now. ' ||
   'Now is a good time to schedule renewal so there is no lapse.</p>' ||
   '<p>If you''ve already renewed, reply with the new certificate and we''ll update our records.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{personName}},' || char(10) || char(10) ||
   'Your {{certName}} certification expires on {{expiresOn}} — about 60 days from now. Now is a good time to schedule renewal so there is no lapse.' || char(10) || char(10) ||
   'If you''ve already renewed, reply with the new certificate and we''ll update our records.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000),

  ('cert_expiration_30d',
   'Reminder — {{certName}} expires in 30 days ({{expiresOn}})',
   '<p>Hi {{personName}},</p>' ||
   '<p>Your <strong>{{certName}}</strong> certification expires on <strong>{{expiresOn}}</strong> — about <strong>30 days</strong> from now. ' ||
   'Please book your renewal class with {{issuingAuthority}} this week if you haven''t already.</p>' ||
   '<p>If you''ve already renewed, reply with the new certificate and we''ll update our records.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{personName}},' || char(10) || char(10) ||
   'Your {{certName}} certification expires on {{expiresOn}} — about 30 days from now. Please book your renewal class with {{issuingAuthority}} this week if you haven''t already.' || char(10) || char(10) ||
   'If you''ve already renewed, reply with the new certificate and we''ll update our records.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000),

  ('cert_expiration_7d',
   'Action required — {{certName}} expires in 7 days ({{expiresOn}})',
   '<p>Hi {{personName}},</p>' ||
   '<p><strong>Your {{certName}} certification expires on {{expiresOn}} — only 7 days from now.</strong></p>' ||
   '<p>Until you renew, you cannot be assigned to events that require {{certName}}. ' ||
   'If you have already renewed, please send us a copy of the new certificate today so we can update your records before any event scheduling is affected.</p>' ||
   '<p>If you need help finding a renewal class, reply and we''ll point you to a local provider.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{personName}},' || char(10) || char(10) ||
   'Your {{certName}} certification expires on {{expiresOn}} — only 7 days from now.' || char(10) || char(10) ||
   'Until you renew, you cannot be assigned to events that require {{certName}}. If you have already renewed, please send us a copy of the new certificate today so we can update your records before any event scheduling is affected.' || char(10) || char(10) ||
   'If you need help finding a renewal class, reply and we''ll point you to a local provider.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000);
