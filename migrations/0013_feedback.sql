-- Feedback / ticket system.
-- Public POST /api/feedback accepts anonymous submissions.
-- Admins triage via /admin/feedback. Every status/priority change writes to audit_log.
-- Email template `admin_feedback_received` notifies the admin-notify address on submit.

CREATE TABLE feedback (
    id TEXT PRIMARY KEY,                 -- 'fb_*'
    type TEXT NOT NULL,                  -- 'bug' | 'feature' | 'usability' | 'other'
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    email TEXT,                          -- optional submitter email
    page_url TEXT,                       -- auto-captured from submission
    user_agent TEXT,                     -- auto-captured
    viewport TEXT,                       -- 'WxH' string
    ip_hash TEXT,                        -- SHA-256 of IP + SESSION_SECRET; never raw IP
    status TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'triaged' | 'in-progress' | 'resolved' | 'wont-fix' | 'duplicate'
    priority TEXT NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high' | 'critical'
    admin_note TEXT,                     -- private triage notes
    resolved_at INTEGER,                 -- set when status → resolved/wont-fix/duplicate
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_feedback_status ON feedback(status, created_at DESC);
CREATE INDEX idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX idx_feedback_type ON feedback(type, created_at DESC);

-- Admin notification email template. Renders on every submission.
INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at)
VALUES (
    'et_admin_feedback_received',
    'admin_feedback_received',
    'New {{type_label}}: {{title}}',
    '<div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1c18;"><h2 style="color: #d76c21; margin: 0 0 4px; font-size: 20px; letter-spacing: 1px; text-transform: uppercase;">New feedback received</h2><p style="color: #5d6452; font-size: 13px; margin: 0 0 20px;">Triage at <a href="{{admin_url}}" style="color: #d76c21;">{{admin_url}}</a></p><table style="width: 100%; border-collapse: collapse; font-size: 14px;"><tr><td style="padding: 8px 12px; background: #f4eedd; font-weight: 700; width: 120px;">Type</td><td style="padding: 8px 12px; background: #fafaf5;">{{type_label}}</td></tr><tr><td style="padding: 8px 12px; background: #f4eedd; font-weight: 700;">Title</td><td style="padding: 8px 12px; background: #fafaf5;">{{title}}</td></tr><tr><td style="padding: 8px 12px; background: #f4eedd; font-weight: 700;">From</td><td style="padding: 8px 12px; background: #fafaf5;">{{from_display}}</td></tr><tr><td style="padding: 8px 12px; background: #f4eedd; font-weight: 700;">Page</td><td style="padding: 8px 12px; background: #fafaf5; word-break: break-all;">{{page_url}}</td></tr><tr><td style="padding: 8px 12px; background: #f4eedd; font-weight: 700; vertical-align: top;">Description</td><td style="padding: 8px 12px; background: #fafaf5; white-space: pre-wrap;">{{description}}</td></tr><tr><td style="padding: 8px 12px; background: #f4eedd; font-weight: 700;">Browser</td><td style="padding: 8px 12px; background: #fafaf5; font-size: 11px; color: #5d6452;">{{user_agent}} · {{viewport}}</td></tr></table></div>',
    'New feedback received — triage at {{admin_url}}

Type: {{type_label}}
Title: {{title}}
From: {{from_display}}
Page: {{page_url}}

Description:
{{description}}

Browser: {{user_agent}} · {{viewport}}',
    '["type_label","title","from_display","page_url","description","user_agent","viewport","admin_url"]',
    (strftime('%s', 'now') * 1000),
    (strftime('%s', 'now') * 1000)
);
