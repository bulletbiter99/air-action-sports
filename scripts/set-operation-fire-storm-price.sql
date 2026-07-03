-- Set Operation Fire Storm (event `ghost-town-18hr-milsim`) to its finalized
-- price: $80 (was the $110 placeholder from scripts/seed-operation-fire-storm.sql).
-- Operator-confirmed 2026-07-01. Event stays a DRAFT (published unchanged).
-- Both the event base "from" price and the single Full Event ticket are set.

UPDATE events
SET base_price_cents = 8000, updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-18hr-milsim';

UPDATE ticket_types
SET price_cents = 8000, updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_gt_firestorm';
