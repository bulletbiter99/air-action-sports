-- 0027_bookings_refund_external.sql
--
-- M4 B3a — out-of-band refund flow on the bookings table + the
-- refund_recorded_external email template seed.
--
-- Adds 4 nullable columns to bookings so the admin "external refund"
-- workflow (cash / venmo / paypal / comp / waived) can be recorded
-- alongside the existing Stripe-refund path. All columns are nullable
-- (well, refund_external defaults to 0 so no NULL values land in
-- existing rows) — no column-rename pattern needed (M3 D1 quirk #2 only
-- applies when adding a NOT NULL column without a DEFAULT).
--
-- Schema additions:
--   refund_external            INTEGER NOT NULL DEFAULT 0  (0 = stripe-refund or unrefunded; 1 = out-of-band)
--   refund_external_method     TEXT (cash | venmo | paypal | comp | waived)
--   refund_external_reference  TEXT (operator-entered identifier — Venmo txn id, check #, etc.)
--   refund_requested_at        INTEGER (ms; when the refund process started, may differ from refunded_at)
--
-- Email template seed: refund_recorded_external — sent unconditionally
-- when an out-of-band refund is recorded (D06 — no opt-out). Variables
-- documented in the variables_json column. Body uses the same {{var}}
-- interpolation as the other 16 seeded templates.
--
-- D1 quirks observed in this migration:
--   * No BEGIN/COMMIT keywords (M3 D1 quirk #1 — wrangler keyword-scans
--     even SQL comments; the word "transaction" is rephrased throughout).
--   * Column-rename pattern not needed (no NOT NULL constraint without
--     a DEFAULT — the only non-null column has a literal 0 default).
--
-- Operator applies via:
--   CLOUDFLARE_API_TOKEN=$TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote
-- after M4 B3a merges to main. Until applied:
--   * GET /api/admin/bookings/:id still works (formatBooking handles
--     the absent columns with null defaults via row[col] || null).
--   * POST /api/admin/bookings/:id/refund-external errors on UPDATE
--     (no such column). The B3b admin UI hides the external-refund
--     modal until the columns exist (or accepts the brief error
--     window — same pattern as B2a/0026 saved_views).

ALTER TABLE bookings ADD COLUMN refund_external INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN refund_external_method TEXT;
ALTER TABLE bookings ADD COLUMN refund_external_reference TEXT;
ALTER TABLE bookings ADD COLUMN refund_requested_at INTEGER;

INSERT OR IGNORE INTO email_templates
    (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at)
VALUES (
    'et_refund_recorded_external',
    'refund_recorded_external',
    'Refund issued for your AAS booking',
    '<p>Hi {{player_name}},</p>' ||
    '<p>This confirms that a <strong>${{amount_refunded}}</strong> refund has been issued ' ||
    'for your booking on <strong>{{event_name}}</strong> ({{event_date}}).</p>' ||
    '<p><strong>Method:</strong> {{method_label}}<br>' ||
    '<strong>Reference:</strong> {{reference}}</p>' ||
    '<p>You should see the refund within a few business days depending on the ' ||
    'payment method. If you don''t see it or have any questions, please reply to this ' ||
    'email or contact us at {{support_email}}.</p>' ||
    '<p>Thanks,<br>Air Action Sports</p>',
    'Hi {{player_name}}, ' ||
    'This confirms that a ${{amount_refunded}} refund has been issued for your booking ' ||
    'on {{event_name}} ({{event_date}}). ' ||
    'Method: {{method_label}}. Reference: {{reference}}. ' ||
    'You should see the refund within a few business days depending on the payment ' ||
    'method. If you don''t see it or have any questions, please reply or contact us ' ||
    'at {{support_email}}. ' ||
    'Thanks, Air Action Sports',
    '["player_name","event_name","event_date","amount_refunded","method_label","reference","support_email"]',
    strftime('%s','now') * 1000,
    strftime('%s','now') * 1000
);
