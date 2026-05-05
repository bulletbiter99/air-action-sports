-- Capitalize "bunker" → "Bunker" after the period in Operation Nightfall's
-- short_description. This is a one-line typo fix on a user-edited field —
-- a full UPDATE is fine here since short_description isn't hash-snapshotted
-- like waiver_documents.body_html.

UPDATE events
SET short_description = REPLACE(
        short_description,
        'site. bunker',
        'site. Bunker'
    ),
    updated_at = unixepoch() * 1000
WHERE id = 'operation-nightfall';

SELECT id, short_description FROM events WHERE id = 'operation-nightfall';
