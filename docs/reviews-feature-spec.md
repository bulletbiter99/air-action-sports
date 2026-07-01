# Attendee-Verified Reviews — Locked Implementation Spec

Status: **✅ FEATURE COMPLETE + DEPLOYED (2026-06-28 → 06-30).** All 7 batches shipped (PRs #351–#356, #358, #359); migration `0077` applied to prod D1; every surface live (invite cron, public `/api/reviews`, admin moderation, SSR crawler-visible `aggregateRating`, public `/review` + `/reviews` UI). Dormant in prod until the first review (~2026-07-25, after Operation Last Light ends). Deploy/activation runbook: [`docs/runbooks/reviews-deploy.md`](runbooks/reviews-deploy.md). This doc remains the implementation reference; the sections below are the as-built design. Produced by a multi-agent design + adversarial-review pass (4 design lenses → 3 red-team reviewers → synthesis); **28 findings (3 critical / 10 high / 7 medium / 8 low)** were folded in. Locked product decisions: **verified attendees only · one review per booking · auto-publish with admin takedown · display everywhere (real aggregateRating + home + event pages + /reviews).**

## 1. Flow
~24h after an event ends, the nightly `0 3 * * *` cron emails each `paid`/`comp` booking a "rate your game" link carrying an unguessable per-booking token — possessing the link **is** the proof of attendance. The buyer submits one review per booking (1–5 stars + optional title/comment + an editable first-name+last-initial display name); reviews **auto-publish** and feed a **real, crawler-visible aggregateRating** (replacing today's fabricated 4.9/50) on the home page, per-event detail pages, and a dedicated `/reviews` page. Admins with `reviews.moderate` hide/restore from `/admin/reviews`; a hidden review drops out of the public feed and every aggregate instantly (single shared predicate `status='published'`).

## 2. Migration 0077 — DONE (Batch 1; operator applies alone)
See `migrations/0077_reviews.sql`. Adds: `reviews` table (one row per submitted review; `UNIQUE(booking_id)`; visibility = `status='published'`); additive nullable `bookings.review_token` + `bookings.review_invite_sent_at` (+ partial-unique + pending indexes); the `review_invite` email template; and the `reviews.moderate` capability bound to `owner` + `event_director` + `booking_coordinator`.

## 3. `worker/lib/ids.js` additions (Batch 2)
```js
// Attendee-verified reviews (migration 0077)
export function reviewId() {
    return `rv_${randomId(14)}`;          // matches bk_/at_/cus_ 14-char body
}
// Per-booking review-link token. 40 base62 chars ≈ 238 bits — stronger than
// qrToken(24): holding it lets the bearer write a PUBLIC review feeding
// aggregateRating + JSON-LD. FIXED length, mirrored by REVIEW_TOKEN_LEN=40.
export function reviewToken() {
    return randomId(40);
}
```

## 4. Email template `review_invite`
Subject `How was {{event_name}}? Drop a quick rating`; dark-theme house style (`#1a1c18`/`#f2ede4`/orange `#d4541a` CTA), both html+text shipped. Copy says **do not forward** (bearer-token PII mitigation). Variables: `player_name`, `event_name`, `event_date`, `review_link` (`= ${SITE_URL}/review?token=<token>`). Use `player_name` (NOT `first_name`) so seed `variables_json`, body tokens, and the sender's `vars` object are identical.

## 5. Cron sweep — `runReviewInviteSweep` (Batch 2)
New `worker/lib/reviewInvites.js`, modeled byte-for-byte on `runReminderSweepWindow` (sentinel-first, `db.batch`/`Promise.allSettled` in batches of 10, `LIMIT`, rollback-on-failure). Rides the existing `0 3 * * *` trigger — **no `wrangler.toml` cron change** (but it adds a `[vars]` entry, see below).

Windowing query (binds `windowStart`, `windowEnd`, `REVIEW_LAUNCH_CUTOFF_MS`):
```sql
SELECT b.id, b.email, b.full_name, b.event_id,
       e.title AS event_title, e.display_date AS event_display_date
FROM bookings b
JOIN events e ON e.id = b.event_id
WHERE b.status IN ('paid', 'comp')              -- CRON_INVITE_STATUSES
  AND b.review_invite_sent_at IS NULL           -- idempotency sentinel
  AND b.email IS NOT NULL AND b.email != ''
  AND (unixepoch(COALESCE(e.end_date_iso, e.date_iso)) * 1000) BETWEEN ? AND ?
  AND (unixepoch(COALESCE(e.end_date_iso, e.date_iso)) * 1000) >= ?   -- launch cutoff
LIMIT 100
```
- Anchor = `COALESCE(end_date_iso, date_iso)` (multi-day → span end; single-day → date_iso). `events.past` deliberately unused (stale).
- Window: `const H=3600000; windowStart = now-48*H; windowEnd = now-18*H;` — 30h-wide vs 24h cron guarantees each span-end lands in exactly one run; the 18h floor clears late same-day finishes + the naive-`date_iso`-as-UTC vs Mountain (UTC-6/-7) skew. **Documented:** the nudge can be up to a day late (fine for "rate your game"). Test: a single-day event with `date_iso='<today 16:00>'` is NOT invited same night, IS invited the next 03:00.

### FIRST-RUN BLAST GUARD — three independent barriers (do not collapse to one)
1. **Window floor (`now-48h`)** already makes first-run a no-op (every existing event ended >48h ago) — window-math independent.
2. **Env-var launch cutoff** in `wrangler.toml [vars] REVIEW_LAUNCH_CUTOFF_MS` (reviewable/changeable without a code deploy; default `1782604800000` = 2026-06-28). Read as `Number(env.REVIEW_LAUNCH_CUTOFF_MS || 1782604800000)`. Only invite bookings whose event ended on/after this instant — strictly forward-looking.
3. **First-run sanity ceiling** (hard abort): if `candidates.length > REVIEW_INVITE_RUN_CEILING` (=25), **log-and-abort** (return `{ aborted:true, considered }`) — a fat-fingered cutoff can never mass-send.

Claim + rollback (sentinel-first, both columns):
```js
const token = reviewToken();
const claimed = await env.DB.prepare(
  `UPDATE bookings SET review_invite_sent_at = ?, review_token = ?
   WHERE id = ? AND review_invite_sent_at IS NULL`
).bind(now, token, r.id).run();
if (!claimed.meta?.changes) return 'skipped';
// success → writeAudit 'review_invite.sent'
// failure → UPDATE bookings SET review_invite_sent_at=NULL, review_token=NULL
//           WHERE id=? AND review_invite_sent_at=?   (roll BOTH back)
```
Accepted at-most-one-duplicate-email window (send succeeds but response errors → re-send next night with a new token; the old token can't resolve because `/context` looks up by the booking's *current* `review_token`) — document in the sweep comment.

Wiring (`worker/index.js`): import `runReviewInviteSweep as _runReviewInviteSweep` after the `runStripeFeeSync` import; `const runReviewInviteSweep = _runReviewInviteSweep;` after the alias block; in the `cron === '0 3 * * *'` `Promise.all` append `runReviewInviteSweep(env).catch(err => ({error: err?.message}))`, add `reviewInvites` to the destructure + `summary`.

`sendReviewInvite(env, { booking, event, reviewLink })` — **append-only** in `emailSender.js`; matching entry in `emailTemplatePreview.js` (byte-mirror).

## 6. Public API — `worker/routes/reviews.js` (Batch 3; mount `app.route('/api/reviews', …)` after the feedback mount)
Shared constants: `MIN_RATING=1`, `MAX_RATING=5`, `MAX_TITLE=120`, `MAX_COMMENT=2000`, `MAX_AUTHOR=60`, `MAX_LIST_LIMIT=50`, `REVIEW_TOKEN_LEN=40`, `EDIT_WINDOW_MS=30d`, `MAX_EDITS=3`, `CRON_INVITE_STATUSES=['paid','comp']`, `SUBMIT_ELIGIBLE_STATUSES=['paid','comp']`. **Public output whitelist** on every list endpoint: `id, rating, title, comment, authorName, publishedAt` (+ `event{slug,title}`). NEVER `booking_id`, raw `event_id`, `email`, `ip_hash`, `status`, `hidden_*`, `created_at`. A test asserts the whitelist.

- **`GET /api/reviews/context?token=…`** — rate-limited `RL_FEEDBACK` keyed by **IP**. Token missing/not 40 base62 → `400`; no booking w/ that `review_token` → `404`; event missing/`published=0` → `410`; else `200` `{ eligible, reason, alreadyReviewed, editable, event:{slug,title,displayDate,endedAt}, suggestedAuthorName, existingReview? }`. Minimal disclosure — NO raw `bk_` id, email, phone. `editable = alreadyReviewed && existing.status==='published' && (now-existing.created_at)<EDIT_WINDOW_MS && existing.edit_count<MAX_EDITS`.
- **`POST /api/reviews`** — `rateLimit('RL_FEEDBACK', keyFn)` keyed by the **request token** (not IP). Honeypot field **`company`** (distinct from feedback's `website`) → silent `200`. Order: body not object `400`; honeypot → silent `200`; rating not int 1–5 `400`; title>120/comment>2000/author>60 `400`; token bad-shape `400`/unknown `404`/event unpublished `410`; eligibility `status∈['paid','comp']` else `403`; then insert/edit. `INSERT … ON CONFLICT(booking_id) DO UPDATE`: new → `201 {id,status:'published',edited:false}` (`ip_hash=hashIp(clientIp,SESSION_SECRET)`); existing → only if within window AND `edit_count<MAX_EDITS` AND **the existing row's `booking_id` === the token's booking_id** (assert explicitly — a token for booking A can never edit B's row) → `200 {edited:true}`, else `409`. Hidden review → `409`. Best-effort `waitUntil` audit `review.submitted`.
  - **Auto-publish (LOCKED):** published on insert; takedown is the only path to invisible.
  - **Edit window (LOCKED):** author edits own review 30 days / ≤3 edits, then immutable.
  - **Refund/cancel (LOCKED):** submit eligibility = `paid`/`comp` only; `cancelled`/`refunded` → `403` for NEW submissions (closes the buy→attend→1★→refund sabotage path on live Stripe). A review already submitted is KEPT if the booking later refunds/cancels (don't auto-hide); the admin list **flags** such reviews for manual takedown.
- **`GET /api/reviews?event=<slug|id>&limit&offset`** — event by `id OR slug AND published=1` (unknown `404`). `{ event:{id,slug,title}, average, count, limit, offset, reviews:[…] }`; `average=ROUND(AVG(rating),1)` + `count` over the full published set; `WHERE event_id=? AND status='published' ORDER BY created_at DESC`. limit clamps 1–50.
- **`GET /api/reviews/summary?recent&perEvent`** — `overall:{average,count}` over all published; `recent[]` (clamp 1–10); `perEvent[]` only when `perEvent=1`. **Zero state:** `overall:{average:null,count:0}, recent:[]` — consumers MUST omit `aggregateRating` when `count===0`.
- **`GET /api/reviews/all?limit&offset`** — `{ total, limit, offset, average, reviews:[…] }` (`WHERE status='published'` joined to `published=1` events).

Status map: `200` ok/edited · `201` created · `400` malformed/bad-token-shape · `403` ineligible · `404` unknown token/event · `409` edit past window/cap or hidden · `410` event unpublished · `429` rate limited · `500` DB.

## 7. Display & structured data (Batches 4 + 6)
- **Home** (`Home.jsx`): testimonials consume `useReviews({limit:3})`, use live reviews only when **≥3 with a non-empty comment**, else fall back to the static `testimonials` array (kept, never retired). The hero "Avg. Rating" stat MUST wire to `summary.average` whenever the home aggregateRating ships (visible on-page counterpart, per Google policy); when `count===0` both the stat and the node are omitted. **Remove both hardcoded JSON-LD blocks** (fabricated `LocalBusiness` 4.9/50 and stale `Event` "Operation Nightfall") — single source is the SSR injection.
- **EventDetail** (`EventDetail.jsx`): `useReviews({eventId:event?.id, limit:20})` (separate hook — `adaptEvent`/`formatEvent` untouched). Sidebar "Player Rating" row + a "Player Reviews" section when `count>0` (omit at 0).
- **`/reviews`** (`Reviews.jsx`): `useReviews({limit:60})`; summary band when `count>0`, else friendly empty state. Footer link added; Navbar optional.
- **Zero-reviews state:** until the night after Operation Last Light, NO aggregateRating anywhere; hero stat → "New"/hidden. The fabricated 4.9 disappears from search/social until real reviews accrue (operator-confirmed decision §10.3).

### Server-injected JSON-LD (Batch 4 — the load-bearing crawler path)
New `worker/lib/reviewAggregates.js`: `getOrgReviewAggregate(env)` + `getEventReviewBundle(env, eventId, {recent})`, both filtering `status='published'` and **returning `null` at zero rows**. **Mandatory shared serializer for ALL injected JSON-LD** (resolves the 2 critical XSS findings):
```js
export function serializeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')   // neutralizes </script> breakout (the real sink)
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029');
}
```
Test: a comment `</script><img src=x onerror=alert(1)>` through the bundle → injection asserts NO raw `</script>` in the rendered HTML.
- **Home `/`:** new `rewriteHomeJsonLd(request, env)` + a `handleRequest` branch for `url.pathname === '/' || '/index.html'` (today `/` falls straight through to ASSETS — this NEW branch is a hard ship gate). Append a `LocalBusiness` `<script type="application/ld+json">` into `<head>` via HTMLRewriter; spread `aggregateRating` only when non-null.
- **Events `/events/:slug`:** extend `rewriteEventOg` **additively** (Critical DNT, append-only): add `id` to its SELECT (update the `rewriteEventOg` mockD1 test regex), fetch `getEventReviewBundle`, chain a new `.on('head', …)` appending an `Event` JSON-LD (real name/startDate `date_iso` with explicit `-06:00/-07:00` offset/endDate/location.address{addressLocality,addressRegion:'UT',addressCountry:'US'}/organizer/offers.url) with `aggregateRating` + `review[]` spread in only when non-null. Existing meta-rewrite + its `html:false` escaping untouched.

**Policy:** public route, both SSR injectors, and the admin average use the identical `status='published'` predicate (test asserts public count === SSR `reviewCount`); omit `aggregateRating` at 0; the per-**Event** aggregateRating is the rich-result surface, the org `LocalBusiness` aggregate is kept for AI answer engines but not relied on for Google stars. **Acceptance gate:** after deploy `curl -s https://airactionsport.com/ | grep -c application/ld+json` confirms the SSR block in raw HTML; do NOT merge Home's client-JSON-LD removal until SSR is verified live.

**`/review` noindex:** serve `X-Robots-Tag: noindex` as an HTTP header for `/review` in `withSecurityHeaders` (path check), not just a client meta. Add `Disallow: /review` to `public/robots.txt`. **Sitemap:** add `/reviews` + the live event URL(s) to `public/sitemap.xml`; checklist item to add each event URL on publish. `/review` stays OUT.

## 8. Admin moderation — `worker/routes/admin/reviews.js` (Batch 5)
- Gating: `requireAuth` + `requireCapability('reviews.moderate')` (lazy-loads `user.capabilities` via `listCapabilities`; route tests must bind the cap or 403).
- **`GET /api/admin/reviews`** — filters `event_id`, `rating`, `status` (`published`|`hidden`), `q` (LIKE title/comment/author_name), `limit`/`offset`. `{ total, limit, offset, summary:{published,hidden,total,average}, items:[…] }` joined to events; per-row `bookingFlag` when the booking is now `refunded`/`cancelled`. Admin-only fields (`email`, `booking_id`, `ip_hash`) stay inside this capability-gated route only.
- **`PUT /api/admin/reviews/:id`** — `{ action:'hide'|'unhide', reason? }`. hide → `status='hidden'`, `hidden_reason`(≤500), `hidden_by`, `hidden_at`; `writeAudit 'review.hidden'`. unhide → `status='published'`, clear `hidden_*`; `writeAudit 'review.unhidden'`. `404`/`400`. Instantly affects public feed + both SSR aggregates.
- **Page** `src/admin/AdminReviews.jsx` (clone `AdminFeedback.jsx`): `AdminPageHeader`, stat cards, chip `FilterBar` (`savedViewsKey="adminReviews"`), table, detail modal (hide = required-reason textarea + ⚠ "removes from the public site and your rating immediately"). Inline styles use `var(--color-*)` tokens (one dark theme). RTL: open the modal with `fireEvent.click`. Route `/admin/reviews`.
- **Sidebar** (`sidebarConfig.js`): add `{type:'item', to:'/admin/reviews', label:'Reviews', capability:'reviews.moderate'}` after Feedback; add `'reviews.moderate':'manager'` to `CAPABILITY_TO_LEGACY_ROLE`. Convert the new `sidebarConfig.test.js` assertion to `find(e=>e.to==='/admin/reviews')`; fix shifted indices + `getVisibleItems` owner count in the same PR.

## 9. Batch plan
| # | Title | Files (~8–10 ceiling) | Tests | gate-map |
|---|---|---|---|---|
| **1** | Schema migration (operator applies) — **DONE** | `migrations/0077_reviews.sql` (+ this spec doc) | apply-and-verify | none |
| **2** | IDs + cron sweep + sender + template mirror | `worker/lib/ids.js`, `worker/lib/reviewInvites.js`, `worker/lib/emailSender.js` (append), `worker/lib/emailTemplatePreview.js`, `worker/index.js`, `wrangler.toml` (`[vars]`) | `reviewInvites.test.js` (window math, COALESCE anchor, single-day-not-same-night, sentinel claim, rollback-nulls-both, run-ceiling abort, cutoff fence), ids token length | `worker/lib/reviewInvites.js`, `worker/lib/ids.js` |
| **3** | Public API | `worker/routes/reviews.js`, `worker/index.js` (mount) | context/submit/feeds (rating/length/honeypot/token-shape/eligibility, refund 403, one-per-booking 409, edit window+cap, cross-booking-edit reject, token-keyed RL, zero-state, output whitelist) | `worker/routes/reviews.js` |
| **4** | SSR structured data + serializer + noindex + sitemap | `worker/lib/reviewAggregates.js`, `worker/index.js` (`rewriteHomeJsonLd` + `/` branch; extend `rewriteEventOg`; `X-Robots-Tag`), `public/robots.txt`, `public/sitemap.xml` | `reviewAggregates.test.js` (null-at-zero, rounding, predicate, `</script>` escape, public-count===SSR-reviewCount), update `rewriteEventOg` mock regex | `worker/lib/reviewAggregates.js` |
| **5** | Admin moderation route + page + sidebar | `worker/routes/admin/reviews.js`, `worker/index.js` (mount), `src/admin/AdminReviews.jsx`, `src/admin/sidebarConfig.js`, `src/App.jsx` | admin list/moderate (403 w/o cap, hide/unhide + audit + reason, booking-flag), `AdminReviews.test.jsx` (RTL fireEvent), `sidebarConfig.test.js` (find-by-to) | `worker/routes/admin/reviews.js` |
| **6** | Public display surfaces | `src/hooks/useReviews.js`, `src/pages/Review.jsx` (+css), `src/pages/Reviews.jsx`, `src/pages/EventDetail.jsx`, `src/pages/Home.jsx`, `src/components/Footer.jsx` (+Navbar), `src/App.jsx` | `useReviews.test.js`, `Review.test.jsx` (star widget, scroll-to-error, submit; stub scrollIntoView/scrollTo), `Reviews.test.jsx` | none (JSX) |
| **7** | Docs + deploy verification | `CLAUDE.md` / `docs/next-session.md`, SSR acceptance-gate runbook (`curl … grep -c application/ld+json`), Rich Results note | none | none |

## 10. Operator decisions
1. ⏳ **STILL OPEN — CAN-SPAM classification of `review_invite`** (medium). Borderline commercial. Answer before the first real send (~2026-07-27, post-Operation-Last-Light): either treat as transactional (ship as-is) or marketing-class (add `MARKETING_POSTAL_ADDRESS` + unsubscribe footer + run through the `email_events` suppression check). The launch-cutoff + window guards mean nothing sends until decided — not a code blocker. Suppression-check integration is a small follow-up to Batch 2 if marketing-class.
2. ✅ **RESOLVED (2026-06-28) — `reviews.moderate` scope = `owner` + `event_director` + `booking_coordinator`** (kept all three; locked in migration 0077, applied to prod).
3. ✅ **RESOLVED (2026-06-28) — interim rating disappearance ACCEPTED.** Batch 6 removes the fabricated 4.9/50 from `Home.jsx` now; the homepage shows no star rating until the real SSR rating appears (first review ~2026-07-25).

**Rejected red-team items:** drop the org aggregateRating entirely (rejected — kept for AI engines, not relied on for Google stars); pre-create review rows at invite time (rejected — token lives on `bookings.review_token`, rows created on submit so `UNIQUE(booking_id)` stays a genuine backstop); profanity/impersonation guard on display_name (deferred — auto-publish + admin takedown is the model; admin list surfaces names).
