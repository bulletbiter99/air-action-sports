# Growth Plan — Conversion + LLM/AI Discoverability Upgrade (2026-07-24)

> ## ⚠️ READ THIS FIRST (updated 2026-07-31) — execution STARTED; parts of this document are stale
>
> An 11-agent re-verification against `main` on 2026-07-31 found several premises had moved. **`docs/next-session.md` supersedes this file where they disagree** — that section lists the 28 corrected batches, what shipped, and six corrections you should not re-derive. Highlights:
>
> - **The AI-crawler premise is not a code problem.** GPTBot, ClaudeBot, PerplexityBot and OAI-SearchBot are **403'd at the Cloudflare edge**, and Cloudflare injects a managed `robots.txt` disallowing them. No change in this repo can fix that; `public/robots.txt` is not the file being served for those directives. Everything in Phase 2 is real for Google/Bing/social scrapers and invisible to AI assistants until the dashboard toggle flips.
> - **Already shipped** (2026-07-31, PRs #418–#425): the archived-event OG/JSON-LD fix, Event JSON-LD un-gated for events without reviews, the missing `og-image.jpg`, a D1-generated sitemap, fabricated testimonials deleted, the false 50% cancellation credit removed, honest empty states, and home site cards driven by the sites API.
> - **`WHERE published = 1` recipes in Phase 2 are wrong** — use `published = 1 OR past = 1`, mirroring `worker/routes/events.js`. Archived events are permanently public since #404.
> - **Do NOT change `eventStatus` for past events** (no valid schema.org value exists) and **do NOT "fix" the JSON-LD `startDate` timezone** (it is a recorded decision, not the `date_iso` bug).
> - **This plan omits all-in pricing**, which its own research names as an FTC Junk Fees Rule requirement for live-event tickets. Treat that as a missing batch.
> - **There are currently zero bookable events**, so the six funnel batches have no revenue effect until one is published.

> **Note (2026-07-28):** execution has **not started**, so the plan stands — but one premise has moved. It argues JSON-LD is "gated on reviews existing, which is zero today"; real reviews arrived 2026-07-25/26, so the home `LocalBusiness` block now emits with a genuine aggregateRating. The per-event `Event` schema argument is unaffected. Any "before July 25" deadlines in the phases are moot.

> **STATUS (updated 2026-07-25):** research complete; **execution NOT started** (the admin-audit event-day sprint took priority — the July 25-26 events ran the weekend this was written). Post-event sequencing note: Phase 0's operator items (Resend webhook, Cloudflare AI-bot settings check, Stripe wallet toggles, Google Business Profile, listings) are all still open and now MORE timely — the first real reviews arrive ~July 26-27, making Phase 2's un-gating of the Event/LocalBusiness JSON-LD (currently review-gated) immediately valuable once executed.

Produced by a 10-agent audit/research workflow: 5 codebase auditors (funnel, SEO/LLM surface,
lifecycle comms, analytics, content), 4 web researchers (ticketing CRO, GEO/AEO, local discovery,
retention), and an adversarial cross-check that verified every high-impact claim against the code
(all 22 CONFIRMED). Line references were verified as of `main` `def6848`.

**Context that shapes sequencing:** the two live events (Operation Last Light $60, Operation Fire
Storm $80) run July 25–26 — ~3 weeks out. Work that sells tickets NOW (content truth pass, funnel
friction, discovery listings, machine-readable event data) comes first; work that harvests the
attendee base (lifecycle flows, referral, win-back) lands right after the events, when the reviews
feature also wakes up.

---

## The five headline findings

### 1. The site is invisible to AI assistants and non-JS crawlers — and the fix is cheap
Every public route serves the identical empty SPA shell (`<div id="root">` + generic meta). Only
`/events/:slug` gets an OG rewrite. The ONLY structured data (Event + LocalBusiness JSON-LD) is
**gated on reviews existing** — which is zero today — so the two live events emit **no Event schema
at all**, and the emitted schema has no `offers` node (price/availability/booking URL) anyway.
Research confirmed: **no major AI crawler except Googlebot executes JavaScript** (GPTBot,
OAI-SearchBot, ClaudeBot, PerplexityBot, ChatGPT-User all read raw HTML only). An AI agent asked
"when is this event and how much?" cannot answer from the site today.

The worker already has the exact pattern needed (HTMLRewriter + `serializeJsonLd` + D1 access in
`rewriteEventOg`, worker/index.js:563) — this is extension, not new architecture.

### 2. Abandoned checkouts are warm leads thrown away
`POST /checkout` inserts a pending booking with **full name, email, phone** before the Stripe
redirect (worker/routes/bookings.js:261-276). If the buyer never pays, `runAbandonPendingSweep`
(worker/index.js:509-518) silently flips status after 30 min. No recovery email, no template, no
surfacing. Benchmarks: recovery emails see ~50% opens and recover 10–20% of abandoned ticket
revenue. Related: the Stripe-cancel return page (`BookingCancelled.jsx`) ignores its `?token=` and
links to a **blank** booking form — the highest-intent segment redoes everything from scratch.

### 3. Credibility contradictions actively undermine the honest-reviews strategy
- **FAQ says milsim is 18+** (faq.js:7) — both live events are 12+ milsim ops. Revenue-blocking.
- **FPS limits stated 4 different ways** (ROE 350/450/450/550 is canonical; FAQ/About/EventDetail
  fallback all disagree).
- **Fabricated content**: hero stats ("5+ Battle Sites", "2k+ Players Deployed" vs 2 sites and ~50
  bookings), fake About team/timeline (incl. nonexistent "Echo Urban" site), UK-English fallback
  testimonials praising an unbookable venue, phantom third site across Home/Gallery/Locations,
  "Fully Insured/Safety Certified" badges unverified.
- **Rental gear promised everywhere, priced nowhere, fulfilled by neither live event.**
- UK English throughout ("gear hire", "trousers", "stag dos") on a Utah business.
- Home first screenful never says **Utah**.

These matter double: once event/FAQ content is server-rendered (finding 1), this text is exactly
what LLMs will quote.

### 4. Measurement is near zero
No client-side analytics of any kind (verified: no gtag/plausible/pixel/beacon anywhere). No
UTM/referrer/click-ID capture. The admin funnel starts at booking-row creation — everything
upstream is invisible. The only acquisition signal is an optional 4-bucket "How did you hear about
us?" select. Ads would be unmeasurable today.

### 5. A complete marketing engine is sitting idle
Campaigns + automations + segments + suppression + tracking are code-complete. Activation =
`RESEND_WEBHOOK_SECRET` + webhook (~15 min), `MARKETING_POSTAL_ADDRESS` + Resend plan upgrade.
The nightly-computed `lapsed`/`vip`/`frequent`/`new` tags and email-bound single-use promo codes
mean win-back, early-access, and referral flows are mostly **configuration, not construction**.
⚠️ Default audience is the ENTIRE base (opt-out model) — first sends must be narrow + warmed up.

---

## Phase 0 — Operator actions, this week (no code)

| # | Action | Why |
|---|---|---|
| 0.1 | **Resend webhook**: `wrangler secret put RESEND_WEBHOOK_SECRET` + dashboard webhook → `/api/webhooks/resend` (bounced, complained, delivered, opened, clicked) | Turns on suppression, campaign tracking, review-invite hygiene — all dead code until this. Do BEFORE July 25 (review invites fire ~July 26). |
| 0.2 | **Cloudflare dashboard**: Security → Bots — verify AI crawlers are NOT blocked (CF now blocks them by default for new zones); confirm no managed robots.txt injection; then curl the site as GPTBot/PerplexityBot/ClaudeBot and confirm 200 + HTML | Gates ALL of Phase 2. Likely the same bot-management layer suspected of blocking CI→/api/events — one investigation may explain both. |
| 0.3 | **Stripe dashboard**: confirm Apple Pay + Google Pay + Link enabled on live mode, domain registered for Apple Pay | Stripe's own experiment: Apple Pay +22.3% conversion. Dashboard toggles, no code. |
| 0.4 | **Google Business Profile** anchored to the physical venue (NOT service-area/hidden-address — airsoft risks the weapons SAB restriction; confirm with landowner). Event-day hours, photos, weekly event posts | GBP feeds Maps, AI Overviews, and ChatGPT-class assistants. Currently no presence at all. |
| 0.5 | One afternoon of listings: **Bing Places** (ChatGPT search rides Bing's index), **Apple Business Connect**, **utahairsoftevents.com** (the actual Utah discovery hub), Facebook page + posts into Utah Airsoft/BTA/UVCA groups, **airsoftc3** + **usairsoftfields** field listings, **MiR Tactical** events calendar. Keep NAP identical everywhere | Utah airsoft discovery demonstrably runs on the FB-group ecosystem + these aggregators. Third-party corroboration is also what lets an AI assistant confidently recommend the business. |
| 0.6 | **July 25-26 events**: offer 2–4 comp media tickets to Utah/Mountain-West airsoft YouTubers/POV filmers; QR code at check-in → shared photo/video drop + hashtag (small raffle perk for tagged posts — never incentivize reviews) | POV/recap video is THE format that fills MilSims; these two events are the year's content-harvest opportunity. |
| 0.7 | **Marketing activation** (`MARKETING_POSTAL_ADDRESS` + Resend plan) — but hold the first send until Phase 1 content fixes land and use a NARROW segment (recent bookers), never the full base | List warm-up protects the shared transactional domain reputation. Lapsed win-back goes LAST, not first. |
| 0.8 | Data-only merch decisions: consider **early-bird tiers** for future events (2–3 dated ticket-type rows — zero code, existing multi-ticket system supports it) and seeding **partner rentals** (`details_json.partnerRentals`, proven Volga pattern) onto live events | Eventbrite data: buyers purchase avg 18.5 days out; tiers convert the fence-sitters. Rentals fix the content contradiction AND serve first-timers. |

## Phase 1 — Truth & funnel sprint (code, before July 25) — ~6–8 small PRs

**Content truth pass** (all static JSX/data edits, zero DNT; home/event baselines need recapture):
1. Fix FAQ age answer (12+ w/ guardian waiver), "all three sites" → two, BYO-BB caveat for
   limited-ammo ops. Make ROE the single FPS source: fix faq.js:85, About.jsx:43,
   EventDetail fpsLabel fallback.
2. Replace hero stats with true-but-strong numbers ("2 Utah battlefields · 19-building ghost town ·
   350-player ops · Est. 2024"); add **Utah** to hero + SEO title.
3. About page: real story or radical cut; remove fake team/Echo Urban/unverifiable badges.
4. Testimonials: remove or replace with sourced real quotes (FB group, with permission);
   de-Britishize. Wire `SocialProof.jsx` to `useReviews` with the same ≥3-live swap Home uses
   (so it upgrades itself when reviews land ~July 26).
5. Phantom site cleanup (Home/Gallery/Locations/sites row); flip Foxtrot to "open".
   US-English localization pass. 4 new FAQ entries (weather, "does it hurt", coming solo, fitness).
6. Gallery: real photos from Nightfall/Volga/Foxtrot (operator supplies); backfill
   `/games` archiveLinks (data entry — plumbing exists).

**Funnel quick wins** (client-only, zero DNT):
7. **Promo-code preview**: call existing `/api/bookings/quote` (already used by AdminNewBooking) on
   step 3, show discount line + updated Pay amount + inline invalid-code error.
8. **BookingCancelled resume**: fetch `GET /api/bookings/:token` (existing public endpoint), render
   "Resume your booking for <event>" → `/booking?event=<slug>` (or fully rehydrate).
9. Mobile ergonomics: 16px inputs (kills iOS zoom), 44px qty buttons, slim fixed bottom bar
   "Total $X · Continue" replacing the disabled sticky summary. Book CTA on event cards + above
   the fold on mobile event pages. FloatingBookPill hidden on /booking + /waiver.
10. Honest urgency: lower `MIN_MOMENTUM` (eventSlots.js) to ~15–20 so "23 players locked in"
    renders; retire the static "Limited slots available" line when no real signal exists. Repeat
    the credit/cancellation line under the EventDetail Book button + step-1 summary. First-timer
    reassurance strip ("Rentals available · all skill levels") on booking step 1.

## Phase 2 — Machine-readable site / LLM comms (code, before or ~July 25) — ~4–5 PRs

⚠️ `worker/index.js` (`rewriteEventOg`, request handler) is Critical DNT — all changes below are
the established **additive** pattern (new functions, new branches; Group G gates re-run).

> ⚠️ **Two premises below shifted after Sprint 4 (#404, 2026-07-28).** Public event visibility is
> no longer `published = 1` — the detail route now serves `(published = 1 OR past = 1)`
> (`worker/routes/events.js:110`) so **archived events keep working public pages**, and
> bookability moved to `/quote` + `/checkout` (which 409 on past events and on a passed
> `sales_close_at`). So: any `WHERE published = 1` recipe here **silently drops the archive**,
> and "emit for every published event" should be "for every publicly-served event". Availability
> in `offers` must also reflect the cutoff, not just sold-vs-cap.

1. **Un-gate + enrich Event JSON-LD**: emit for every **publicly-served** event (`published = 1 OR past = 1`) regardless of reviews; add
   `offers` (price, USD, availability from sold-vs-cap, `url: /booking?event=<slug>`, validFrom),
   `image`, `description`, real `location` Place with PostalAddress + geo (sites table has it);
   keep aggregateRating conditional. This single change makes price/date/availability/booking-URL
   agent-readable. Validate with Google's Rich Results test.
2. **Un-gate + enrich LocalBusiness JSON-LD** on `/`: base node unconditional; add address(es),
   geo, email, logo, image, `sameAs` (FB/IG/GBP once live). Optional Place node per site on
   /locations.
3. **Per-route meta map**: extend the HTMLRewriter pattern with a ~13-route lookup rewriting
   `<title>`, description, og:*, + injecting `<link rel=canonical>`. Server-inject FAQPage JSON-LD
   on /faq (faq.js is static data the worker can import). Fix the client Helmet overwriting the
   per-event OG image after hydration.
4. **Worker-served sitemap.xml** (static routes + `SELECT slug FROM events WHERE published = 1 OR past = 1` — mirroring the public detail route's own predicate so archived events stay indexed,
   lastmod from updated_at) — kills the manual-drift class (already missing /games +
   /rules-of-engagement). **Soft-404 fix**: unknown event slugs + unknown routes return 404 status.
   Trailing-slash 301 normalization.
5. **llms.txt** served from the worker (business summary, locations, upcoming events w/ dates +
   prices, `/api/events` documented as the live feed, booking URL pattern). Research verdict:
   measurably ignored by major platforms today — do it as 30-minute insurance, not a priority.
   **IndexNow** ping on event publish/update + register Bing Webmaster Tools (ChatGPT search ≈
   Bing's index; ~20 lines).
6. (Stretch) Server-injected hidden/noscript summary block on event pages (name/date/price/booking
   link as real HTML) — the acceptance test: paste an event URL into ChatGPT/Perplexity and ask
   "when is this and how much?"

## Phase 3 — Measurement (parallel with 1–2) — ~2 PRs

1. **Cloudflare Web Analytics** (free, cookieless, no consent banner): beacon in index.html or
   zone-level auto-inject. Instantly: page views, referrers, paths, Core Web Vitals.
2. **UTM/click-ID capture**: stash `utm_*`/gclid/fbclid/referrer/landing_path in sessionStorage on
   SPA load → include in the checkout POST body → persist as nullable additive columns
   (⚠️ additive INSERT-bind change inside Critical-DNT POST /checkout — follow the documented
   additive protocol + Group A/B gates). Extend the existing channel-attribution report to group
   by utm_source with `referral` fallback. Public promo/quote preview (Phase 1.7) doubles as a
   "checkout started" funnel signal — log it and prepend a funnel step.
3. (When ads happen) Server-side conversion fire from the paid webhook (Meta CAPI / Google Ads API,
   stored click ID + hashed email + value) — survives ad blockers; defer until ads are real.

## Phase 4 — Lifecycle revenue (right after July 25–26) — ~4–6 PRs + config

1. **Abandoned-booking recovery email**: 1 template + append-only sender + sentinel-column sweep
   (reuse `runReminderSweepWindow`'s claim-before-send shape; ⚠️ scheduled() is Critical DNT —
   const-alias additive sweep, operator sign-off). Email #1 at ~1h; #2 at 24h with remaining-spots;
   suppress via email_events. Transactional under CAN-SPAM.
2. **Post-event flow**: T+1d thank-you + recap/photos; review invite already fires (~T+1) — sequence
   so the review ask lands BEFORE any discount; T+14d next-op announce with an email-bound
   single-use code (72h expiry "rebook" variant when the next event is announced).
3. **Win-back**: `tag_added='lapsed'` automation (trigger exists) with a $10–15 code; consider a
   ~90-day "cooling" tag (180d is later than the documented 60–90d sweet spot).
4. **Early access**: 48–72h pre-announce window to vip/frequent/recent segments with batch codes,
   then public announce → 7-day → 48h-close cadence. Zero new infra.
5. **`date_relative` automation trigger** (documented-absent in automations.js:9-11): the one
   primitive that unlocks pre-event hype, post-event follow-up, and anniversary flows as config
   instead of bespoke sweeps. Build once.
6. **Referral MVP**: "give a friend $10 off" in confirmation/post-event emails via existing batch
   email-bound codes; manual referrer reward at first (the code row IS the attribution); automate
   the closed loop only if redemptions prove it.
7. **Waitlist v1**: sold-out event page swaps Book for notify-me (clone newsletter capture);
   admin "notify waitlist" send; the list doubles as next-event early-access seed.

## Phase 5 — Bigger bets (validate before building)

- **Group-booking friction** (high-value, needs operator decision): cross-check found placeholder
  names ("Player 2") already pass validation — so the cheap v1 is UI copy legitimizing it
  ("Don't have your full roster? Enter Player 2, 3… — names can be fixed on each player's waiver"),
  plus making faction questions optional-at-purchase per event (admin setting, assigned on-site).
  Relaxing server validation itself = Critical DNT conversation.
- **Squad bundle ticket type** (5-for-4.25 style) — data-only via existing ticket types; true
  cart-level group tiers would touch DNT pricing — defer unless squad codes prove demand.
- **Season pass pilot** — sell as a ticket type on a synthetic event, fulfill via comps + a
  `member` tag; price ~3x single ticket; perks (early access, buddy pass) over deep discounts.
  Defer real entitlement infra.
- **Gift codes** — minimal "Gift a Battle" page on existing email-bound 100%-off-up-to-value codes;
  payment-collection piece needs design.
- **SMS** — capture explicit consent checkbox at booking NOW (list builds while you wait);
  transactional event-day texts later (Twilio, 10DLC ~2wk lead time); marketing SMS last.
- **Agentic checkout (ACP/Instant Checkout)** — real but not actionable at this size; the Phase 2
  JSON-LD + stable booking deep links are the correct 2026 posture.

## Do-not-touch flags (carry into every phase)

| Change | DNT surface | Protocol |
|---|---|---|
| Event/LocalBusiness JSON-LD, route meta, sitemap | `worker/index.js` handleRequest/rewriteEventOg (Critical) | Additive functions/branches only; Group G gates |
| Abandoned-recovery sweep | `worker/index.js` scheduled() (Critical) | Const-alias sweep pattern + operator sign-off |
| UTM columns at checkout | `worker/routes/bookings.js` POST /checkout (Critical) | Additive column binds; Group A/B gates green |
| Group validation relaxation | POST /checkout validation (Critical) | Operator conversation FIRST; do not change unilaterally |
| New emails | `worker/lib/emailSender.js` | Append-only senders; `tpl_<slug>` + created_at seeds |

## Benchmarks to calibrate against (from the research)

- Ticketing checkout abandonment baseline ~45–65%; checkout design can recover ~35% relative lift.
- Apple Pay: +22.3% conversion (Stripe holdback experiment). All-in pricing: #1 abandonment fix and
  an FTC Junk Fees Rule requirement for live-event tickets (effective 2025-05).
- First ~5 reviews near the CTA drive the bulk of social-proof lift (up to +270% purchase
  likelihood) — priority after July 26 is getting 5 reviews per event surfaced above the ticket picker.
- Recovery emails: ~50% open, 10–20% of abandoned ticket revenue recoverable.
- Automated lifecycle flows ≈ 18x revenue per recipient vs one-off campaigns; win-back reactivates
  3–15%; event referral programs drive 15–25% of sales at ~10:1 ROI.
- Events/entertainment landing pages median ~12.3% conversion — the event-page anatomy to converge
  on: hero w/ real gameplay image + date + all-in price + CTA → spots/deadline line → inline
  first-timer FAQ → schedule → map → gear list → reviews → gallery → final CTA → sticky mobile bar.
