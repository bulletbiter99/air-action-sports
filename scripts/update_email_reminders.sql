-- Realign event reminder templates with booking_confirmation/waiver_request brand
-- (dark theme, militaristic tone, matching layout)

UPDATE email_templates
SET
  body_html = '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="border-left:4px solid #d4541a;padding-left:16px;margin-bottom:24px;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">&#9632; T-minus 24 hours</div>
<h1 style="font-size:24px;margin:8px 0 0;color:#f2ede4;">{{event_name}}</h1>
</div>
<p>Hey {{player_name}},</p>
<p>Your op kicks off tomorrow. Final briefing:</p>
<table style="width:100%;border-collapse:collapse;margin:24px 0;">
<tr><td style="padding:8px 0;color:#c8b89a;">Date</td><td style="padding:8px 0;"><strong>{{event_date}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Location</td><td style="padding:8px 0;"><strong>{{event_location}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Check-in</td><td style="padding:8px 0;"><strong>{{check_in}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">First game</td><td style="padding:8px 0;"><strong>{{first_game}}</strong></td></tr>
</table>
<div style="background:#2e3229;padding:20px;margin:24px 0;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">&#9632; Pre-deployment checklist</div>
<ol style="margin:0;padding-left:20px;line-height:1.8;">
<li>Every player on your booking has signed their waiver</li>
<li>Photo ID for the buyer at check-in</li>
<li>Dress for the weather and terrain</li>
<li>Water, snacks, anything you cannot live without for a full day</li>
</ol>
<p style="margin:16px 0 0;"><a href="{{waiver_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:12px;">&#9658; View Booking &amp; Waivers</a></p>
</div>
<p style="color:#6b7560;font-size:12px;margin-top:32px;">Questions? Reply to this email.<br>See you on the battlefield.<br><strong style="color:#d4541a;">&mdash; Air Action Sports</strong></p>
<p style="color:#6b7560;font-size:11px;margin-top:16px;">Booking ID: {{booking_id}}</p>
</div>',
  body_text = 'T-MINUS 24 HOURS — {{event_name}}

Hey {{player_name}},

Your op kicks off tomorrow.

Date: {{event_date}}
Location: {{event_location}}
Check-in: {{check_in}}
First game: {{first_game}}

PRE-DEPLOYMENT CHECKLIST
1. Every player has signed their waiver
2. Photo ID for the buyer at check-in
3. Dress for the weather and terrain
4. Water, snacks, anything for a full day

View booking + waivers: {{waiver_link}}

Questions? Reply to this email.
See you on the battlefield.
— Air Action Sports

Booking ID: {{booking_id}}'
WHERE slug = 'event_reminder_24h';

UPDATE email_templates
SET
  body_html = '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="border-left:4px solid #d4541a;padding-left:16px;margin-bottom:24px;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">&#9632; T-minus 1 hour</div>
<h1 style="font-size:24px;margin:8px 0 0;color:#f2ede4;">Boots on the ground</h1>
</div>
<p>Hey {{player_name}},</p>
<p>{{event_name}} kicks off in about an hour. If you are not already rolling, now is the time.</p>
<table style="width:100%;border-collapse:collapse;margin:24px 0;">
<tr><td style="padding:8px 0;color:#c8b89a;">Location</td><td style="padding:8px 0;"><strong>{{event_location}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Check-in</td><td style="padding:8px 0;"><strong>{{check_in}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">First game</td><td style="padding:8px 0;"><strong>{{first_game}}</strong></td></tr>
</table>
<div style="background:#2e3229;padding:20px;margin:24px 0;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">&#9632; Last check</div>
<ol style="margin:0;padding-left:20px;line-height:1.8;">
<li>Photo ID</li>
<li>Water &amp; snacks</li>
<li>All waivers signed &mdash; <a href="{{waiver_link}}" style="color:#d4541a;">verify here</a></li>
</ol>
</div>
<p style="color:#6b7560;font-size:12px;margin-top:32px;">Drive safe.<br><strong style="color:#d4541a;">&mdash; Air Action Sports</strong></p>
</div>',
  body_text = 'T-MINUS 1 HOUR — BOOTS ON THE GROUND

Hey {{player_name}},

{{event_name}} kicks off in about an hour. If you are not already rolling, now is the time.

Location: {{event_location}}
Check-in: {{check_in}}
First game: {{first_game}}

LAST CHECK
1. Photo ID
2. Water & snacks
3. All waivers signed — {{waiver_link}}

Drive safe.
— Air Action Sports'
WHERE slug = 'event_reminder_1hr';
