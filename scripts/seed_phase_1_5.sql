-- Phase 1.5 seed data:
--   1. Default "Standard" ticket type for Operation Nightfall
--   2. Update addons_json on existing event to include 'type' (rental/consumable)
--   3. Default email templates

-- 1. Standard ticket type for Operation Nightfall
INSERT INTO ticket_types (
    id, event_id, name, description,
    price_cents, capacity, min_per_order, max_per_order,
    sort_order, active, created_at, updated_at
) VALUES (
    'tt_nightfall_standard',
    'operation-nightfall',
    'Standard Ticket',
    'Full-day airsoft event access — all game modes, marshals, and field time included.',
    8000,
    350,
    1,
    20,
    0,
    1,
    unixepoch() * 1000,
    unixepoch() * 1000
);

-- 2. Update addons on Operation Nightfall to include type + rental pool links
UPDATE events SET addons_json = '[
  {"sku":"sword-rifle","name":"Sword Rifle Package","type":"rental","rental_pool_sku":"sword-rifle","price_cents":3500,"description":"Airsoft battery-powered Sword rifle, 2 mags, 1,000 rounds, vest, and eye protection","max_per_order":null,"total_inventory":null},
  {"sku":"srs-sniper","name":"SRS Sniper Package","type":"rental","rental_pool_sku":"srs-sniper","price_cents":2500,"description":"Bolt-action SRS sniper, 1 mag, 1,000 rounds, vest, and eye protection","max_per_order":null,"total_inventory":null},
  {"sku":"bbs-20g-10k","name":"20g BBs (10,000 count)","type":"consumable","price_cents":3000,"description":"10,000 count 20g BBs","max_per_order":null,"total_inventory":null}
]',
updated_at = unixepoch() * 1000
WHERE id = 'operation-nightfall';

-- 3. Default email templates
INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at) VALUES
(
    'tpl_booking_confirmation',
    'booking_confirmation',
    'Mission Confirmed — {{event_name}} ({{event_date}})',
    '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="border-left:4px solid #d4541a;padding-left:16px;margin-bottom:24px;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">■ Mission Confirmed</div>
<h1 style="font-size:24px;margin:8px 0 0;color:#f2ede4;">{{event_name}}</h1>
</div>
<p>Hey {{player_name}},</p>
<p>Your booking is locked in. Here''s the briefing:</p>
<table style="width:100%;border-collapse:collapse;margin:24px 0;">
<tr><td style="padding:8px 0;color:#c8b89a;">Date</td><td style="padding:8px 0;"><strong>{{event_date}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Location</td><td style="padding:8px 0;"><strong>{{event_location}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Players</td><td style="padding:8px 0;"><strong>{{player_count}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Total Paid</td><td style="padding:8px 0;"><strong>{{total_paid}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Booking ID</td><td style="padding:8px 0;font-family:monospace;">{{booking_id}}</td></tr>
</table>
<div style="background:#2e3229;padding:20px;margin:24px 0;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">■ Before Game Day</div>
<p style="margin:0;">Every player needs to sign a waiver before gameplay.</p>
<p style="margin:12px 0 0;"><a href="{{waiver_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:12px;">▶ Sign Waiver</a></p>
</div>
<p style="color:#6b7560;font-size:12px;margin-top:32px;">Questions? Reply to this email.<br>See you on the battlefield.<br><strong style="color:#d4541a;">— Air Action Sports</strong></p>
</div>',
    'MISSION CONFIRMED — {{event_name}}

Hey {{player_name}},

Your booking is locked in.

Date: {{event_date}}
Location: {{event_location}}
Players: {{player_count}}
Total Paid: {{total_paid}}
Booking ID: {{booking_id}}

BEFORE GAME DAY
Every player needs to sign a waiver before gameplay.
Sign waiver: {{waiver_link}}

Questions? Reply to this email.
See you on the battlefield.
— Air Action Sports',
    '["player_name","event_name","event_date","event_location","player_count","total_paid","booking_id","waiver_link"]',
    unixepoch() * 1000,
    unixepoch() * 1000
),
(
    'tpl_waiver_request',
    'waiver_request',
    'Waiver required — {{event_name}}',
    '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">■ Waiver Required</div>
<h1 style="font-size:24px;margin:8px 0 24px;">Safety first, {{player_name}}.</h1>
<p>Before you deploy at <strong>{{event_name}}</strong> on <strong>{{event_date}}</strong>, you need to complete a waiver.</p>
<p>It takes about 2 minutes.</p>
<p style="margin:24px 0;"><a href="{{waiver_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:14px 28px;text-decoration:none;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:13px;">▶ Complete Waiver</a></p>
<p style="color:#6b7560;font-size:12px;">Under 18? A parent or guardian will sign on the same form.</p>
<p style="color:#6b7560;font-size:12px;margin-top:24px;"><strong style="color:#d4541a;">— Air Action Sports</strong></p>
</div>',
    'WAIVER REQUIRED — {{event_name}}

{{player_name}},

Before you deploy at {{event_name}} on {{event_date}}, you need to complete a waiver. Takes about 2 minutes.

Complete waiver: {{waiver_link}}

Under 18? A parent or guardian will sign on the same form.

— Air Action Sports',
    '["player_name","event_name","event_date","waiver_link"]',
    unixepoch() * 1000,
    unixepoch() * 1000
),
(
    'tpl_admin_notify',
    'admin_notify',
    'New booking: {{event_name}} — {{player_count}} players (${{total_paid}})',
    '<div style="font-family:system-ui,sans-serif;padding:24px;max-width:600px;">
<h2 style="color:#d4541a;border-bottom:2px solid #d4541a;padding-bottom:8px;">New Booking</h2>
<table style="width:100%;border-collapse:collapse;">
<tr><td style="padding:6px 0;color:#666;">Event</td><td style="padding:6px 0;"><strong>{{event_name}}</strong></td></tr>
<tr><td style="padding:6px 0;color:#666;">Customer</td><td style="padding:6px 0;"><strong>{{player_name}}</strong></td></tr>
<tr><td style="padding:6px 0;color:#666;">Email</td><td style="padding:6px 0;">{{player_email}}</td></tr>
<tr><td style="padding:6px 0;color:#666;">Phone</td><td style="padding:6px 0;">{{player_phone}}</td></tr>
<tr><td style="padding:6px 0;color:#666;">Players</td><td style="padding:6px 0;">{{player_count}}</td></tr>
<tr><td style="padding:6px 0;color:#666;">Total</td><td style="padding:6px 0;"><strong>${{total_paid}}</strong></td></tr>
<tr><td style="padding:6px 0;color:#666;">Booking ID</td><td style="padding:6px 0;font-family:monospace;">{{booking_id}}</td></tr>
</table>
<p><a href="{{admin_link}}">View in admin →</a></p>
</div>',
    'NEW BOOKING

Event: {{event_name}}
Customer: {{player_name}}
Email: {{player_email}}
Phone: {{player_phone}}
Players: {{player_count}}
Total: ${{total_paid}}
Booking ID: {{booking_id}}

View in admin: {{admin_link}}',
    '["event_name","player_name","player_email","player_phone","player_count","total_paid","booking_id","admin_link"]',
    unixepoch() * 1000,
    unixepoch() * 1000
);
