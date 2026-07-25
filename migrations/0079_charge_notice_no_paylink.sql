-- 0079_charge_notice_no_paylink.sql
-- Sprint 2 (2026-07 admin workflow audit, finding A3) — stop emailing customers
-- a payment link that goes nowhere.
--
-- WHY
-- ---
-- The additional_charge_notice template seeded in 0043 links to
--   {{SITE_URL}}/admin/booking-charges/pay/<token>
-- No such SPA route and no such worker route has ever existed. src/App.jsx
-- registers `booking-charges` as an exact-segment child with no splat, so the
-- URL falls through to the public catch-all; because wrangler.toml sets
-- not_found_handling = "single-page-application" the customer gets a 200 that
-- renders the site's "page not found" screen.
--
-- The landing was specified at /api/admin/booking-charges/pay/:token — inside a
-- router that applies requireAuth to '*'. Had it been built there as designed a
-- customer clicking the link would have received 401. The feature was never
-- architecturally viable as specified; M6 shipped the off-session card charge
-- (POST /:id/charge-card) instead and the landing page was never revisited.
--
-- Nobody has been hit by this: booking_charges is EMPTY in production (verified
-- 2026-07-25), because the only thing that creates a charge is the event-day
-- kiosk, and event_day_sessions is empty too — no kiosk session has ever been
-- opened. This is a latent bug being closed before it can fire, not an incident.
--
-- WHAT CHANGES
-- ------------
-- Rewrites the notice body to drop {{paymentLink}} and {{linkExpiresOn}} and
-- tell the customer the manager will arrange payment. The operator-side paths
-- that actually work are unchanged: "Charge card" (off-session, when the booking
-- has a saved payment method) and "Mark paid" (Venmo / PayPal / cash / check).
--
-- Content-only UPDATE on an existing row: the renderer reads the template from
-- D1 per send, so this needs no redeploy. Migrations are forward-only — 0043 is
-- not edited in place.
--
-- D1 quirks honored: no transaction-control keywords; single UPDATE.

UPDATE email_templates
SET body_html =
      '<p>Hi {{customerName}},</p>' ||
      '<p>During equipment return at <strong>{{eventTitle}}</strong>, our marshal recorded an issue with your <strong>{{itemName}}</strong> ' ||
      '({{reasonKind}}). The replacement / repair cost is <strong>{{amountDisplay}}</strong>.</p>' ||
      '<p>Reply to this email and the event manager will arrange payment with you — we can take card, Venmo, PayPal, cash or check.</p>' ||
      '<p>If you believe this charge is in error, reply and the event manager will review it.</p>' ||
      '<p>— The Air Action Sports team</p>',
    body_text =
      'Hi {{customerName}},' || char(10) || char(10) ||
      'During equipment return at {{eventTitle}}, our marshal recorded an issue with your {{itemName}} ({{reasonKind}}). The replacement / repair cost is {{amountDisplay}}.' || char(10) || char(10) ||
      'Reply to this email and the event manager will arrange payment with you - we can take card, Venmo, PayPal, cash or check.' || char(10) || char(10) ||
      'If you believe this charge is in error, reply and the event manager will review it.' || char(10) || char(10) ||
      '- The Air Action Sports team',
    updated_at = strftime('%s','now') * 1000
WHERE slug = 'additional_charge_notice';
