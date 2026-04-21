-- Realign user_invite template with brand (dark theme, matches booking_confirmation/password_reset)

UPDATE email_templates
SET
  body_html = '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="border-left:4px solid #d4541a;padding-left:16px;margin-bottom:24px;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">&#9632; You are on the roster</div>
<h1 style="font-size:22px;margin:8px 0 0;color:#f2ede4;">Air Action Sports &mdash; Admin</h1>
</div>
<p>{{inviter_name}} has invited you to the admin panel as a <strong style="color:#d4541a;text-transform:uppercase;letter-spacing:1px;">{{role}}</strong>.</p>
<p>Click the button below to set your password and gain access. This invite expires in <strong>7 days</strong>.</p>
<p style="margin:24px 0;"><a href="{{accept_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:14px 28px;text-decoration:none;font-weight:800;letter-spacing:1px;text-transform:uppercase;font-size:13px;">&#9658; Accept Invite</a></p>
<p style="color:#6b7560;font-size:12px;">If the button does not work, paste this into your browser:<br><span style="color:#c8b89a;word-break:break-all;">{{accept_link}}</span></p>
<p style="color:#6b7560;font-size:12px;margin-top:24px;"><strong style="color:#d4541a;">&mdash; Air Action Sports</strong></p>
</div>',
  body_text = 'YOU ARE ON THE ROSTER — AIR ACTION SPORTS ADMIN

{{inviter_name}} has invited you to the admin panel as a {{role}}.

Click the link below to set your password and gain access.
This invite expires in 7 days.

{{accept_link}}

— Air Action Sports'
WHERE slug = 'user_invite';
