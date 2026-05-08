-- M5 R11 — seed w9_reminder email template used by
-- worker/lib/thresholds1099.js runTaxYearAutoLockSweep cron.
--
-- Sent to recipients in a given tax year who hit the IRS 1099-NEC
-- threshold ($600) but lack a legal_name or EIN on file. Without
-- those fields the bookkeeper cannot file a clean 1099-NEC for them.
--
-- Variables provided per send:
--   {{personName}}        — recipient's full_name from persons row
--   {{taxYear}}           — the tax year being filed (e.g., 2025)
--   {{total1099Display}}  — formatted "$X,XXX.XX" total
--   {{requiredBy}}        — formatted "January 31, YYYY+1" deadline
--
-- The cron uses audit_log rows as the idempotency sentinel — each
-- recipient receives at most one reminder per tax year (sentinel
-- target_id is "{personId}:{taxYear}").
--
-- (Avoid the literal SQL keyword "TRANSACTION" anywhere — wrangler's
-- parser keyword-scans uploaded SQL even inside comments.)

INSERT INTO email_templates (id, slug, subject, body_html, body_text, updated_at, created_at) VALUES
  ('tpl_w9_reminder',
   'w9_reminder',
   'Action needed — submit a W-9 for {{taxYear}} tax filing ({{total1099Display}})',
   '<p>Hi {{personName}},</p>' ||
   '<p>Our records show your <strong>{{taxYear}}</strong> 1099 earnings with Air Action Sports total <strong>{{total1099Display}}</strong>, ' ||
   'which is at or above the IRS reporting threshold of $600. To file a clean 1099-NEC for you we need your full legal name and EIN (or SSN) on a W-9.</p>' ||
   '<p><strong>Please send us a completed W-9 by {{requiredBy}}</strong> so we can file by the IRS deadline. ' ||
   'Reply to this email with the form attached, or ask if you would like us to send a fillable PDF.</p>' ||
   '<p>If you''ve already submitted a W-9 for {{taxYear}}, reply and we''ll double-check our records.</p>' ||
   '<p>— The Air Action Sports team</p>',
   'Hi {{personName}},' || char(10) || char(10) ||
   'Our records show your {{taxYear}} 1099 earnings with Air Action Sports total {{total1099Display}}, which is at or above the IRS reporting threshold of $600. To file a clean 1099-NEC for you we need your full legal name and EIN (or SSN) on a W-9.' || char(10) || char(10) ||
   'Please send us a completed W-9 by {{requiredBy}} so we can file by the IRS deadline. Reply to this email with the form attached, or ask if you would like us to send a fillable PDF.' || char(10) || char(10) ||
   'If you''ve already submitted a W-9 for {{taxYear}}, reply and we''ll double-check our records.' || char(10) || char(10) ||
   '— The Air Action Sports team',
   strftime('%s','now') * 1000,
   strftime('%s','now') * 1000);
