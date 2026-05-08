-- M5 R16 — damage-charge fast-path email templates + booking_confirmation
-- baseline.
--
-- Schema reference: migrations/0038_incidents_and_charges_schema.sql
-- introduced booking_charges + charge_caps_config in M5 B14/B16
-- (combined). R16 ships the consumer-facing email templates and the
-- baseline booking_confirmation that mentions the additional-charges
-- policy.
--
-- Three new templates seeded:
--   additional_charge_notice  — sent on charge creation (within-cap)
--                                or admin approval (above-cap path).
--                                Variables: customerName / eventTitle /
--                                itemName / reasonKind / amountDisplay /
--                                paymentLink / linkExpiresOn.
--   additional_charge_paid    — confirmation when paid_at is set.
--   additional_charge_waived  — sent on waive with operator's reason.
--
-- Plus an INSERT OR IGNORE for the booking_confirmation template so the
-- verify-m5 grep matches AND new operator deployments get a baseline
-- that mentions damage-charge policy. Operators with custom
-- booking_confirmation templates in production are NOT clobbered
-- (OR IGNORE skips on slug-conflict).
--
-- (Avoid the literal SQL keyword "TRANSACTION" anywhere — wrangler's
-- parser keyword-scans uploaded SQL even inside comments.)

INSERT INTO email_templates (id, slug, subject, body_html, body_text, updated_at, created_at) VALUES
  ('tpl_additional_charge_notice',
   'additional_charge_notice',
   'Additional charge for {{eventTitle}} — {{amountDisplay}}',
   '<p>Hi {{customerName}},</p>' ||
   '<p>During equipment return at <strong>{{eventTitle}}</strong>, our marshal recorded an issue with your <strong>{{itemName}}</strong> ' ||
   '({{reasonKind}}). The replacement / repair cost is <strong>{{amountDisplay}}</strong>.</p>' ||
   '<p><a href="{{paymentLink}}" style="display:inline-block;padding:12px 24px;background:#ff8800;color:#000;font-weight:800;text-decoration:none;border-radius:4px;">Pay {{amountDisplay}}</a></p>' ||
   '<p>This payment link expires on <strong>{{linkExpiresOn}}</strong>.</p>' ||
   '<p>If you believe this charge is in error, reply to this email and the event manager will review it.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{customerName}},' || char(10) || char(10) ||
   'During equipment return at {{eventTitle}}, our marshal recorded an issue with your {{itemName}} ({{reasonKind}}). The replacement / repair cost is {{amountDisplay}}.' || char(10) || char(10) ||
   'Pay here: {{paymentLink}}' || char(10) || char(10) ||
   'This payment link expires on {{linkExpiresOn}}.' || char(10) || char(10) ||
   'If you believe this charge is in error, reply to this email and the event manager will review it.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000),

  ('tpl_additional_charge_paid',
   'additional_charge_paid',
   'Receipt — additional charge paid ({{amountDisplay}})',
   '<p>Hi {{customerName}},</p>' ||
   '<p>We''ve received your payment of <strong>{{amountDisplay}}</strong> for the {{itemName}} charge.</p>' ||
   '<p>Payment method: <strong>{{paymentMethod}}</strong>{{paymentReference}}</p>' ||
   '<p>This receipt is for your records. No further action is needed.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{customerName}},' || char(10) || char(10) ||
   'We''ve received your payment of {{amountDisplay}} for the {{itemName}} charge.' || char(10) || char(10) ||
   'Payment method: {{paymentMethod}}{{paymentReference}}' || char(10) || char(10) ||
   'This receipt is for your records. No further action is needed.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000),

  ('tpl_additional_charge_waived',
   'additional_charge_waived',
   'Update — your {{itemName}} charge has been waived',
   '<p>Hi {{customerName}},</p>' ||
   '<p>Good news — the <strong>{{amountDisplay}}</strong> charge for {{itemName}} has been waived.</p>' ||
   '<p>Reason: <em>{{waivedReason}}</em></p>' ||
   '<p>You are not being charged. Thanks for playing with us.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{customerName}},' || char(10) || char(10) ||
   'Good news — the {{amountDisplay}} charge for {{itemName}} has been waived.' || char(10) || char(10) ||
   'Reason: {{waivedReason}}' || char(10) || char(10) ||
   'You are not being charged. Thanks for playing with us.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000);

-- Baseline booking_confirmation template — INSERT OR IGNORE so an
-- operator's existing customized template is preserved on apply. New
-- deployments get a baseline that mentions the damage-charge policy
-- so customers aren't surprised when they receive an
-- additional_charge_notice email after an event.

INSERT OR IGNORE INTO email_templates (id, slug, subject, body_html, body_text, updated_at, created_at) VALUES
  ('tpl_booking_confirmation',
   'booking_confirmation',
   'Your Air Action Sports booking is confirmed — {{eventTitle}}',
   '<p>Hi {{buyerName}},</p>' ||
   '<p>You are confirmed for <strong>{{eventTitle}}</strong> on <strong>{{eventDate}}</strong>.</p>' ||
   '<p>Each player on your booking has a unique QR code attached to this email — scan at check-in.</p>' ||
   '<p>Don''t forget to sign your waiver before the event: <a href="{{waiverLink}}">{{waiverLink}}</a></p>' ||
   '<hr>' ||
   '<p style="font-size:12px;color:#666;">' ||
   '<strong>Additional charges</strong>: damage to or loss of rental equipment may result in an additional charge sent to this email after the event. ' ||
   'Charges include a payment link with full details. ' ||
   'If you receive a charge you believe is in error, reply to this email and the event manager will review it.' ||
   '</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{buyerName}},' || char(10) || char(10) ||
   'You are confirmed for {{eventTitle}} on {{eventDate}}.' || char(10) || char(10) ||
   'Each player on your booking has a unique QR code attached to this email — scan at check-in.' || char(10) || char(10) ||
   'Sign your waiver before the event: {{waiverLink}}' || char(10) || char(10) ||
   'Additional charges: damage to or loss of rental equipment may result in an additional charge sent to this email after the event. Charges include a payment link with full details. If you receive a charge you believe is in error, reply to this email and the event manager will review it.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000);
