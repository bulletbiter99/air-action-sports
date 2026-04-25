DELETE FROM attendees WHERE booking_id IN ('bk_rU3KFd8b0JXD1t', 'bk_8m68YTFgKyqLyk');
DELETE FROM bookings WHERE id IN ('bk_rU3KFd8b0JXD1t', 'bk_8m68YTFgKyqLyk');
-- Also decrement sold for the venmo booking (1 ticket)
UPDATE ticket_types SET sold = MAX(0, sold - 1), updated_at = (strftime('%s','now')*1000)
WHERE id = 'tt_nightfall_standard';
