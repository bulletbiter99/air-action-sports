-- Bump the public URL slug from 'operation-nightfall' (the legacy id-as-slug)
-- to 'ghost-town-ii' to match the renamed event title.
--
-- The id column stays the same — it's a foreign key from bookings,
-- attendees, etc. The /events/:id public route matches on id OR slug, so
-- both /events/operation-nightfall and /events/ghost-town-ii will resolve
-- after this update.

UPDATE events
SET slug = 'ghost-town-ii',
    updated_at = unixepoch() * 1000
WHERE id = 'operation-nightfall';

SELECT id, title, slug FROM events WHERE id = 'operation-nightfall';
