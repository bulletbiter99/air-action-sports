UPDATE feedback
SET status = 'in-progress',
    priority = 'high',
    admin_note = 'Starting work — scope: file-upload attachment (not in-browser capture) + auto-delete image on resolve + opt-in "notify submitter" button.',
    updated_at = (strftime('%s', 'now') * 1000)
WHERE id = 'fb_UbhMb80wZSpy';
