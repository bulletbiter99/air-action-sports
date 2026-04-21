-- Phase 9: team invites — invite staff/manager/owner to join the admin panel.
-- Token-based, same shape as password_resets. Accepting the invite creates the
-- user account with the invited role and logs them in.

CREATE TABLE invitations (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    invited_by TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
);

CREATE INDEX idx_invitations_email ON invitations(email, consumed_at, revoked_at);

INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at) VALUES
(
    'tpl_user_invite',
    'user_invite',
    'You''re invited to the Air Action Sports admin',
    '<!DOCTYPE html><html><body style="font-family: Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto; padding: 20px;">
<h2 style="color: #d4541a;">You''re invited</h2>
<p>Hi,</p>
<p>{{inviter_name}} has invited you to the Air Action Sports admin panel as a <strong>{{role}}</strong>.</p>
<p><a href="{{accept_link}}" style="display: inline-block; padding: 12px 24px; background: #d4541a; color: #fff; text-decoration: none; font-weight: bold; letter-spacing: 1px;">Accept invite &amp; set password</a></p>
<p style="font-size: 12px; color: #888;">Or paste this link into your browser:<br/>{{accept_link}}</p>
<p style="font-size: 12px; color: #888;">This invite expires in 7 days.</p>
</body></html>',
    'Hi,

{{inviter_name}} has invited you to the Air Action Sports admin panel as a {{role}}.

Accept your invite and set a password:
{{accept_link}}

This invite expires in 7 days.',
    '["inviter_name","role","accept_link"]',
    unixepoch() * 1000,
    unixepoch() * 1000
);
