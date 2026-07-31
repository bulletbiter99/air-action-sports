-- Retire the "Echo Urban" name from the sites table — 2026-07-31
--
-- NOT YET APPLIED. Operator runs this; Claude does not mutate remote D1.
--
-- WHY
-- The CQB site has carried two names simultaneously. The sites row is
-- name='Trench Warfare' (slug 'trench-warfare'), but its location_blurb reads
-- "CQB Site — Echo Urban Warehouse", so the public cards on / and /locations
-- render the heading "Trench Warfare" directly above the subtitle "Echo Urban
-- Warehouse".
--
-- "Echo Urban" is not a site the business has ever operated. It also appeared
-- in a fabricated testimonial ("Never played CQB in a warehouse before"),
-- deleted in PR #420, and in the homepage gallery tile + About timeline, fixed
-- in code. This row is the LAST place the name survives — and the only one
-- that is data rather than code, which is why it needs an operator to run it.
--
-- The operator chose the D1 names (Trench Warfare / Foxtrot) as canonical, so
-- the blurb becomes a plain venue descriptor with no second name in it.
--
-- VERIFY BEFORE
--   SELECT id, name, location_blurb FROM sites WHERE slug = 'trench-warfare';
--   -- expect: site_trenchwarfare01 | Trench Warfare | CQB Site — Echo Urban Warehouse
--
-- APPLY
--   source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
--     npx wrangler d1 execute air-action-sports-db --remote \
--     --file=scripts/rename-echo-urban-blurb.sql
--
-- VERIFY AFTER
--   SELECT id, name, location_blurb FROM sites WHERE slug = 'trench-warfare';
--   -- expect: ... | Trench Warfare | CQB Site — Indoor Warehouse
--   curl -s https://airactionsport.com/api/sites | grep -i "echo urban"
--   -- expect: no output
--
-- REVERSIBLE: the prior value is recorded above. To undo, set location_blurb
-- back to 'CQB Site — Echo Urban Warehouse'.
--
-- NOTE: the em dash below is U+2014, matching the other site blurbs
-- ("Rural Neighborhood — 19 Buildings"). Keep it consistent or the cards
-- render with mismatched punctuation.

UPDATE sites
SET location_blurb = 'CQB Site — Indoor Warehouse'
WHERE slug = 'trench-warfare'
  AND location_blurb = 'CQB Site — Echo Urban Warehouse';
