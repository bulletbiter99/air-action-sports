-- Turn ON the "title & info below the cover image" layout for Operation Last
-- Light (details.coverTextBelow = true). Its cover is a text-heavy poster, so
-- the clean below-image layout reads better than overlaying the page title on
-- the poster's own title. Applied to remote 2026-06-28.
--
-- coverTextBelow lives in events.details_json (already plumbed via formatEvent
-- -> event.details). normalizeEventDetails preserves it on admin save.

UPDATE events
SET details_json = json_set(details_json, '$.coverTextBelow', json('true')),
    updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-iii-regular-play';
