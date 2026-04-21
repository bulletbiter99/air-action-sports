-- Phase 8.5: add 1hr pre-event reminder.
-- Distinct idempotency column so a booking gets both a 24hr AND a 1hr
-- reminder (each stamped independently).

ALTER TABLE bookings ADD COLUMN reminder_1hr_sent_at INTEGER;

INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at) VALUES
(
    'tpl_event_reminder_1hr',
    'event_reminder_1hr',
    '{{event_name}} starts in about an hour',
    '<!DOCTYPE html><html><body style="font-family: Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto; padding: 20px;">
<h2 style="color: #d4541a;">See you soon!</h2>
<p>Hi {{player_name}},</p>
<p>{{event_name}} kicks off in about an hour. If you haven''t already left, now''s the time to head out.</p>
<ul>
  <li><strong>Where:</strong> {{event_location}}</li>
  <li><strong>Check-in:</strong> {{check_in}}</li>
  <li><strong>First game:</strong> {{first_game}}</li>
</ul>
<p><strong>Last-minute checklist:</strong></p>
<ol>
  <li>Photo ID for the buyer</li>
  <li>Water &amp; snacks for the day</li>
  <li>Every player''s waiver signed — <a href="{{waiver_link}}">check here</a></li>
</ol>
<p>Drive safe,<br/>Air Action Sports</p>
</body></html>',
    'Hi {{player_name}},

{{event_name}} kicks off in about an hour. If you haven''t already left, now''s the time to head out.

Where: {{event_location}}
Check-in: {{check_in}}
First game: {{first_game}}

Last-minute checklist:
1. Photo ID for the buyer
2. Water & snacks for the day
3. Every player''s waiver signed: {{waiver_link}}

Drive safe,
Air Action Sports',
    '["player_name","event_name","event_location","check_in","first_game","waiver_link","booking_id"]',
    unixepoch() * 1000,
    unixepoch() * 1000
);
