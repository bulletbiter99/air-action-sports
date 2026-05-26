-- M6 B10 — booking_confirmation template gains a "Heads-up: additional
-- charges" section, communicating that the customer's payment method
-- (saved via M6 B5's setup_future_usage) may be charged again for
-- damages, late fees, or approved overages. The new section lives
-- between the existing "Before Game Day" block and the closing signature.
--
-- PRE-MIGRATION SPOT-CHECK
-- ============================================================
-- Confirmed via wrangler d1 execute --remote (2026-05-26):
--   - booking_confirmation row exists with the current HTML/text body
--   - Existing variables in use: event_name, player_name, event_date,
--     event_location, player_count, total_paid, booking_id,
--     waiver_summary, waiver_link
--   - This migration adds NO new variables. The new section uses static
--     copy only (no {{var}} substitution within it).
-- Lesson #7 N/A — UPDATE of existing row, not a seed.
-- M6 B3 status column DEFAULT 'published' — no need to touch status.
--
-- D1 quirks observed
-- ============================================================
-- - Single UPDATE statement, no schema change.
-- - SQL string uses single quotes; all double quotes in HTML attribute
--   values are safe; no embedded single quotes in the new content.
-- - No BEGIN/COMMIT (D1 rejects).
--
-- Rollback (if needed):
--   Restore from Cloudflare D1 24-hour automated backup. The previous
--   body content + the migration timestamp form the rollback signal.

UPDATE email_templates SET
    body_html = '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="border-left:4px solid #d4541a;padding-left:16px;margin-bottom:24px;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">■ Mission Confirmed</div>
<h1 style="font-size:24px;margin:8px 0 0;color:#f2ede4;">{{event_name}}</h1>
</div>
<p>Hey {{player_name}},</p>
<p>Your booking is locked in. Here is the briefing:</p>
<table style="width:100%;border-collapse:collapse;margin:24px 0;">
<tr><td style="padding:8px 0;color:#c8b89a;">Date</td><td style="padding:8px 0;"><strong>{{event_date}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Location</td><td style="padding:8px 0;"><strong>{{event_location}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Players</td><td style="padding:8px 0;"><strong>{{player_count}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Total Paid</td><td style="padding:8px 0;"><strong>{{total_paid}}</strong></td></tr>
<tr><td style="padding:8px 0;color:#c8b89a;">Booking ID</td><td style="padding:8px 0;font-family:monospace;">{{booking_id}}</td></tr>
</table>
<div style="background:#2e3229;padding:20px;margin:24px 0;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">■ Before Game Day</div>
<p style="margin:0;">{{waiver_summary}}</p>
<p style="margin:12px 0 0;"><a href="{{waiver_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:12px 24px;text-decoration:none;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:12px;">▶ View Booking &amp; Sign Waivers</a></p>
</div>
<div style="background:#262825;padding:16px 20px;margin:24px 0;border-left:3px solid #6b7560;">
<div style="color:#a8b59a;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">■ Heads-up — Additional Charges May Apply</div>
<p style="margin:0;font-size:13px;color:#c8b89a;">Your payment method stays on file with our payments processor (Stripe). We may charge it again only for:</p>
<ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#c8b89a;">
<li>Equipment damage or non-return at the end of your session</li>
<li>Late fees if you check in significantly past your scheduled time</li>
<li>Approved overages discussed and agreed at game day</li>
</ul>
<p style="margin:8px 0 0;font-size:12px;color:#8c9580;">We will always notify you by email before any additional charge. Reply to this email anytime to request removal of your saved payment method.</p>
</div>
<p style="color:#6b7560;font-size:12px;margin-top:32px;">Questions? Reply to this email.<br>See you on the battlefield.<br><strong style="color:#d4541a;">— Air Action Sports</strong></p>
</div>',
    body_text = 'MISSION CONFIRMED — {{event_name}}

Hey {{player_name}},

Your booking is locked in.

Date: {{event_date}}
Location: {{event_location}}
Players: {{player_count}}
Total Paid: {{total_paid}}
Booking ID: {{booking_id}}

BEFORE GAME DAY
{{waiver_summary}}
View booking + player waivers: {{waiver_link}}

HEADS-UP — ADDITIONAL CHARGES MAY APPLY
Your payment method stays on file with Stripe. We may charge it again only for:
  - Equipment damage or non-return
  - Late fees if you check in significantly late
  - Approved overages discussed at game day

We will always notify you by email before any additional charge. Reply to this email to request removal of your saved payment method.

Questions? Reply to this email.
See you on the battlefield.
— Air Action Sports',
    updated_at = 1748278800000
WHERE slug = 'booking_confirmation';
