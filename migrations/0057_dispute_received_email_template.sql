-- Email template seed for the M6 B6 charge.dispute.created webhook consumer.
-- Sent to ADMIN_NOTIFY_EMAIL whenever Stripe fires charge.dispute.created
-- against one of our charges.
--
-- PRE-MIGRATION SPOT-CHECK (relies on B0-followup capture)
-- ============================================================
-- email_templates schema confirmed:
--   id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, subject TEXT NOT NULL,
--   body_html TEXT NOT NULL, body_text TEXT, variables_json TEXT,
--   updated_by TEXT, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
--   status TEXT NOT NULL DEFAULT 'published'   (added in M6 B3, migration 0056)
--
-- Lesson #7 compliance:
--   - id='tpl_dispute_received'           ✓
--   - created_at = updated_at (= 1748246400000, which is 2026-05-26 UTC)  ✓
--   - status defaults to 'published' via the column default (M6 B3)
--
-- D1 quirks observed
-- ============================================================
-- - Single INSERT, no schema change → no D1 quirks apply.
-- - No BEGIN/COMMIT (D1 parser rejects).
-- - No table rebuild → no FK-during-DROP risk.

INSERT INTO email_templates (
    id, slug, subject, body_html, body_text, variables_json,
    updated_by, updated_at, created_at
) VALUES (
    'tpl_dispute_received',
    'dispute_received',
    '⚠ Stripe dispute opened: {{dispute_reason}} ({{amount_display}}) — booking {{booking_id}}',
    '<p>A Stripe dispute has been opened against one of your charges.</p>
<table style="border-collapse: collapse; margin: 12px 0;">
<tr><td style="padding: 4px 12px 4px 0;"><strong>Booking</strong></td><td style="padding: 4px 0;">{{booking_id}} — {{buyer_name}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Buyer email</strong></td><td style="padding: 4px 0;">{{buyer_email}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Amount</strong></td><td style="padding: 4px 0;">{{amount_display}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Reason code</strong></td><td style="padding: 4px 0;">{{dispute_reason}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Status</strong></td><td style="padding: 4px 0;">{{dispute_status}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Evidence due by</strong></td><td style="padding: 4px 0;">{{evidence_due_by}}</td></tr>
<tr><td style="padding: 4px 12px 4px 0;"><strong>Stripe dispute</strong></td><td style="padding: 4px 0;">{{dispute_id}}</td></tr>
</table>
<p><strong>What to do next:</strong></p>
<ol>
<li>Review the dispute in the <a href="https://dashboard.stripe.com/disputes/{{dispute_id}}">Stripe dashboard</a>.</li>
<li>Pull supporting evidence from <a href="{{admin_link}}">the booking detail page</a> (player roster, signed waivers, check-in scan records).</li>
<li>Submit evidence to Stripe before the due date above — late submissions auto-lose.</li>
</ol>
<p style="color: #666; font-size: 13px; margin-top: 24px;">This is an automated alert from the Air Action Sports webhook handler. Audit row recorded in the admin audit log under action=<code>dispute.received</code>.</p>',
    '⚠ Stripe dispute opened against booking {{booking_id}} ({{buyer_name}} — {{buyer_email}}).

  Amount:         {{amount_display}}
  Reason code:    {{dispute_reason}}
  Status:         {{dispute_status}}
  Evidence due:   {{evidence_due_by}}
  Stripe ID:      {{dispute_id}}

Next steps:
  1. Review the dispute in Stripe: https://dashboard.stripe.com/disputes/{{dispute_id}}
  2. Pull supporting evidence from the booking detail: {{admin_link}}
  3. Submit evidence before the due date — late submissions auto-lose.

This is an automated alert. Audit row recorded under action=dispute.received.',
    '["dispute_id","dispute_reason","dispute_status","amount_display","booking_id","buyer_name","buyer_email","evidence_due_by","admin_link"]',
    NULL,
    1748246400000,
    1748246400000
);
