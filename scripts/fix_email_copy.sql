-- Update booking_confirmation template: the link goes to the booking/success page,
-- which shows per-attendee waiver links. Button label now reflects that destination.

UPDATE email_templates SET
    body_html = REPLACE(body_html, 'Sign Waiver', 'View Booking & Sign Waivers'),
    body_text = REPLACE(body_text, 'Sign waiver:', 'View booking + player waivers:'),
    updated_at = unixepoch() * 1000
WHERE slug = 'booking_confirmation';
