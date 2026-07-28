-- hide-review-jeffery-s.sql
--
-- Operator-requested takedown of review rv_DWWxEs0XUSDtl7 — "JEFFERY S.", 1 star,
-- "Not impressed" — on Operation Last Light (event ghost-town-iii-regular-play,
-- booking bk_nPXGlKAyJstI5T, submitted 2026-07-25).
--
-- The review's substantive complaint ("still waiting for my refund") is RESOLVED:
-- the operator refunded Jeffery in cash, outside Stripe.
--
-- This mirrors PUT /api/admin/reviews/:id { action: 'hide' } byte-for-byte
-- (worker/routes/admin/reviews.js:127-135): the status flip + hidden_* stamps +
-- a matching `review.hidden` audit row. It is a HIDE, not a delete — the row and
-- its full text survive, it simply drops out of every published-gated read
-- (public feed, /reviews, event detail, and the SSR aggregateRating).
--
-- Applied to remote D1 on 2026-07-26 as u_HGjSvaIWPIBl (bulletbiter99@gmail.com).
-- Inverse SQL at the bottom; the /admin/reviews UI can also restore it in one click.

UPDATE reviews
   SET status        = 'hidden',
       hidden_at     = strftime('%s','now') * 1000,
       hidden_reason = 'Operator takedown at owner request; the refund complaint was settled in cash.',
       hidden_by     = 'u_HGjSvaIWPIBl',
       updated_at    = strftime('%s','now') * 1000
 WHERE id = 'rv_DWWxEs0XUSDtl7'
   AND status = 'published';

INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
VALUES (
    'u_HGjSvaIWPIBl',
    'review.hidden',
    'review',
    'rv_DWWxEs0XUSDtl7',
    '{"reason":"Operator takedown at owner request; the refund complaint was settled in cash.","rating":1,"event_id":"ghost-town-iii-regular-play"}',
    strftime('%s','now') * 1000
);

-- ───── INVERSE (restore to the public feed) ─────
-- UPDATE reviews
--    SET status = 'published', hidden_at = NULL, hidden_reason = NULL,
--        hidden_by = NULL, updated_at = strftime('%s','now') * 1000
--  WHERE id = 'rv_DWWxEs0XUSDtl7';
