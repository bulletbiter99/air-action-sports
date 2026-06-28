-- Restore Operation Last Light's title placement to below/below after a save
-- from a stale admin tab (pre-per-surface-dropdowns) reset it to overlay.
-- Keeps coverTextBelow=true so a still-stale tab's save maps back to 'below'
-- via the normalizeEventDetails legacy fallback. Applied to remote 2026-06-28.

UPDATE events
SET details_json = json_set(details_json,
      '$.heroTextPlacement', 'below',
      '$.bannerTextPlacement', 'below',
      '$.coverTextBelow', json('true')),
    updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-iii-regular-play';
