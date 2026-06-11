-- Email template seed for the waiver-confirmation receipt.
-- Sent to the signer (the email typed on the waiver form) whenever
-- POST /api/waivers/:qrToken succeeds, so signing is no longer silent —
-- built after a customer (2026-06-11) had to email and ask whether his
-- waiver "went through". Also resendable per booking from the admin
-- booking detail page.
--
-- PRE-MIGRATION SPOT-CHECK (live capture 2026-06-11)
-- ============================================================
-- email_templates schema confirmed via sqlite_master:
--   id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, subject TEXT NOT NULL,
--   body_html TEXT NOT NULL, body_text TEXT, variables_json TEXT,
--   updated_by TEXT, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
--   status TEXT NOT NULL DEFAULT 'published'   (M6 B3, migration 0056)
--
-- Lesson #7 compliance:
--   - id='tpl_waiver_confirmation'                          OK
--   - created_at = updated_at (= 1781136000000, 2026-06-11 UTC)  OK
--   - status defaults to 'published' via the column default
--
-- D1 quirks: single INSERT, no schema change — none apply.

INSERT INTO email_templates (
    id, slug, subject, body_html, body_text, variables_json,
    updated_by, updated_at, created_at
) VALUES (
    'tpl_waiver_confirmation',
    'waiver_confirmation',
    'Waiver on file — {{event_name}} ({{event_date}})',
    '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="color:#2ecc71;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">&#9632; Waiver On File</div>
<h1 style="font-size:24px;margin:8px 0 24px;">You&#39;re cleared, {{player_name}}.</h1>
<p>Your waiver for <strong>{{event_name}}</strong> on <strong>{{event_date}}</strong> is signed and on file &mdash; nothing else to do before game day.</p>
<table style="border-collapse:collapse;margin:16px 0;">
<tr><td style="padding:4px 16px 4px 0;color:#6b7560;">Signed</td><td style="padding:4px 0;">{{signed_date}}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#6b7560;">Valid through</td><td style="padding:4px 0;">{{valid_through}}</td></tr>
</table>
<p style="margin:24px 0;"><a href="{{ticket_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:14px 28px;text-decoration:none;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:13px;">&#9658; View My Ticket</a></p>
<p style="color:#6b7560;font-size:12px;">Air Action Sports waivers are valid for 365 days from the signed date and cover any AAS event in that window. Want a paper copy? Just reply to this email.</p>
<p style="color:#6b7560;font-size:12px;margin-top:24px;"><strong style="color:#d4541a;">&mdash; Air Action Sports</strong></p>
</div>',
    'WAIVER ON FILE — {{event_name}}

{{player_name}},

Your waiver for {{event_name}} on {{event_date}} is signed and on file — nothing else to do before game day.

  Signed:        {{signed_date}}
  Valid through: {{valid_through}}

View your ticket: {{ticket_link}}

Air Action Sports waivers are valid for 365 days from the signed date and cover any AAS event in that window. Want a paper copy? Just reply to this email.

— Air Action Sports',
    '["player_name","event_name","event_date","signed_date","valid_through","ticket_link"]',
    NULL,
    1781136000000,
    1781136000000
);
