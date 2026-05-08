-- M5 R9 — seed event_staff_invite + event_staff_reminder email templates
-- used by the staffing assignment flow + the reminder cron sweep.
--
-- event_staff_invite: sent immediately when an admin assigns a person to
-- an event (POST /api/admin/event-staffing). Includes a magic link to the
-- portal so the staffer can RSVP without an admin login.
--
-- event_staff_reminder: sent by the runEventStaffingReminderSweep cron at
-- 7d/3d/1d/day_of milestones for confirmed or pending assignments.
--
-- Variables provided per send:
--   event_staff_invite:
--     {{personName}}        — staffer's full_name
--     {{eventTitle}}        — events.title
--     {{eventDate}}          — events.display_date or YYYY-MM-DD fallback
--     {{roleName}}          — roles.name (e.g. "Event Director", "Field Marshal")
--     {{shiftStartTime}}    — formatted local time of shift start
--     {{rsvpLink}}          — /portal magic-link URL
--   event_staff_reminder:
--     same vars + {{windowLabel}} ("today" / "tomorrow" / "in 3 days" etc.)
--
-- Avoid the literal SQL keyword "TRANSACTION" anywhere — wrangler's
-- parser keyword-scans uploaded SQL even inside comments.

INSERT INTO email_templates (slug, subject, body_html, body_text, updated_at) VALUES
  ('event_staff_invite',
   'You''re invited to staff {{eventTitle}} on {{eventDate}}',
   '<p>Hi {{personName}},</p>' ||
   '<p>You''ve been assigned to staff <strong>{{eventTitle}}</strong> on <strong>{{eventDate}}</strong> as <strong>{{roleName}}</strong>.</p>' ||
   '<p><strong>Shift starts:</strong> {{shiftStartTime}}</p>' ||
   '<p><a href="{{rsvpLink}}" style="display:inline-block;padding:12px 24px;background:#d4541a;color:white;text-decoration:none;font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-size:13px;">RSVP via the staff portal</a></p>' ||
   '<p>Please RSVP within 48 hours. If you cannot make this event, reply to this email so we can find someone else.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{personName}},' || char(10) || char(10) ||
   'You''ve been assigned to staff {{eventTitle}} on {{eventDate}} as {{roleName}}.' || char(10) || char(10) ||
   'Shift starts: {{shiftStartTime}}' || char(10) || char(10) ||
   'RSVP via the staff portal: {{rsvpLink}}' || char(10) || char(10) ||
   'Please RSVP within 48 hours. If you cannot make this event, reply to this email so we can find someone else.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000),

  ('event_staff_reminder',
   'Reminder: you''re on the schedule for {{eventTitle}} ({{windowLabel}})',
   '<p>Hi {{personName}},</p>' ||
   '<p>Quick reminder — you''re scheduled to staff <strong>{{eventTitle}}</strong> on <strong>{{eventDate}}</strong> as <strong>{{roleName}}</strong>, starting <strong>{{shiftStartTime}}</strong> ({{windowLabel}}).</p>' ||
   '<p>If anything has changed and you can no longer attend, please reply to this email immediately so we can find a replacement.</p>' ||
   '<p>See you at the event!</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{personName}},' || char(10) || char(10) ||
   'Quick reminder — you''re scheduled to staff {{eventTitle}} on {{eventDate}} as {{roleName}}, starting {{shiftStartTime}} ({{windowLabel}}).' || char(10) || char(10) ||
   'If anything has changed and you can no longer attend, please reply to this email immediately so we can find a replacement.' || char(10) || char(10) ||
   'See you at the event!' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000);
