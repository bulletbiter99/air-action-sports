# Attendee-Verified Reviews — Deploy & Activation Runbook

The reviews feature **closed + deployed 2026-06-30** (`main` HEAD `69e6a74`, **3149 / 276** tests,
migrations **0001–0077**). Design bible: [`../reviews-feature-spec.md`](../reviews-feature-spec.md).
Cloudflare Workers Builds auto-deploys on push to `main`.

## What shipped (Batches 1–7, PRs #351–#358)
- **Schema** — migration **`0077`** (applied to prod D1): `reviews` table (`UNIQUE(booking_id)`;
  visibility = `status='published'`) + additive nullable `bookings.review_token` /
  `bookings.review_invite_sent_at` + the `review_invite` email template + the `reviews.moderate`
  capability (owner / event_director / booking_coordinator).
- **Invite cron** — `worker/lib/reviewInvites.js` `runReviewInviteSweep`, riding the existing `0 3 * * *`
  trigger; sentinel-first claim, `[now-48h, now-18h]` window, `REVIEW_LAUNCH_CUTOFF_MS` launch fence,
  per-run `LIMIT` blast guard; append-only `sendReviewInvite`.
- **Public API** — `worker/routes/reviews.js` at `/api/reviews`: `GET /context?token=`, `POST /`
  (submit + edit, auto-publish, one-per-booking, 30d/≤3-edit cap), `GET /?event=`, `GET /summary`,
  `GET /all`. Token-gated, honeypot, whitelisted output.
- **SSR structured data** — `worker/lib/reviewAggregates.js` + injection in `worker/index.js`:
  a home `LocalBusiness` block (`rewriteHomeJsonLd`) and a per-event `Event` block (additive
  `rewriteEventOg` head handler), **each only when published reviews exist**. `serializeJsonLd`
  escapes `</script>` (the stored-XSS sink). `/review` served `X-Robots-Tag: noindex`; robots.txt
  `Disallow: /review`.
- **Admin moderation** — `worker/routes/admin/reviews.js` (list/filters/summary/bookingFlag + PUT
  hide/unhide + audit) gated by `requireCapability('reviews.moderate')`; `src/admin/AdminReviews.jsx`
  at `/admin/reviews` + sidebar entry.
- **Public UI** — `src/hooks/useReviews.js` (standalone; `summary`/`event`/`all` modes, **not** coupled
  to `adaptEvent`/`formatEvent`), `src/components/Stars.jsx`, `src/pages/Review.jsx` (the `/review?token=`
  star form), `src/pages/Reviews.jsx` (`/reviews`), an EventDetail "Player Reviews" section + sidebar
  "Player Rating" row, data-driven Home testimonials (live only when ≥3 have a comment, else the static
  fallback), and the **removal of the fabricated `4.9★/50` client JSON-LD from `Home.jsx`**. The hero
  "Avg. Rating" stat now wires to the real `summary.average` and is omitted at zero reviews.

## Dormancy — nothing emails or displays until ~2026-07-25
Three independent guards keep the invite cron inert until the first real event ends:
1. **Window floor** — only events whose end is within `[now-48h, now-18h]` are candidates, so every
   pre-existing event (ended long ago) is excluded.
2. **Launch cutoff** — `wrangler.toml [vars] REVIEW_LAUNCH_CUTOFF_MS` (default `1782604800000` =
   2026-06-28) — only events ending on/after this instant are invited. Change without a code deploy.
3. **Per-run `LIMIT`** — caps how many invites any single 03:00 run sends.

The first invites therefore fire the night after **Operation Last Light** (25 July 2026) ends — the
first/only published event taking real bookings. Until a review is submitted:
**no `aggregateRating` is injected anywhere and the homepage shows no star rating** (the honest interim).

## SSR acceptance gate (run AFTER the first review exists)
The crawler-visible rating is server-injected, not client-rendered — verify it in the **raw HTML**:
```bash
# Home LocalBusiness aggregate — 0 until the first published review, then ≥1.
curl -s https://airactionsport.com/ | grep -c 'application/ld+json'
# Per-event Event aggregate (rich-result surface):
curl -s https://airactionsport.com/events/operation-last-light | grep -c 'application/ld+json'
```
Do **not** rely on Home's client JSON-LD — it was intentionally removed (single source = the SSR
injection). A `0` today is expected and correct (no reviews yet).

**Rich Results:** once a review exists, run the per-event URL through Google's
[Rich Results Test](https://search.google.com/test/rich-results) to confirm the `Event` +
`aggregateRating` parses for a star rich result. The org `LocalBusiness` aggregate is kept for AI
answer engines but is **not** relied on for Google stars.

## Operator-pending
1. **CAN-SPAM classification of `review_invite`** (decide before the first real send ~2026-07-27).
   Borderline commercial. Either treat as **transactional** (ship as-is — the current state) or
   **marketing-class** (set `MARKETING_POSTAL_ADDRESS`, add an unsubscribe footer, and run the send
   through the `email_events` suppression check — a small follow-up to `reviewInvites.js`). The
   launch-cutoff + window guards mean nothing sends until this is decided; **not a code blocker.**
2. **Recapture the `home` public visual baseline** after the Batch-6 deploy settles. Removing the 4th
   hero "Avg. Rating" stat changes `home.png`, and the public visual suite tests **live prod**, so it
   will drift once prod serves the 3-stat hero. Fix: label a PR `capture-baselines` (the bot recaptures
   both public + admin suites against live prod and commits the PNGs), then push a follow-up/empty
   commit to clear GitHub's anti-recursion block so CI re-runs green.

## Deploy safety
Additive throughout. The **Critical payment/waiver/auth path is byte-untouched** — the `/stripe`
webhook handler, `verifyWebhookSignature`, `pricing.js`, `bookings/checkout`, `waivers`, and auth were
not modified; the SSR `Event` block is an **append-only** extension of `rewriteEventOg` (its existing
meta rewrite + escaping unchanged). **Publish-independence:** `/context` + `POST` resolve by token
regardless of `events.published` (AAS unpublishes past events + the cron runs after the event ends);
review *visibility* is gated by the review's own `status='published'`, and a hidden review drops out of
every feed + both SSR aggregates instantly (single shared predicate).

## Rollback
No schema rollback is expected (0077 is additive-nullable + a new table). To disable the feature without
a revert: push the `REVIEW_LAUNCH_CUTOFF_MS` var far into the future (stops new invites) and/or hide any
submitted reviews from **Admin → Reviews** (drops them from all feeds + aggregates). A full code revert
of PRs #351–#358 is clean (additive files + additive route mounts + additive SSR head handlers).
