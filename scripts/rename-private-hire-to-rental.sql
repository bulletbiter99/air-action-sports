-- Rename the "Private Hire" game type to US English "Private Rental".
--
-- WHY THIS IS A SCRIPT AND NOT A CODE CHANGE
-- `sites.game_types_json` is operator-editable D1 content rendered as the game-type
-- chips on /locations (and on the home site cards via /api/sites). The site-wide
-- British→US English conversion covered every string in the repo; this is the only
-- remaining "Hire" that a visitor actually sees, and it lives in the database.
--
-- SAFETY
-- This touches DISPLAY text only. It does NOT touch:
--   * the Contact form value `private-hire`, which worker/routes/inquiry.js
--     allowlists and routes on via FIELD_RENTAL_SUBJECTS
--   * the `.private-hire` CSS classes in src/styles/pages/booking.css
--   * any route, status value, or id
-- The literal here is the spaced label "Private Hire", never the hyphenated
-- identifier, so a match on those is impossible.
--
-- RUN:
--   source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
--     npx wrangler d1 execute air-action-sports-db --remote \
--     --file=scripts/rename-private-hire-to-rental.sql
--
-- Expected: 3 rows changed (Ghost Town, Foxtrot, Trench Warfare). The Chem Plant
-- has an empty game_types_json and is untouched.

-- BEFORE (expect 3 rows, each containing "Private Hire")
SELECT id, name, game_types_json AS before_json
FROM sites
WHERE game_types_json LIKE '%Private Hire%'
ORDER BY name;

UPDATE sites
SET game_types_json = replace(game_types_json, 'Private Hire', 'Private Rental')
WHERE game_types_json LIKE '%Private Hire%';

-- AFTER (expect 0 rows — nothing should still say "Private Hire")
SELECT id, name, game_types_json AS still_british
FROM sites
WHERE game_types_json LIKE '%Private Hire%';

-- AFTER (expect the 3 renamed rows)
SELECT id, name, game_types_json AS after_json
FROM sites
WHERE game_types_json LIKE '%Private Rental%'
ORDER BY name;

-- ROLLBACK (run only if you want the British label back):
--   UPDATE sites
--   SET game_types_json = replace(game_types_json, 'Private Rental', 'Private Hire')
--   WHERE game_types_json LIKE '%Private Rental%';
