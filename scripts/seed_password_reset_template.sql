-- Email template for password reset messages.
INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at) VALUES
(
    'tpl_password_reset',
    'password_reset',
    'Reset your Air Action Sports admin password',
    '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">■ Password Reset</div>
<h1 style="font-size:22px;margin:8px 0 24px;color:#f2ede4;">Reset your password</h1>
<p>Hey {{display_name}},</p>
<p>Someone (hopefully you) requested a password reset on your Air Action Sports admin account.</p>
<p>Click the button below to set a new password. The link expires in <strong>1 hour</strong>.</p>
<p style="margin:24px 0;"><a href="{{reset_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:14px 28px;text-decoration:none;font-weight:800;letter-spacing:1px;text-transform:uppercase;font-size:13px;">▶ Reset Password</a></p>
<p style="color:#6b7560;font-size:12px;">Didn''t request this? You can safely ignore this email — your password won''t change.</p>
<p style="color:#6b7560;font-size:12px;">If the button doesn''t work, paste this into your browser:<br><span style="color:#c8b89a;word-break:break-all;">{{reset_link}}</span></p>
<p style="color:#6b7560;font-size:12px;margin-top:24px;"><strong style="color:#d4541a;">— Air Action Sports</strong></p>
</div>',
    'PASSWORD RESET

Hey {{display_name}},

Someone (hopefully you) requested a password reset on your Air Action Sports admin account.

Reset your password (link expires in 1 hour):
{{reset_link}}

Didn''t request this? You can safely ignore this email — your password won''t change.

— Air Action Sports',
    '["display_name","reset_link"]',
    unixepoch() * 1000,
    unixepoch() * 1000
);
