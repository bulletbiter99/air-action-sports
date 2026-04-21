-- Phase 8: event reminder emails
-- Track which bookings have already received a 24hr reminder, and seed the
-- editable template admins can customize from the DB.

ALTER TABLE bookings ADD COLUMN reminder_sent_at INTEGER;

INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at) VALUES
(
    'tpl_event_reminder_24h',
    'event_reminder_24h',
    'Reminder: {{event_name}} is tomorrow',
    '<!DOCTYPE html><html><body style="font-family: Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto; padding: 20px;">
<h2 style="color: #d4541a;">{{event_name}} is tomorrow!</h2>
<p>Hi {{player_name}},</p>
<p>This is a friendly reminder that your airsoft event starts tomorrow:</p>
<ul>
  <li><strong>When:</strong> {{event_date}}</li>
  <li><strong>Where:</strong> {{event_location}}</li>
  <li><strong>Check-in:</strong> {{check_in}}</li>
  <li><strong>First game:</strong> {{first_game}}</li>
</ul>
<p><strong>Before you arrive:</strong></p>
<ol>
  <li>Confirm every player on your booking has signed their waiver. <a href="{{waiver_link}}">View your booking &amp; waivers</a></li>
  <li>Bring a photo ID if you''re checking in as the buyer.</li>
  <li>Wear clothes appropriate for the weather and terrain.</li>
</ol>
<p>If you have any questions, just reply to this email.</p>
<p>See you on the field,<br/>Air Action Sports</p>
<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;"/>
<p style="font-size: 11px; color: #888;">Booking ID: {{booking_id}}</p>
</body></html>',
    'Hi {{player_name}},

This is a friendly reminder that {{event_name}} starts tomorrow.

When: {{event_date}}
Where: {{event_location}}
Check-in: {{check_in}}
First game: {{first_game}}

Before you arrive:
1. Confirm every player on your booking has signed their waiver: {{waiver_link}}
2. Bring a photo ID if you''re checking in as the buyer.
3. Wear clothes appropriate for the weather and terrain.

Reply to this email with any questions.

See you on the field,
Air Action Sports

Booking ID: {{booking_id}}',
    '["player_name","event_name","event_date","event_location","check_in","first_game","waiver_link","booking_id"]',
    unixepoch() * 1000,
    unixepoch() * 1000
);
