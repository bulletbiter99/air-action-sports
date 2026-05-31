-- 0066_email_event_alert_templates.sql
--
-- M7 Batch 10 — admin alert email templates for the Resend bounce/complaint
-- consumer (Batch 8 / migration 0065). The consumer records every event +
-- suppresses marketing on hard bounce/complaint; these templates back the
-- admin alert email that Batch 10 sends to ADMIN_NOTIFY_EMAIL for those two
-- actionable event types (hard bounce + complaint). Soft bounces are recorded
-- silently and never alert.
--
-- Two templates:
--   bounce_alert     — sent on a HARD bounce (permanently undeliverable address)
--   complaint_alert  — sent on a spam complaint
--
-- PRE-MIGRATION SPOT-CHECK (read-only, remote, 2026-05-31)
-- ============================================================
--   SELECT sql FROM sqlite_master WHERE name='email_templates';
--   → id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, subject TEXT NOT NULL,
--     body_html TEXT NOT NULL, body_text TEXT, variables_json TEXT,
--     updated_by TEXT, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
--     status TEXT NOT NULL DEFAULT 'published'  (M6 B3, migration 0056)
--
-- Lesson #7 compliance:
--   - id='tpl_bounce_alert' / 'tpl_complaint_alert'        ✓
--   - slug set + UNIQUE                                    ✓
--   - created_at = updated_at (= 1748678400000, 2026-05-31 UTC)  ✓
--   - status defaults to 'published' via the column default ✓
--
-- D1 quirks: N/A — two INSERTs, no schema change, no TRANSACTION keyword.

INSERT INTO email_templates (
    id, slug, subject, body_html, body_text, variables_json,
    updated_by, updated_at, created_at
) VALUES (
    'tpl_bounce_alert',
    'bounce_alert',
    '⚠ Email hard-bounced: {{recipient}}',
    '<p>A message Air Action Sports sent <strong>hard-bounced</strong> — the recipient''s mail server permanently rejected it, so this address is undeliverable.</p>
<table style="border-collapse: collapse; margin: 12px 0;">
<tr><td style="padding: 4px 12px 4px 0;"><strong>Recipient</strong></td><td style="padding: 4px 0;">{{recipient}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Bounce type</strong></td><td style="padding: 4px 0;">{{bounce_type}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Matched customer</strong></td><td style="padding: 4px 0;">{{customer}} — <a href="{{admin_link}}">view</a></td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Marketing email</strong></td><td style="padding: 4px 0;">{{suppressed}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Resend id</strong></td><td style="padding: 4px 0;">{{resend_email_id}}</td></tr>
</table>
<p>No action is strictly required — marketing email is already suppressed for any matched customer — but if this was a mistyped address you may want to correct it.</p>
<p style="color: #666; font-size: 13px; margin-top: 24px;">Automated alert from the Air Action Sports deliverability webhook. Recorded in the admin audit log under action=<code>email.bounced</code>.</p>',
    'A message Air Action Sports sent HARD-BOUNCED — {{recipient}} is undeliverable.

  Recipient:        {{recipient}}
  Bounce type:      {{bounce_type}}
  Matched customer: {{customer}} ({{admin_link}})
  Marketing email:  {{suppressed}}
  Resend id:        {{resend_email_id}}

No action is strictly required (marketing is already suppressed for any matched
customer), but correct the address if it was a typo. Logged under email.bounced.',
    '["recipient","bounce_type","customer","admin_link","suppressed","resend_email_id"]',
    NULL,
    1748678400000,
    1748678400000
);

INSERT INTO email_templates (
    id, slug, subject, body_html, body_text, variables_json,
    updated_by, updated_at, created_at
) VALUES (
    'tpl_complaint_alert',
    'complaint_alert',
    '⚠ Spam complaint: {{recipient}}',
    '<p>A recipient marked an Air Action Sports email as <strong>spam</strong>. Repeated complaints hurt your sending-domain reputation, so this one matters.</p>
<table style="border-collapse: collapse; margin: 12px 0;">
<tr><td style="padding: 4px 12px 4px 0;"><strong>Recipient</strong></td><td style="padding: 4px 0;">{{recipient}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Matched customer</strong></td><td style="padding: 4px 0;">{{customer}} — <a href="{{admin_link}}">view</a></td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Marketing email</strong></td><td style="padding: 4px 0;">{{suppressed}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Resend id</strong></td><td style="padding: 4px 0;">{{resend_email_id}}</td></tr>
</table>
<p><strong>What to do next:</strong></p>
<ol>
<li>Marketing email is already turned off for any matched customer — leave it off.</li>
<li>Review who you''re emailing and how often — complaints usually mean unwanted or too-frequent mail.</li>
<li>Never re-add this recipient to a marketing list.</li>
</ol>
<p style="color: #666; font-size: 13px; margin-top: 24px;">Automated alert from the Air Action Sports deliverability webhook. Recorded in the admin audit log under action=<code>email.complained</code>.</p>',
    'A recipient marked an Air Action Sports email as SPAM.

  Recipient:        {{recipient}}
  Matched customer: {{customer}} ({{admin_link}})
  Marketing email:  {{suppressed}}
  Resend id:        {{resend_email_id}}

Next steps:
  1. Marketing email is already off for any matched customer — leave it off.
  2. Review who you email and how often — complaints mean unwanted/too-frequent mail.
  3. Never re-add this recipient to a marketing list.

Logged under email.complained.',
    '["recipient","customer","admin_link","suppressed","resend_email_id"]',
    NULL,
    1748678400000,
    1748678400000
);
