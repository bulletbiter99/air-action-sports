-- Feedback attachments + submitter notification.
-- Screenshots live in R2 under `feedback/<random>.<ext>`. On terminal status
-- (resolved/wont-fix/duplicate), the admin API deletes the R2 object and
-- stamps attachment_deleted_at, blanking attachment_url. Ticket row is kept
-- forever for history / regression detection.

ALTER TABLE feedback ADD COLUMN attachment_url TEXT;
ALTER TABLE feedback ADD COLUMN attachment_size_bytes INTEGER;
ALTER TABLE feedback ADD COLUMN attachment_deleted_at INTEGER;

-- Optional email to the submitter when we resolve/close their ticket.
-- Triggered manually via admin UI button, never automatic — some closures
-- (spam, duplicate, wont-fix) shouldn't generate outbound email.
INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at)
VALUES (
    'et_feedback_resolution_notice',
    'feedback_resolution_notice',
    'Update on your feedback: {{title}}',
    '<div style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1c18;"><h2 style="color:#d76c21;margin:0 0 4px;font-size:20px;letter-spacing:1px;text-transform:uppercase;">Your feedback update</h2><p style="color:#5d6452;font-size:13px;margin:0 0 20px;">Air Action Sports</p><p>Hi,</p><p>Thanks again for submitting <strong>{{title}}</strong>. We wanted to let you know the status has been updated to <strong>{{status_label}}</strong>.</p><div style="background:#f4eedd;padding:12px 16px;border-left:3px solid #d76c21;margin:16px 0;font-size:14px;">Note from our team: {{note}}</div><p style="color:#5d6452;font-size:13px;">If you have follow-up questions, just reply to this email.</p></div>',
    'Your feedback update

Hi,

Thanks again for submitting "{{title}}". The status has been updated to {{status_label}}.

Note from our team: {{note}}

If you have follow-up questions, just reply to this email.

— Air Action Sports
{{site_url}}',
    '["title","status_label","note","site_url"]',
    (strftime('%s', 'now') * 1000),
    (strftime('%s', 'now') * 1000)
);
