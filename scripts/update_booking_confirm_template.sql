-- Phase C: surface waiver-status summary in the booking confirmation email.
-- Replaces the hardcoded "Every player needs to sign a waiver before gameplay."
-- with the new {{waiver_summary}} variable that branches based on how many
-- attendees already have a valid waiver on file (annual-renewal model).

UPDATE email_templates
SET body_html = REPLACE(
        body_html,
        '<p style="margin:0;">Every player needs to sign a waiver before gameplay.</p>',
        '<p style="margin:0;">{{waiver_summary}}</p>'
    ),
    body_text = REPLACE(
        COALESCE(body_text, ''),
        'Every player needs to sign a waiver before gameplay.',
        '{{waiver_summary}}'
    ),
    updated_at = unixepoch() * 1000
WHERE slug = 'booking_confirmation';

SELECT slug, length(body_html) AS html_len,
       (instr(body_html, '{{waiver_summary}}') > 0) AS has_var,
       (instr(body_html, 'Every player needs to sign') > 0) AS has_old
FROM email_templates
WHERE slug = 'booking_confirmation';
