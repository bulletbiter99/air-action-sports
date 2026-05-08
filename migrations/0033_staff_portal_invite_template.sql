-- M5 Batch 6 — seed the staff_portal_invite email template used by the
-- POST /api/admin/staff/:id/invite admin action. Variables provided by
-- the inviter at send time:
--   {{personName}}       — recipient's full_name from persons row
--   {{inviterName}}      — admin display_name who triggered the invite
--   {{magicLink}}        — full URL https://airactionsport.com/portal/auth/consume?token=...
--   {{expiresAt}}        — formatted expiry (24h from mint by default)

INSERT INTO email_templates (id, slug, subject, body_html, body_text, updated_at, created_at) VALUES
  ('tpl_staff_portal_invite',
   'staff_portal_invite',
   'You have been invited to the Air Action Sports staff portal',
   '<p>Hi {{personName}},</p>' ||
   '<p>{{inviterName}} has invited you to access the Air Action Sports staff portal. ' ||
   'The portal is where you can view documents assigned to your role, acknowledge policies, ' ||
   'and review your upcoming events + pay history.</p>' ||
   '<p><a href="{{magicLink}}" style="display:inline-block;padding:12px 24px;background:#d4541a;color:white;text-decoration:none;font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-size:13px;">Accept invitation</a></p>' ||
   '<p>This link expires <strong>{{expiresAt}}</strong>. Clicking it once signs you in to the portal — no password needed.</p>' ||
   '<p>If you were not expecting this invitation, you can safely ignore this email.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{personName}},' || char(10) || char(10) ||
   '{{inviterName}} has invited you to access the Air Action Sports staff portal.' || char(10) ||
   'The portal is where you view documents assigned to your role, acknowledge policies, and review your upcoming events + pay history.' || char(10) || char(10) ||
   'Accept your invitation here: {{magicLink}}' || char(10) || char(10) ||
   'This link expires {{expiresAt}}. Clicking it once signs you in to the portal — no password needed.' || char(10) || char(10) ||
   'If you were not expecting this invitation, you can ignore this email.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000);
