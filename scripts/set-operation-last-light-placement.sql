-- Migrate Operation Last Light to the per-surface cover-title placement model
-- (details.heroTextPlacement / bannerTextPlacement), both 'below' (clean image
-- + title beneath) -- its earlier setting. Supersedes the single coverTextBelow
-- boolean (left in place as a harmless legacy fallback; the per-surface fields
-- win on the client). Each field supports 'overlay' | 'below' | 'hidden'.
-- Applied to remote 2026-06-28.

UPDATE events
SET details_json = json_set(details_json,
      '$.heroTextPlacement', 'below',
      '$.bannerTextPlacement', 'below'),
    updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-iii-regular-play';
