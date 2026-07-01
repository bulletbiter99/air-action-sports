# Next-session entry point — Operation Fire Storm event + /safety briefing (2026-07-01)

## ✅ DONE — Operation Fire Storm event + /safety briefing (2026-07-01)

Operator handed over three planning docs for the July 25-26 weekend (`operation fire storm`, `operations for july 25-26`, `safety briefing`). Per operator routing, **all three feed ONE event**: the draft `ghost-town-18hr-milsim` was rebuilt into **Operation Fire Storm** — a Sat 25 → Sun 26 July **overnight MILSIM** (Day 1 daytime program flows into the 18-hour overnight op to the Sunday-noon ENDEX). **Operation Last Light is untouched.** PR [#363](https://github.com/bulletbiter99/air-action-sports/pull/363) merged + **deployed** (Version `453f0873`); tests **3149 / 276**; NO new migrations (event via `scripts/seed-operation-fire-storm.sql` applied to remote D1 + a new public page).

- **Event (stays a DRAFT, `published=0`):** rename + slug `operation-fire-storm`; `date_iso` Sat 25 08:00 → `end_date_iso` Sun 26 12:00; day-keyed schedule merging both timelines (Day 1 daytime = `operations for july 25-26`; the overnight op = `operation fire storm`); rewritten mission briefing (King Coal complex, two convoy trucks); **single "Full Event" ticket** `tt_gt_firestorm` (the 3 day-passes deactivated). **Factions kept** (GRG vs Cinderjacks). Verified in D1.
- **Safety briefing → new public `/safety` page** ([`src/pages/Safety.jsx`](../src/pages/Safety.jsx), modeled on Rules of Engagement) + route + footer link + sitemap; **linked from the event's Required Documents** (`details.documents` → `/safety`). An adversarial multi-agent review caught a fire-safety loophole (the general briefing said pyro was allowed "unless approved by staff" while the event categorically bans it on fire-restricted land) → the `/safety` line was tightened to a categorical no-pyro.

**⚠️ Operator-pending on Fire Storm:**
1. **Finalize the ticket PRICE** ($110 is a PLACEHOLDER — `base_price_cents` + `tt_gt_firestorm`) then **publish** (`published=1`) in `/admin/events`. ⚠️ After any direct D1 edit, hard-refresh the `/admin/events` tab before saving (stale-tab revert gotcha).
2. **Reconcile the Saturday-evening seam** if desired — the two source timelines overlapped Saturday evening; the build starts the night op at END OF PEACE 8:00 PM (dropped the overnight op's redundant re-registration).
3. **`src/data/faq.js`** still has the old "check with a marshal before using pyro" framing — align it with the categorical no-pyro if you want site-wide consistency (left as a follow-up; not on the event page).

---

## ✅ DONE — Attendee-verified reviews (2026-06-28 → 06-30, all 7 batches shipped)

Shipped an **attendee-verified post-event reviews** feature so real customer ratings populate the site and feed a **legitimate `aggregateRating`** for search/AI visibility (there's no Google Business page, and the old homepage `4.9★ / 50` rating was **fabricated → now removed**). Full design + the 28 folded-in red-team findings: **`docs/reviews-feature-spec.md`**; deploy/activation runbook: **`docs/runbooks/reviews-deploy.md`**; durable resume note: memory **`reviews-feature-in-progress`**.

**Locked product decisions (all shipped):** verified attendees only (token in a post-event email) · one review per booking · auto-publish + admin takedown · display everywhere · **fake 4.9★ removed now** (operator-confirmed; homepage shows no rating until the first real review ~2026-07-25 — the honest interim).

**Flow:** the 03:00 cron emails each paid/comp booking a `/review?token=…` link ~24h after the event ends → they rate 1–5 + optional comment → auto-publishes → feeds the home/event/`/reviews` display + a server-injected, crawler-visible `aggregateRating`. Admins hide/restore from **Admin → Reviews**.

| Batch | PR | State |
|---|---|---|
| 1 schema (migration `0077`) | [#351](https://github.com/bulletbiter99/air-action-sports/pull/351) | ✅ merged + **applied to prod D1** + deployed |
| 2 invite cron + sender + tokens | [#352](https://github.com/bulletbiter99/air-action-sports/pull/352) | ✅ merged + deployed |
| 3 public submit/read API (`/api/reviews`) | [#353](https://github.com/bulletbiter99/air-action-sports/pull/353) | ✅ merged + deployed |
| 4 SSR crawler-visible `aggregateRating` | [#354](https://github.com/bulletbiter99/air-action-sports/pull/354) | ✅ merged + deployed |
| 5a admin moderation API (`/api/admin/reviews`) | [#355](https://github.com/bulletbiter99/air-action-sports/pull/355) | ✅ merged + deployed |
| 5b admin moderation UI (`AdminReviews` + sidebar) | [#356](https://github.com/bulletbiter99/air-action-sports/pull/356) | ✅ merged + deployed |
| 6 public UI (`/review` form + `/reviews` + event/home display; removed fake 4.9★) | [#358](https://github.com/bulletbiter99/air-action-sports/pull/358) | ✅ merged + deployed |
| 7 docs (this) + `reviews-deploy.md` runbook | — | ✅ |

`main` HEAD **`4fbbf4a`** (batches 1–6 code landed at `69e6a74`; Batch 7 docs at `4fbbf4a`) · **3149 / 276** tests · migrations **0001–0077** applied. The feature is **dormant** in production (no reviews exist yet; the invite cron's launch cutoff = 2026-06-28 + the 18–48h window mean the first invites go out ~2026-07-25 after **Operation Last Light** ends — nothing emails or displays until then).

**⚠️ Operator-pending / next-session TODO:**
1. **CAN-SPAM classification of the `review_invite` email** (decide before the first real send ~2026-07-27): transactional (ship as-is) vs marketing-class (add `MARKETING_POSTAL_ADDRESS` + unsubscribe + run through the `email_events` suppression check). Not a code blocker — the launch-cutoff + window guards mean nothing sends until decided. See `docs/runbooks/reviews-deploy.md`.
2. **Recapture the `home` public visual baseline** once the Batch-6 deploy settles — removing the 4th hero "Avg. Rating" stat drifts `home.png`, and the public visual suite tests LIVE prod (label a PR `capture-baselines`, then push an empty commit to re-trigger CI past the anti-recursion block).

**SSR acceptance gate (post-deploy, once reviews exist):** `curl -s https://airactionsport.com/ | grep -c application/ld+json` should show the injected `LocalBusiness` block (it returns `0` today — correct, no reviews yet); the rich-result surface is the per-event `Event` aggregate at `/events/<slug>` (run it through Google's Rich Results Test after the first review). Don't rely on Home's client JSON-LD — it was removed in Batch 6 (single source = the SSR injection).

---

## Prior context (2026-06-27 and earlier — kept for history)

_The **reviews feature above is COMPLETE + DEPLOYED** and is the authoritative current state. Within the block below, the **"Current state at a glance" table + "Resume checklist" are kept up to date** (they mirror the top); the dated **"DONE / What shipped — &lt;date&gt;"** narratives are preserved as history, so their inline `main` HEAD / test-count figures reflect that session's close — not current._

# Next-session entry point — post 2026-06-27 (OPERATION LAST LIGHT live + image/focal-point pass)

Fresh-session entry point for Air Action Sports. **Updated 2026-06-27.** This session built the `ghost-town-iii-regular-play` draft into **OPERATION LAST LIGHT** — a single-day, 12-hour mission-based event (25 July 2026, Ghost Town / Hiawatha UT, $60) — added a required Russian-vs-NATO **teams picker**, and **PUBLISHED it**. It is now the **first and only published event**, taking **real bookings on live Stripe**. Then a large **image + focal-point pass**: (1) fixed a real bug where `adaptEvent` (useEvents.js) **never forwarded the `*ImagePosition` fields**, so event **cards + the event-detail hero silently used `center`** regardless of the focal picker — now forwarded; (2) pinned the card / locations / hero / banner surfaces to the focal-picker aspect ratios so cover-cropping is WYSIWYG; (3) added a per-event, **per-surface cover-title placement** control (**overlay / below / hidden**) for the event hero + booking banner (admin "Detail page content" → two dropdowns); (4) the **landing-page hero now pulls from the event's Cover (Universal Fallback)** image. `main` **`4af416a`**, **3053 / 264** tests, migrations **0001–0076** (NO new migrations — all via `details_json` + data). Full detail in the **"✅ DONE — 2026-06-27" section** below + memory `event-image-focal-and-title-placement`.

**(2026-06-26) — MULTI-DAY EVENTS shipped + deployed.** A 6-phase feature (PR [#338](https://github.com/bulletbiter99/air-action-sports/pull/338)) added genuine multi-day events (a structured `events.end_date_iso` span) end-to-end — conflict detection, the event-day check-in window (+ a fixed latent timed-date NaN bug), today-active + deferred-revenue span-awareness, public date-range + per-day schedule rendering, and an admin end-date input + per-day schedule editor — merged after a multi-agent code review (findings folded in) with all CI green. **Migration 0076** (`events.end_date_iso`, additive nullable) is applied. The first multi-day event, **`Ghost Town: 18HR MILSIM` (25-26 July 2026)**, was seeded as a **draft** ([#340](https://github.com/bulletbiter99/air-action-sports/pull/340), `published=0`) — operator finalizes prices + publishes. The 2 unpaid Foxtrot cutover invoices were **cancelled** ([#339](https://github.com/bulletbiter99/air-action-sports/pull/339)). `main` **`f1bfa98`**, **3050 / 264** tests, migrations **0001–0076**. (See the "Multi-day events" section below + memory `multiday-events-feature`.) **Prior (2026-06-25): the accounting-dashboard roadmap went FULLY complete** (all 11 surfaces shipped). This session shipped **4 feature PRs + 2 maintenance/docs PRs (#330–#335)**: **A/R aging + DSO** ([#330](https://github.com/bulletbiter99/air-action-sports/pull/330)), **admin visual baseline recapture** ([#331](https://github.com/bulletbiter99/air-action-sports/pull/331)), the **Owner weekly scorecard** ([#332](https://github.com/bulletbiter99/air-action-sports/pull/332)), a docs sync ([#333](https://github.com/bulletbiter99/air-action-sports/pull/333)), a ScorecardGrid render test ([#334](https://github.com/bulletbiter99/air-action-sports/pull/334)), and the **refund-side Stripe-fee reconciliation** ([#335](https://github.com/bulletbiter99/air-action-sports/pull/335) — completes the true-fee feature). Tests **3003 → 3020 / 260**; **no new migrations.** **No roadmap items remain** — remaining work is operator activation only (Marketing send + Resend webhook + FTS flag). Prior context: **2026-06-24** accounting suite #319–#328 (migrations 0074 + 0075); the 2026-06-18 admin design-consistency sweep (#306 / #308–#315 / #317); 2026-06-17 cleared both ⭐ M8 work-menu items (#297–#304); **2026-06-11** waiver-confirmation email + waiver UX (#291–#295, migration 0073) and **2026-06-06** homepage reorder/polish (#289/#290) — all summarized below.
⚠️ **Heads-up on the cutover:** earlier docs recorded the M6 live-Stripe cutover as "DONE 2026-06-02," but it was actually **broken** — production was silently still in Stripe **TEST mode** (every checkout session `cs_test_`) until it was really cut over + e2e-verified on **2026-06-03**. Production now collects real money correctly. See the **2026-06-03 section** below + memory `stripe-live-cutover-fixed-2026-06-03.md`. The earlier **2026-06-02 work-menu session** then completed a 6-item menu + a dark-theme contrast pass and **deployed twice** (`b342b39f` → `94dfb7a9`): applied migrations **0065–0070**, shipped the **marketing route-capability swap**, the **admin dark-theme contrast fix**, **RTL admin-page test coverage**, **representative-data visual baselines**, and **item 6 — admin-editable event content end-to-end** (server sanitizer + admin "Detail page content" editor + Foxtrot seeded live). **What remains (as of 2026-06-17):** operator activation only (Marketing send + Resend webhook + FTS flag) — the item-1 RTL long tail **and** the admin design-consistency sweep are now **DONE** (see the 2026-06-17 section below). Detail below.

---

## Current state at a glance

| Metric | Value |
|---|---|
| `main` HEAD | `cf70e5f` (re-pull for exact; Operation Fire Storm + `/safety`, PR #363 merged + deployed 2026-07-01; Version `453f0873`) |
| Tests | **3149 / 276** all green |
| Build | clean · Lint **0 errors** |
| Production | deployed · `https://airactionsport.com/api/health` → `{"ok":true,...}` — live Stripe + Marketing/deliverability schema + waiver receipts + accounting suite + multi-day support + attendee-verified reviews all deployed. `Operation Last Light` is PUBLISHED + live (real bookings). **`Operation Fire Storm` seeded as a DRAFT** (needs price + publish). **`/safety` briefing page is live.** |
| Migrations on remote | **0001–0077 ALL applied** — a `migrations apply` finds nothing new. (Migration `0077_reviews.sql` applied 2026-06-28 for attendee-verified reviews.) |
| Open PRs | 0 (all merged through #359) |
| Open milestone | **None active.** No milestone/roadmap items remain. The **attendee-verified reviews feature is COMPLETE + DEPLOYED** (dormant until the first review ~2026-07-25). **`Operation Last Light` is LIVE.** **`Operation Fire Storm`** (the former `ghost-town-18hr-milsim` 18HR draft) is now built + deployed as a DRAFT — finalize its **price** and **publish** it. Remaining otherwise: operator activation only (Marketing send + Resend webhook + FTS flag + reviews CAN-SPAM classification). CI green. |

---

## ✅ DONE — Operation Last Light live + image/focal-point pass (2026-06-27)

Operator-driven session. **PRs #342–#349 merged + deployed; tests 3050 → 3053 / 264; no new migrations** (all `details_json` + remote-D1 data). Full durable detail in memory `event-image-focal-and-title-placement`.

### Operation Last Light — built + PUBLISHED (now the only live event)
The separate single-day draft **`Ghost Town III: Recruitment`** (event id **`ghost-town-iii-regular-play`**, NOT the 18HR multi-day event) was built into **OPERATION LAST LIGHT** and **published** — it now takes real bookings on live Stripe.
- Single-day 12-hr mission op, **25 July 2026**, Ghost Town / Hiawatha UT, **$60** (ticket `tt_NzvgjgKN8Kdc`), slug **`operation-last-light`**; `site_id` left NULL (avoids a same-day conflict with the 18HR draft).
- `details_json`: mission briefing, FPS-tier rules, Operation Timeline, three missions (recon patrols / supply convoy escorts / hostage rescue), Russian-vs-NATO theme. No emojis (operator request).
- **Teams picker** at booking = a required `select` custom question (`faction`: Russian Forces / NATO Forces). Civilians are assigned on-site (color tape), so not a booking option.
- Audit SQL in `scripts/`: `seed-operation-last-light.sql`, `golive-operation-last-light.sql`, `set-operation-last-light-placement.sql`, `restore-operation-last-light-placement.sql`.
- ⚠️ **Resolves the old "decide on Ghost Town III: Recruitment" TODO** — that draft IS Operation Last Light now.
- **Stale-admin-tab gotcha (re-confirmed):** a save from a `/admin/events` tab opened *before* a direct D1 edit reverts the whole events row to the stale form values (tickets untouched — they're separate endpoints). It reverted the Day-1 build once mid-session. **Always hard-refresh `/admin/events` after any direct D1 event edit.**

### Image / focal-point system — fixed end to end
- **THE bug (#347):** `adaptEvent` (`src/hooks/useEvents.js`) forwarded image URLs + overlay opacities but **dropped `cardImagePosition` / `heroImagePosition` / `bannerImagePosition`**, so the events-grid **card** and the **EventDetail hero** silently used `center` — the focal picker never applied on them since the focal feature shipped. (Booking banner reads the raw API directly, so it worked.) Now forwarded → all surfaces honor the picker.
- **Aspect-ratio pinning (#343):** the live surfaces used a fixed pixel height (ratio drifted off the picker preview) or `contain` (hero/banner showed the whole image, the focal value only steering an invisible blur backdrop). Now: `.event-cover` → `aspect-ratio: 2/1`; `.site-photo` → `16/9`; the **event hero** + **booking banner** visible layer → `cover` + `var(--*-image-position)` pinned `3.2/1` / `4/1`. So the picker is WYSIWYG everywhere (card / hero / banner / `/locations` / home).
- **Home hero from Cover (#347):** the landing-page hero pulls from `featuredEvent.coverImageUrl || heroImageUrl` (was `heroImageUrl || coverImageUrl`) — controlled via the **Cover (Universal Fallback)** field. `featuredEvent` = `events[0]` (ordered `featured DESC, date_iso ASC`); falls back to the static `/images/logo-hero-fallback.png` when no published event.

### Per-surface cover-title placement (overlay / below / hidden)
For text-heavy POSTER cover art, cropping put the page title over the poster's own title. So a per-event, **per-surface** control: `details.heroTextPlacement` + `details.bannerTextPlacement`, each **`overlay`** (default) / **`below`** (clean image + title beneath) / **`hidden`** (image only, no title). Admin: "Detail page content" → two dropdowns (Event detail hero / Booking banner). Evolved from a single `coverTextBelow` boolean (#344) → per-surface enums (#346); **legacy `coverTextBelow` is read as `below`** on client + server (#349) so a stale-tab save can't reset placement. Operation Last Light = **below/below**.

### Durable lessons (this session)
1. **`adaptEvent` is THE public event mapper** (`useEvents.js`) — any new event field the public card/hero/detail pages need MUST be added there (Booking.jsx uses the raw API; Locations uses `useSites`). The position fields had been silently dropped since the focal feature shipped.
2. **Focal point is WYSIWYG only when the live surface's aspect ratio == the picker's preview ratio, with `cover`** — pin `aspect-ratio` on the live element; don't use a fixed pixel height.
3. **The events-grid card is full-width when there's only one event** (`auto-fit minmax(300px,1fr)`), so a single published event's card is a large 2:1 banner; normal grid sizing returns with multiple events.
4. **A model migration on `details_json` needs a legacy fallback** — stale admin tabs post the old field shape; the new server must still map it (else a save silently wipes the new fields).
5. **Public visual baselines test LIVE prod**, so recapture must run AFTER deploy lands (re-label `capture-baselines` once prod is settled, or it captures the old look and commits nothing). The `admin-taxes-fees` admin baseline is actually a homepage capture (known mislabel — fix someday).

---

## ✅ DONE — Multi-day events + first 2-day event seeded (2026-06-26)

Genuine multi-day event support, shipped as a 6-phase chain ([#338](https://github.com/bulletbiter99/air-action-sports/pull/338)) merged after a multi-agent code review (findings folded in) + all CI green, then **deployed**. Plus the first multi-day event seeded as a draft and the 2 unpaid Foxtrot invoices cancelled. Full design + durable notes in memory `multiday-events-feature`.

- **Schema:** migration **0076** adds nullable `events.end_date_iso` (NULL = single-day, so existing events are byte-identical). Already applied to remote.
- **Phase chain (all additive; Critical payment path — `bookings`/`pricing`/`stripe`/`webhooks` — and `attendees` untouched):**
  1. span column + `parseEventBody`/`formatEvent` `endDateIso` + a **31-day span cap**;
  2. `worker/lib/eventConflicts.js` spans both days (+ **fixed a latent timed-date pre-filter bug**);
  3. `worker/lib/eventDaySession.js` check-in window spans the op (+ **fixed a latent NaN bug where a TIMED `date_iso` made the kiosk never activate** — a real fix affecting ALL timed events);
  4. `/today/active` + deferred-revenue span-aware (revenue recognized at **span END**);
  5. public `EventDetail`/`Booking` date-**range** label + per-day ("Day N") schedule;
  6. admin **End-date input** + per-day schedule editor (`day | time | label`).
- **Reusable:** any event becomes multi-day via the admin form — set the End date + day-prefix the schedule lines. Single-day editing unchanged.
- **First event — `Ghost Town: 18HR MILSIM` (DRAFT, [#340](https://github.com/bulletbiter99/air-action-sports/pull/340)):** 25-26 July 2026 at Ghost Town (`site_3ZQ2j67XEwDG`); "King Coal" theme (GRG vs Cinderjacks); day-keyed schedule; a `faction` custom question; 3 day-pass ticket types (Full Weekend 100 / Day 1 50 / Day 2 50 = 150 per physical day). `scripts/seed-ghost-town-18hr-milsim.sql` applied; **`published=0`**. **⚠️ Operator TODO before publishing:** finalize ticket **PRICES** (placeholders $45 / $85 / $110 — pricing still being discussed), optionally add GRG/Cinderjacks signup links. (The separate same-day draft `Ghost Town III: Recruitment` is now **Operation Last Light** — built + published 2026-06-27, see that section above.) Edit at `/admin/events`; the public page only renders once `published=1` (there is no public draft preview).
- **Foxtrot invoices CANCELLED ([#339](https://github.com/bulletbiter99/air-action-sports/pull/339)):** the 2 unpaid cutover bookings (Kayden Case `bk_HabP7q2dPblyHA` + Eduardo Ames `bk_BusRxaodwLrQN6`, $27.75 ea) → `status='cancelled'` (collection abandoned; signed waivers/attendees/customers kept; reversible). `scripts/cancel-foxtrot-unpaid-cutover.sql`.

**Durable lessons (this session):** (1) the public events API serializes via `formatEvent` (worker/routes/events.js) and filters `published=1` — ALL prod events are currently unpublished, so `/api/events` returns `[]` and `/api/events/:slug` 404s; that is correct pre-existing behavior, not a regression (it briefly looked like a deploy failure during verification). (2) `events.past` is archive-driven, not date-driven. (3) Adding a column to a `SELECT` breaks mockD1 tests keyed to the exact old SQL string — update the mock regexes (hit the event-day route + conflict + today-active suites). (4) the event-day kiosk + `/today/active` had latent timed-`date_iso` bugs (NaN / never-matched-today) that this work fixed as a side effect.

---

## ✅ DONE — accounting roadmap FINISHED (A/R aging + scorecard + refund reconciliation) (2026-06-25)

Shipped the **last three accounting-roadmap items** (the roadmap is now **fully complete** — 11 surfaces) + a CI-hygiene fix. **6 PRs merged + deployed · tests 3003 → 3020 / 260 · no migrations · no do-not-touch files.** Each feature PR was adversarially reviewed by a multi-agent workflow before merge (all verdicts GO; real findings folded in); the scorecard also got a 3-way judge-panel design first. Full design + durable notes in memory `accounting-dashboard-roadmap`.

| PR | What |
|---|---|
| [#330](https://github.com/bulletbiter99/air-action-sports/pull/330) | **Field-rental A/R aging + DSO** (Bookkeeper report) — the roadmap's "A/R section," correctly scoped to AAS's only real receivables (tickets are prepaid via Stripe → the B2B field-rental side is the sole exposure). `computeArAging` buckets outstanding `field_rental_payments` (status='pending') by age past `due_at` (Current / 1-30 / 31-60 / 61-90 / 90+) + overdue split + **DSO** (outstanding ÷ trailing-365-day daily receipts). `GET /api/admin/reports/bookkeeper/ar-aging` (+CSV); `ArAgingCard` on the Bookkeeper tab. **Review fix:** the pending query excludes `fr.status IN ('cancelled','refunded')` (a cancel doesn't cascade to pending payment rows → dead deals would otherwise show as live receivables). Snapshot of now (period filter N/A). Empty until a FR has a pending payment. |
| [#331](https://github.com/bulletbiter99/air-action-sports/pull/331) | **Admin visual baseline recapture** — the Admin visual regression check had been **red on every PR since the accounting suite**: `admin-reports` drifted from #324 (per-event-P&L card on the Owner tab) and `admin-dashboard` from #320 (DeferredRevenue widget). Both genuine drift (not flakes). Recaptured via the `capture-baselines` bot + added a zero-shaped `/analytics/deferred-revenue` mock so the dashboard captures `$0.00` not `$NaN`. **The check is green again.** |
| [#332](https://github.com/bulletbiter99/air-action-sports/pull/332) | **Owner weekly scorecard** (the research's section-1 EOS Level-10 grid) — a 13-week metrics×weeks grid, on/watch/off per cell vs an **auto-derived target**, **nothing to configure**. Designed via a 3-way judge-panel. 6 metrics (Cash In / Earned Revenue / Paid Bookings / AOV / Field Rental Cash / Refund Rate). Target = each metric's 12-week trailing **median** of *active* weeks; quiet/low-volume weeks render **neutral gray** (the seasonality "don't cry wolf" guard); the in-progress + insufficient-baseline weeks are neutral too. `computeScorecard` + `median` (pure) in `worker/lib/reports.js`; `GET /owner/scorecard` (+CSV); new `src/admin/reports/ScorecardGrid.jsx`; `ScorecardCard` at the top of the Owner Reports tab. Shows a "Baseline building" note on the young dataset. |
| [#334](https://github.com/bulletbiter99/air-action-sports/pull/334) | **ScorecardGrid populated-render test** — the visual-admin baseline only captures the scorecard's empty state, so the populated grid render (cells, tints, pills, current-week badge, null→"—") was untested. +2 component tests. |
| [#335](https://github.com/bulletbiter99/air-action-sports/pull/335) | **Refund-side Stripe-fee reconciliation** — completes the true-fee feature (was paid-only). A Stripe refund keeps the original fee → a pure unrecoverable loss the report ignored. Cron candidate widened to `status IN ('paid','refunded')` (captures the original charge fee via the unchanged `retrieveChargeFees`; `webhooks.js` + payment fns byte-untouched). `computeStripeFees` made refund-aware (additive `refundRows`; merges by month; adds `refundedFeeCents` + `refunds` summary + `netKeptCents`). `/bookkeeper/stripe-fees` sums refunded fees (windowed by `paid_at`) + a red "Refund fees" column + a "Lost to refund fees" metric. **No migration** (full refunds only → loss = the full kept fee). |

**Durable lessons (this session):** (1) the Admin visual baseline captures the **Owner** reports tab (mocked persona='owner') — a Bookkeeper-tab card (A/R aging, refund column) does NOT shift it, but an Owner-tab card (scorecard) does → recapture. (2) The `capture-baselines` bot recaptures **both** public + admin suites and commits PNGs; after it pushes, a follow-up commit (a real one or empty) is needed to re-trigger CI past GitHub's anti-recursion block. (3) Comps are structurally **$0** (bookings.js) — so including `'comp'` in cash/earned SUMs is a no-op and comp-only weeks are genuinely $0. (4) `field_rental_payments` pending rows can outlive a cancelled rental (no cascade) — any FR-receivables query must filter `fr.status`. (5) Refunds are **full only** (no `refund_amount_cents`; `issueRefund` called without an amount) → a refunded booking's true-net loss = the full Stripe fee Stripe kept. (6) `events.date_iso` has a TIME component; `formatMoney` has no thousands separator (both still bite).

---

## ✅ DONE — Accounting suite (2026-06-24, the profitability + liquidity core)

A single session built the entire financial heart of an owner-accounting research report — **10 PRs (#319–#328) merged + deployed**, migrations **0074 + 0075** applied to remote, tests **2945 → 3003 / 259 files**, lint clean throughout, **zero changes to the payment-confirmation path**. Full rationale + remaining roadmap in memory `accounting-dashboard-roadmap.md`; the income basis in `income-card-earned-revenue.md`.

| PR | What |
|---|---|
| [#319](https://github.com/bulletbiter99/air-action-sports/pull/319) | **Income card → earned-revenue basis** — `/analytics/overview` Gross/Net now exclude sales tax + the Stripe pass-through fee (operator's choice; `total − tax − fee`). Fixes the home Revenue card + Bookkeeper Books card + `/admin/analytics`. |
| [#320](https://github.com/bulletbiter99/air-action-sports/pull/320) | **Deferred-revenue widget** — `/analytics/deferred-revenue` splits paid-booking earned revenue into **deferred** (event still future → unearned liability) vs **recognized**; "Revenue recognition" card on Owner + Bookkeeper dashboards. No schema change. |
| [#321](https://github.com/bulletbiter99/air-action-sports/pull/321) | **Expenses + Budgets schema + routes** — migration **0074** (`expenses` w/ optional `event_id` tag + `budgets` UNIQUE(period,category) + `finances.read`/`write` caps → owner + bookkeeper); CRUD at `/api/admin/expenses` + `/api/admin/budgets`. |
| [#322](https://github.com/bulletbiter99/air-action-sports/pull/322) | **Expenses + Budgets pages + Finances nav** — `/admin/expenses` (list/filter/modal, optional event tag) + `/admin/budgets` (monthly per-category grid, auto-save). New **Finances** sidebar cluster. |
| [#323](https://github.com/bulletbiter99/air-action-sports/pull/323) | **P&L vs Budget** Bookkeeper report — per-category budget vs spend (variance) + net income. |
| [#324](https://github.com/bulletbiter99/air-action-sports/pull/324) | **Per-event P&L margin** — Owner report; each event's earned revenue − its tagged expenses = margin. |
| [#325](https://github.com/bulletbiter99/air-action-sports/pull/325) | **13-week cash-flow forecast** (backend) — `/api/admin/cash-flow`: opening balance + projected run-rate + FR receipts − budgeted disbursements rolled forward; min-closing trough. |
| [#326](https://github.com/bulletbiter99/air-action-sports/pull/326) | **Cash Flow Forecast page** — `/admin/cash-flow` (inputs + summary cards + closing-cash chart + weekly table + negative-trough warning). |
| [#327](https://github.com/bulletbiter99/air-action-sports/pull/327) | **TRUE Stripe fee capture** (backend) — migration **0075** (`bookings.stripe_fee_cents`/`_net`/`_balance_transaction_id`); additive `retrieveChargeFees` + nightly `runStripeFeeSync` cron (webhooks.js **byte-untouched**). |
| [#328](https://github.com/bulletbiter99/air-action-sports/pull/328) | **"Stripe fees & true net"** Bookkeeper report — actual Stripe fee → net deposited → kept (− sales tax) + effective fee %; reconciled-subset math + coverage note. |

**New admin surfaces:** Finances sidebar cluster (**Expenses / Budgets / Cash Flow**); Owner report **Per-event P&L**; Bookkeeper reports **P&L vs budget** + **Stripe fees & true net**; a new 03:00 UTC daily cron sweep **runStripeFeeSync**.

**Durable design notes:** income/deferred use the earned basis (`total − tax − fee`); `events.date_iso` has a TIME component (normalize with SQLite `date()`); `formatMoney` has **no thousands separator** (`$1250.00`); cash-flow is cash-basis (prepaid bookings are in the opening balance, not double-counted); true-fee capture is a **cron, not a webhook** (DNT-safe, auto-backfills). The remaining roadmap (field-rental AR aging, EOS scorecard, refund-side fee reconciliation) is optional / data-dependent.

---

## ✅ DONE — Admin design-consistency sweep (complete)

**Why:** 2026-06-17 the operator noticed admin pages didn't look the same (Bookings vs Customers). Root cause: ~21 pages rolled their own `<h1>` header while 19 used the shared `AdminPageHeader`; the field-rental + marketing pages also had bespoke filter/table chrome. **Operator-approved direction: conform the outliers to the `AdminPageHeader` house style + standardize the chrome.** Full how-to + durable lessons in memory `admin-design-consistency-2026-06-17.md`.

**House style (canonical):** `AdminPageHeader` (eyebrow breadcrumb + ALL-CAPS title + description + orange `primaryAction`) + shared `FilterBar` (chip-based) + bordered table-box with **orange** `th`, all on `--color-*` tokens. Reference pages: `AdminVendors` / `AdminTaxesFees` / `AdminEvents`.

**All batches merged + deployed:**
| PR | Batch | What |
|---|---|---|
| [#306](https://github.com/bulletbiter99/air-action-sports/pull/306) | 1 | Bookings (list) + Customers (list + detail re-tokenized) |
| [#308](https://github.com/bulletbiter99/air-action-sports/pull/308) | 2a | Staff list + create form |
| [#309](https://github.com/bulletbiter99/air-action-sports/pull/309) | 2b | Field Rentals list + detail + new wizard |
| [#310](https://github.com/bulletbiter99/air-action-sports/pull/310) | 3 | marketing/reports cluster (Segments/Campaigns/Automations/Reports/EventArchive) |
| [#311](https://github.com/bulletbiter99/air-action-sports/pull/311) | 4a | Analytics + Staff Library + Today |
| [#312](https://github.com/bulletbiter99/air-action-sports/pull/312) | 4b | New Booking form (+ detail/sub-page review) |
| [#313](https://github.com/bulletbiter99/air-action-sports/pull/313) | 5a | table-box wrappers (Segments/Campaigns/Automations) |
| [#314](https://github.com/bulletbiter99/air-action-sports/pull/314) | 5b | Field Rentals → shared FilterBar + EmptyState + accent button |
| [#315](https://github.com/bulletbiter99/air-action-sports/pull/315) | docs | handoff sync (next-session.md / CLAUDE.md / memory) |

Result: every admin **list / index / create-form** page now uses `AdminPageHeader`; **detail** pages keep their on-theme bespoke headers (the `AdminBookingsDetail` `.abd-header` precedent); the bare cluster tables are wrapped in the house table-box; Field Rentals uses the shared chip-based `FilterBar`. Added/rewrote RTL render tests for the newly-covered pages (Staff New, EventArchive, Analytics, Staff Library, Today, New Booking) → **2945 / 251**.

**Follow-on close-off ([#317](https://github.com/bulletbiter99/air-action-sports/pull/317), 2026-06-18):** conformed the two surfaces the batch table never reached — the **home dashboard** (`AdminDashboardPersona`, which the operator flagged as "not updated along with the rest") and the **Sites cluster** (`AdminSites` list + `AdminSiteDetail` detail, never in the original batch list). Dashboard bespoke header → `<AdminPageHeader>` (personalized greeting + persona-tag pill move into the description; `+ New Booking` becomes the `primaryAction`, owner/manager only; the dead `__header`/`__subtitle` CSS retired). Sites list → `<AdminPageHeader>`; Site detail → the detail-page precedent (uppercase `--tan-light` back link + 24/900 `--cream` `<h1>`). Both Sites pages' leftover hardcoded light error boxes (`#fef0f0` / `#d4541a`, which the tokens.css alias layer doesn't cover) → dark `--color-danger-soft`. Per-element swaps, no behavior/schema change; the `/admin/dashboard` visual baseline is refreshed via `capture-baselines` (Sites has no baseline).

**Deliberately DECLINED (operator-agreed, NOT oversights):**
- **AdminCampaigns FilterBar** — kept its clean segmented status-button row (the chip "+ Add filter" flow is more clicks for a single filter).
- **FieldRentals detail/new page primary buttons** — still rounded (minor; the FilterBar migration targeted the list page).

(The **AdminDashboardPersona header** was previously on this declined list; the operator reversed that on 2026-06-18 → conformed in #317 above.)

**Durable lessons** (full detail in memory):
- **`FilterBar` is chip-based**, not always-visible selects — migrating a page is a real UX shift, and its test must mock `/api/admin/saved-views` (FilterBar calls `useSavedViews` when `savedViewsKey` is set). Test filters URL-driven (`?status=sent` → assert the `Remove Status filter` chip + scoped fetch), not via the picker UI.
- **Detail-page house style exists** (`AdminBookingsDetail.css` `.abd-header-row h1` — 24px/900/uppercase/`--cream` + tinted monospace `<code>` + `.abd-back`); conform a detail page only if it diverges from it.
- **The `capture-baselines` recapture flow** (only needed when a changed page HAS an admin baseline — Bookings/Customers/Segments/Campaigns/Automations/Reports do; Staff/FieldRentals/Analytics/Today don't): add the label → bot recaptures → **then push an empty commit** to clear GitHub's anti-recursion `action_required` block so CI re-runs green.
- **Side finding (still open, pre-existing):** the `admin-taxes-fees` visual baseline actually captures the public homepage, not the admin page — a broken baseline worth fixing someday.

---

## What shipped — 2026-06-17 session (M8 design sweep + RTL coverage long tail)

Cleared **both ⭐ work-menu items**. **8 PRs merged + deployed** (#297 audit cleanup · #298 design sweep · #299–#304 RTL batches A1–A6). Tests **2860 → 2933 / 245** (+73). No `src/` runtime changes except the design sweep's token swaps; everything else is additive test files. No new migrations.

- **Production test-data cleanup** ([#297](https://github.com/bulletbiter99/air-action-sports/pull/297)): swept 10 leftover test bookings (Glen Anderson's 5× $0.30 carts + the cutover-era $0.56 / "Cutover Verify" / 3× Tyson-Wright-TEST rows) + 1 orphaned operator customer from prod D1; recorded as audit SQL under `scripts/cleanup-*.sql`. Paid revenue untouched (prod bookings 56 → 46). The 2 cutover invoices (Kayden Case + Eduardo Ames, $27.75 ea) were **cancelled 2026-06-25 (collection abandoned)** — see Operator-pending.
- **Admin design-consistency sweep** ([#298](https://github.com/bulletbiter99/air-action-sports/pull/298)): re-themed the field-rental status/COI pills (shared `classifyStatus`/`classifyCoiStatus`), the `dangerBtn`, error/step/conflict boxes, the selected-customer box, and the public Contact alert boxes from light pastels to dark `--color-*-soft` tokens. **Per-element inline-style swaps only (no token-value edits) → zero visual-baseline ripple.** Contact verified rendering dark on the live public shell.
- **M8 RTL coverage long tail** ([#299](https://github.com/bulletbiter99/air-action-sports/pull/299)–[#304](https://github.com/bulletbiter99/air-action-sports/pull/304), batches A1–A6): component-render tests for **all 12 remaining admin pages** — Waivers, Vendors, Bookings(+Detail), Events, Roster, FieldRentals(+Detail/New), Staff(+Detail), Scan. Combined with Batch 1 (#269), the JSX coverage long tail is complete.

**Durable lessons (RTL):**
1. **`userEvent` dismisses fixed-overlay modals opened by a row/action button** — its full pointer sequence closes the just-opened modal. Use `fireEvent.click` for those opens (header-button opens are fine with `userEvent`). The public Waiver suite already used `fireEvent` for the same reason.
2. **Anchor row assertions on unique data, not status-pill text** — FilterBar status `<select>` options collide with the row status pills (same labels). Use ids / titles / totals.
3. **An editor/duplicate cascade can leave a trailing fetch** — if a test ends before a cascaded `setEditingId → /detail` fetch resolves, it lands in the next test's window and trips the throw-on-unmocked guard. Await the cascade settling (e.g. the editor heading) in-test.
4. **`vi.hoisted` mocks a hard import like `@zxing/browser`** — define the inner `vi.fn()`s with `vi.hoisted`, reference them in the `vi.mock` factory, and capture the decode callback to simulate a scan with no camera.

---

## What shipped — 2026-06-11 session (waiver UX + confirmation-email feature)

Triggered by a customer email (Max Prudden, `foxtrot-vietnam`): *"I believe I got my waiver all signed… but it kept taking to the top of the page whenever I clicked submit."* His waiver WAS signed (verified in prod D1 — the final submit succeeded); the session then fixed everything the report exposed. **5 PRs (#291–#295) merged + deployed + live-verified; migration 0073 applied; tests 2834 → 2860 / 233.**

- **Waiver failed-submit UX** ([#292](https://github.com/bulletbiter99/air-action-sports/pull/292)): the failed-validation branch did a bare scroll-to-top while the error highlights sat below the fold — looked like a silent reset. Now: scroll to + focus the **first invalid field** (visual order via `FIELD_ORDER`, honors reduced-motion) + a `role="alert"` count banner above Submit + per-field errors clear as the user edits. Ships the **first public-page RTL suite** (`tests/unit/pages/Waiver.test.jsx`).
- **Error boxes unstyled on direct loads** ([#293](https://github.com/bulletbiter99/air-action-sports/pull/293)): `.booking-error` lives only in the Booking route's lazy chunk, so Waiver's `submitError` + under-12 BLOCKED boxes rendered transparent on a direct `/waiver` visit. Inlined via a module-level `ERROR_BOX_STYLE` (per-side border longhands — mixing the `border` shorthand with `borderLeft` in one React style object draws the mixed-shorthand warning). Scope note: **BookingSuccess.jsx imports booking.css itself — needed no fix.**
- **Waiver-confirmation email feature** ([#294](https://github.com/bulletbiter99/air-action-sports/pull/294) + migration **0073** + [#295](https://github.com/bulletbiter99/air-action-sports/pull/295)): signing was completely silent, email-wise. Now every successful signing emails the signer a receipt — `waiver_confirmation` template (house dark style, signed date + valid-through + ticket link; editable at `/admin/email-templates`) + append-only `sendWaiverConfirmation` + an **additive guarded `waitUntil` hook in the Critical-DNT waiver POST** (whole queued body inside its own catch — can never affect the signing transaction; all Group C gate tests stayed byte-green). Admin: `POST /api/admin/bookings/:id/resend-waiver-confirmation` + a **"✉ Resend waiver confirmation"** button on `/admin/bookings/:id` (shown when any attendee has signed; deliberately NOT payment-gated). The post-sign screen now says "A confirmation email is on its way to {email}".
- **Grammar fix in 3 mirrors:** the all-signed single-player summary read "All 1 player already have a valid waiver on file" → now "Your player's waiver is already on file…" in `emailSender.js` + `emailTemplatePreview.js` (kept byte-identical) + `BookingSuccess.jsx`.
- **Sales-series test calendar time bomb** ([#291](https://github.com/bulletbiter99/air-action-sports/pull/291)): a mocked row hardcoded to `2026-05-09` vs the endpoint's trailing-30-day window — expired 2026-06-08 and was the only red test on `main`. Now derives the date dynamically. **Durable lesson: never hardcode dates inside relative-window assertions.**
- **Customer closed out end-to-end:** operator clicked the new resend on `bk_0W0OhROeOgUb65` → `booking.waiver_confirmation_resent` audit row → receipt delivered to the customer (doubled as the feature's production e2e).

---

## What shipped — 2026-06-06 session (homepage reorder + polish)

PRs [#289](https://github.com/bulletbiter99/air-action-sports/pull/289) + [#290](https://github.com/bulletbiter99/air-action-sports/pull/290): homepage section reorder + conversion improvements; section background dark/mid alternation restored; attendee counters now render only at **≥50** (shared helper — Home + Event Detail + Events listing); nav **"Games" → `/games`** archive (was the `/#games` anchor). ⚠️ The home/events **public visual baselines were last captured at #289** — #290's background changes postdate them (a Cloudflare edge-cache race blocked the recapture; memory `visual-baseline-cf-cache-gotcha`). Visual CI has passed consistently since; if a diff ever appears, recapture via the `capture-baselines` label. A "cache-bust visual test URLs" background-task chip exists for the durable fix.

---

## What shipped — 2026-06-03 session (Stripe live-cutover FIX + Volga rentals)

⚠️ **The "cutover DONE 2026-06-02" records below were inaccurate.** Production was silently in Stripe **TEST mode** (every checkout `cs_test_`) — the operator reported "tickets purchased but not showing in Stripe." Full root-cause + fix in memory `stripe-live-cutover-fixed-2026-06-03.md`.

- **Stripe live cutover — actually completed + e2e-verified 2026-06-03 (secrets only, no code change).** Operator set the live `STRIPE_WEBHOOK_SECRET` then `STRIPE_SECRET_KEY` (webhook-secret-before-API-key = safe order, no real-charge-but-unconfirmed window); a first bad `whsec_` copy threw 400s → re-copied from the destination → 200. Verified end-to-end with a real **$0.56** booking: `cs_live_` session → webhook auto-confirmed → live `cus_` + attendee/QR created → booking-confirmation + waiver emails delivered to the operator's **inbox** (SPF/DKIM/DMARC OK) → **$0.56 refunded**. Live Stripe webhook destination = **`upbeat-harmony`** → `/api/webhooks/stripe` (`checkout.session.completed` + `charge.dispute.created`). **Production now collects real money correctly.**
- **4 test-mode "paid" bookings collected $0** (real cards can't complete a test-mode checkout). Operator kept their bookings + QR tickets and sent each a **live Stripe invoice** to collect. **Reconciliation method:** on payment, clear the dead test `stripe_payment_intent` (NULL; status stays `paid`) + write an `audit_log booking.payment_reconciled` row. **✅ Paid + reconciled:** Tyson Wright (`bk_v8JmtpX9L6lclQ`), Kyle Kitagawa (`bk_9keBjkqsBhw7Et`). **❌ Cancelled 2026-06-25 (collection abandoned):** Kayden Case (`bk_HabP7q2dPblyHA`, $27.75) + Eduardo Ames (`bk_BusRxaodwLrQN6`, $27.75) — see Operator-pending.
- **Volga Flank rental content — PRs [#280](https://github.com/bulletbiter99/air-action-sports/pull/280) + [#281](https://github.com/bulletbiter99/air-action-sports/pull/281), merged + live.** New data-driven `event.details` fields rendered in `EventDetail.jsx` (all additive — events without them render byte-identically, so the `operation-nightfall` visual baseline is untouched + CI passed clean):
  - `partnerRentals` (`{heading, note, partners[], items[]}`) — a **Gear Rentals** table under Admission; each `item` (`{name, price, url}`) is an outbound new-tab link (PVS-14 NVG **$80** + Rental Rifle Package **$25**, both on MilSim City's store); `partners[]` (`{name, color}`) tints each partner name in the heading its brand color (MilSim City green `#A8C036`, RSTS red `#E42A30`, sampled from the collab-banner logos) via the new `colorizePartners` helper.
  - `admissionLabel` / `admissionNote` — overrides the BYO-gear row label + adds a restriction sub-line ("No Black Plate Carriers & Clothes (Tops/Bottoms) Black Rucks okay.").
  - `.pricing-table--cols` CSS modifier — fixed-width price column aligning the Admission + Gear Rentals tables; applied only when an event has rentals.
  - `scripts/update-volga-partner-rentals.sql` is the applied D1 record. **To add rentals/restrictions to another event (e.g. Foxtrot): same pattern — `json_set` the fields into `events.details_json`; no code change needed.**
- **Admin booking reschedule — "Move to another event"** (PR [#284](https://github.com/bulletbiter99/air-action-sports/pull/284), merged + live; +11 tests → **2834 / 228**). New `POST /api/admin/bookings/:id/reschedule` (owner/manager — **no new capability or migration**) + a button + modal on `/admin/bookings/:id`. Remaps the booking's event + line-item ticket types + every attendee + both events' `sold` counts; same booking id/QR carry over; payment preserved (price differences flagged, not auto-settled); checked-in bookings blocked; reminders reset; optional confirmation re-send; `booking.rescheduled` audit. Built after a comp was created on the wrong event (`bk_jNcrJZxc7FtP9f`, Volga→Foxtrot, fixed by hand first). Memory `booking-reschedule-feature.md`.

---

## What shipped — 2026-06-02 work-menu + deploy session

A large session worked a 6-item work menu + an injected dark-theme contrast pass, then merged + **deployed twice** (`b342b39f` → `94dfb7a9`). All PRs (#269–#278) merged to `main`.

- **Item 2 — Marketing route-capability swap** ([#273](https://github.com/bulletbiter99/air-action-sports/pull/273)): applied migrations **0065–0070** to remote (verified 10 marketing caps / 10 owner bindings / 5 new tables), then swapped segments/campaigns/automations from `requireAuth` to a method-aware `requireCapability('marketing.*')` (GET/preview→read, DELETE→delete, else→write). Route tests bind the caps via `bindCapabilities`.
- **Item 3 — Stripe live-cutover marked DONE** ([#270](https://github.com/bulletbiter99/air-action-sports/pull/270)): operator confirmed all 5 items; checklist/docs/memory flipped. **Production takes real payments.**
- **Item 4 — `role="table"` re-confirmed** (skip ARIA-grid cell nav) ([#270](https://github.com/bulletbiter99/air-action-sports/pull/270)).
- **Item 5 — representative-data visual baselines** ([#271](https://github.com/bulletbiter99/air-action-sports/pull/271) + recapture [#274](https://github.com/bulletbiter99/air-action-sports/pull/274) + flake fix [#278](https://github.com/bulletbiter99/air-action-sports/pull/278)): Customers / Segments / Taxes&Fees populated baselines added; all admin baselines recaptured.
- **Item 6 — admin-editable event content (COMPLETE)**: server **`normalizeEventDetails`** sanitizer ([#275](https://github.com/bulletbiter99/air-action-sports/pull/275)) → admin **"Detail page content" editor** in `AdminEvents` ([#276](https://github.com/bulletbiter99/air-action-sports/pull/276)) → **Foxtrot seeded live** (mission briefing + reuse hero as card; [#277](https://github.com/bulletbiter99/air-action-sports/pull/277)). Operators now edit any event's detail-page fields (mission briefing / timeline / FPS / rules / docs / terrain / faction links) in the form; blank fields fall back to the site default. `src/admin/eventDetailsForm.js` converts form text ↔ the `details_json` payload; the server sanitizes + URL-guards.
- **Item 1 — RTL admin-page test backfill (batch 1)** ([#269](https://github.com/bulletbiter99/air-action-sports/pull/269)): AdminSegments / Customers / CustomerDetail / TaxesFees / PromoCodes (+32 tests). **Long tail remains.**
- **Contrast pass** ([#272](https://github.com/bulletbiter99/air-action-sports/pull/272)): the app is **one dark theme**; a cluster of admin surfaces (FilterBar on every list page, Field Rentals, Sites, ImageFocalPicker, customer modals, Events conflict banner) rendered **undefined "phantom" light-theme tokens** → invisible dark text + white boxes. Fixed by aliasing the phantom tokens onto the real `--color-*` tokens in `tokens.css` + re-theming the few hardcoded-white inputs. See memory `admin-dark-theme-contrast.md`.

**Durable lessons** (full detail in memory `work-menu-deploy-session.md`): D1 quirk #1 ("wrangler rejects `TRANSACTION` even in comments") is **overstated** — disproven by 19 applied migrations that contain it in comments; admin pages are **auth-gated → not visually verifiable in the dev preview** (use the visual-admin CI harness + operator eyeball); the `capture-baselines` label flow; `bindCapabilities` for cap-swap tests.

---

## What shipped in the event-content session (2026-06-02)

Operator-driven content build for two live events + the reusable plumbing behind it. PRs #254/#255/#256/#257 merged, #1 closed. **No new unit tests** (JSX + data); CI + **both visual-regression suites green**; every other event verified untouched.

- **Cleanup:** #254 removed the stale "Coming in M5/M6" persona-dashboard placeholder tiles; **closed PR #1** — a stale Cloudflare-bot PR that would have renamed the Worker `air-action-sports`→`action-air-sports` and broken production deploys. Also cleared production test data (2 refunded + 1 abandoned test bookings + their attendees/waivers/customers) and fixed the foxtrot event title typo + empty slug.
- **Per-event data-driven pages (#255):** `src/pages/EventDetail.jsx` + `src/hooks/useEvents.js` (`adaptEvent` now forwards `event.details`) + `src/pages/Booking.jsx` render optional `events.details_json` fields with the existing hardcoded content as the fallback — a single event can be fully customized with **zero effect on other events** (details_json NULL → byte-identical). `formatEvent` / `bookings.js` / `pricing.js` / `stripe.js` untouched.
- **Foxtrot Jungle Warfare:** time window → `7:00 AM – 2:00 PM` + stale `display_date` fix (data only; `scripts/update-foxtrot-time.sql`).
- **Volga Flank — fully built (data + R2):** `details_json` (Squad Force on Force label, 18-hr MILSIM timeline, blind-fire-allowed + Joule-FPS rules override, mission briefing, Required Documents [RSTS SOP + Kraken/NATO + Bolotnik/RUSFOR forms], Foxtrot-site terrain, FPS) + a per-attendee **faction selector** (Kraken/Bolotnik, required) with an **inline per-faction registration link** (`details.factionLinks`) + quick-facts alignment + 3 images uploaded to R2 (hero = night group photo, card = recon photo, logos = MILSIM CITY/AAS/RSTS banner). Audit SQL: #256 (images) + #257 (Bolotnik RUSFOR link). `scripts/update-volga-*.sql`.
- **New reusable capability:** events are now content-drivable via `details_json` — full how-to in memory `event-content-data-driven.md`. **Volga Flank (`volga-initiative`, slug `volga-flank` — renamed from "Volga Initiative" 2026-06-02 via `scripts/update-volga-rename.sql`; id unchanged so booking FKs + the old URL still resolve) is the live built example; Foxtrot (`foxtrot-vietnam`) uses the hardcoded fallbacks.**

---

## Follow-up — Volga Flank hero photo refresh (2026-06-02)

The Volga Flank hero photo was swapped. `serveUpload` serves `/uploads/*` with `Cache-Control: …, immutable` (1yr) + CDN edge cache, so an in-place overwrite would NOT reach visitors — instead the new photo went to a **fresh content-hashed key** `events/volga-hero-be1eee1d2f74.jpg` and `events.hero_image_url` was repointed (1 row; verified live at `/api/events/volga-flank`, rendered + screenshotted on prod). Audit SQL `scripts/update-volga-hero-refresh.sql` + this doc sync are **merged in PR [#261](https://github.com/bulletbiter99/air-action-sports/pull/261)** (`main` @ `84ed53d`). The reusable gotcha (image replacement ≠ overwrite) is now CLAUDE.md event-content **lesson #5** + memory `event-content-data-driven.md`.

- **Optional operator cleanup (not blocking):** the old hero object `events/volga-hero-3dfe99d37edd.jpg` is now an orphan in R2 — harmless, fully de-referenced (no D1 row, no code ref). Its bytes are the only copy, so deleting is irreversible. To remove it, run yourself: `source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler r2 object delete "air-action-sports-uploads/events/volga-hero-3dfe99d37edd.jpg" --remote`

---

## What shipped — admin image focal-point positioning + data-driven Locations (2026-06-02)

A ~9-batch feature (PRs **#263–#266**, all merged + deployed) resolving feedback **`fb_Su6LWtWJz2FI`** ("position uploaded images for best visibility — see the Ghost Town image"). Full how-to in memory `image-focal-positioning.md`.

- **Reusable `ImageFocalPicker`** (`src/components/admin/ImageFocalPicker.jsx`) — drag a focal point + live cropped preview + keyboard nudge. Two consumers: the event image picker (`AdminEvents`) and the admin site editor (`AdminSiteDetail` → "Locations page content").
- **Events** (migration **0071**): `card/hero/banner_image_position` mirror the `*_overlay_opacity` path; applied on the public card / hero backdrop / booking banner. **Sites** (migration **0072**): `photo_position` + public-content columns (`badge`/`features_json`/`game_types_json`/`location_blurb`/`show_on_locations`/…).
- **`/locations` is now data-driven** — public `GET /api/sites` → `src/hooks/useSites.js` → `src/pages/Locations.jsx`. The 3 locations are seeded into the `sites` table (`scripts/seed-location-content.sql`). **Home's locations preview stays STATIC** (`src/data/locations.js`, untouched — different card shape, avoids home-page visual churn). Ghost Town crop fixed (`photo_position='50% 30%'`).
- Tests **2776 / 220**; both visual-regression suites green; the position value is sanitized server-side (`normalizeImagePosition`).

**✅ MIGRATION STATE RESOLVED (2026-06-02):** all **0001–0072 are now applied/recorded** — the prior out-of-band deferral is closed, and a `wrangler d1 migrations apply --remote` finds nothing new. (History: 0071/0072 were applied out-of-band first; the work-menu session then applied 0065–0070, so `d1_migrations` is recorded out-of-order — harmless.)

---

## ⚠️ Operator-pending (what's LEFT after the 2026-06-02 deploy)

**Unchanged by the 2026-06-06 + 2026-06-11 sessions.** Migrations **0065–0070 are now applied** and the **marketing route-capability swap is deployed** (`b342b39f`). What remains is env/secret/flag activation — every feature degrades gracefully (empty lists / no-op cron / 500 on the unset webhook) until then.

**✅ RESOLVED 2026-06-25 — the final 2 cutover invoices were CANCELLED (collection abandoned):** of the 4 test-mode "paid" bookings that collected $0, two paid their live Stripe invoice (Tyson Wright + Kyle Kitagawa — reconciled). The other two — **Kayden Case (`bk_HabP7q2dPblyHA`) + Eduardo Ames (`bk_BusRxaodwLrQN6`), $27.75 ea (Foxtrot)** — were never paid; on 2026-06-25 the operator chose to stop carrying them, so both were set to `status='cancelled'` + `cancelled_at` (signed waivers / attendees / customer rows intentionally KEPT; reversible) via `scripts/cancel-foxtrot-unpaid-cutover.sql`. **No further collection planned.** (Reconciliation method for the two that DID pay is in memory `stripe-live-cutover-fixed-2026-06-03.md`.)

  **Update 2026-06-04 (revenue reconciliation):** the dashboard's paid total was $55.50 ahead of Stripe because it counted these 2 as paid. Fixed — both set to `status='unpaid'` (test PIs cleared) so they drop out of paid-revenue, and the event-day check-in scanner now flags **"⚠ Payment due"** for them (PR [#286](https://github.com/bulletbiter99/air-action-sports/pull/286), `src/event-day/AttendeeDetail.jsx` — flags any scanned booking whose status ≠ paid/comp). Also cleaned up the $0.56 e2e test booking (cancelled — it had re-paid via a delayed Stripe webhook retry; lesson: a redelivery re-pays any non-`paid` booking). Dashboard paid is now **$497.80 = Stripe net volume**. **Update 2026-06-25:** rather than wait for payment, the operator cancelled both (collection abandoned) — `status='cancelled'`, see the RESOLVED item above + `scripts/cancel-foxtrot-unpaid-cutover.sql`.

**Activate marketing sends + deliverability tracking** — full detail in [docs/runbooks/marketing-deploy.md](runbooks/marketing-deploy.md) + [docs/runbooks/m7-deploy.md](runbooks/m7-deploy.md):
1. **`MARKETING_POSTAL_ADDRESS`** (CAN-SPAM, required) + **Resend plan upgrade** (+ optional marketing subdomain) — the campaign/automation send cron **no-ops** until both are set.
2. **`wrangler secret put RESEND_WEBHOOK_SECRET`** + add the Resend dashboard webhook → `https://airactionsport.com/api/webhooks/resend`, subscribing `email.bounced`/`complained` (M7 deliverability alerts) **and** `email.delivered`/`opened`/`clicked` (campaign tracking). Until set, `/api/webhooks/resend` returns 500 + campaign stats stay at 0.
3. **Flip the FTS flag:** `UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';`

**Eyeball (no automated coverage):**
4. The M7 virtualized lists' sticky headers + the Reports custom-range UI.
5. The **dark-theme contrast pass**: `/admin/field-rentals` (+`/new`), `/admin/sites`, an image picker, and any list page's **FilterBar + filter chips** should now render dark + legible (were invisible/white before).

**✅ DONE:** migrations 0065–0070 applied (Marketing + M7 deliverability, 2026-06-02) · marketing route-capability swap (`requireCapability`, 2026-06-02) · admin dark-theme contrast fix (2026-06-02) · **live-Stripe cutover REALLY completed + e2e-verified 2026-06-03** — the 2026-06-02 "done" record was inaccurate (prod was silently in Stripe TEST mode until then); production now takes real payments. The prior out-of-band-migration deferral is resolved.

---

## Work menu (pick for the next session)

**The accounting-dashboard roadmap is FULLY COMPLETE** (all 11 surfaces shipped; see memory `accounting-dashboard-roadmap`). No roadmap items remain. The natural next work is **operator activation** (row 8) or a **new feature direction from the operator**. Net-new accounting ideas if asked: explicit per-metric scorecard goals (a small `scorecard_goals` table — currently auto-median targets), a status-history-backed lead-conversion funnel, or refund attribution by `refunded_at` (a "refunds this period" view; the report currently attributes refund fees by `paid_at` cohort).

| # | Track | Notes |
|---|---|---|
| 0 | ~~Refund-side Stripe-fee reconciliation~~ | ✅ **DONE 2026-06-25** ([#335](https://github.com/bulletbiter99/air-action-sports/pull/335)) — completed the true-fee feature; cron now reconciles paid + refunded, and the "Stripe fees & true net" report shows refund-fee losses + `netKept`. Roadmap finished. |
| 1 | ~~M8 — JSX coverage backfill (long tail)~~ | ✅ **DONE 2026-06-17.** Batch 1 (#269) + batches A1–A6 ([#299](https://github.com/bulletbiter99/air-action-sports/pull/299)–[#304](https://github.com/bulletbiter99/air-action-sports/pull/304)) cover all 12 target admin pages: Waivers, Vendors, Bookings(+Detail), Events, Roster, FieldRentals(+Detail/New), Staff(+Detail), Scan. Patterns: `renderWithAdmin`/`renderWithRouter` + `installClientFetch`; sized-`ResizeObserver` stub for VirtualizedList pages; `fireEvent` for fixed-overlay modals; `vi.hoisted` `@zxing/browser` mock for Scan. |
| 2 | **Marketing route capability swap** | ✅ **DONE 2026-06-02** (deployed) — segments/campaigns/automations now `requireCapability('marketing.*')`, method-aware, with caps bound in the route tests. Remaining marketing polish: optional `date_relative` automation trigger + a formal sidebar "Marketing" group + **send activation** (operator-pending #1–2 above). |
| 3 | **M6 live-Stripe cutover** | ✅ **DONE 2026-06-03** (the 2026-06-02 record was inaccurate — prod was silently in Stripe TEST mode until then). Production now takes real payments, verified e2e. ⏳ 2 invoice-remediation payments still outstanding — see Operator-pending. [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md). |
| 4 | ~~Full ARIA-grid cell navigation~~ | ✅ **Re-confirmed SKIP 2026-06-02** — keep `role="table"`. Roving-tabindex cell-nav can't reach un-rendered (virtualized) rows, so `grid` would be a fragile half-pattern; the tables already expose full row/cell + position semantics with no nav obligation. Operator decision stands (see CLAUDE.md M8 lesson #6). |
| 5 | ~~Representative-data baselines~~ | ✅ **Customers/Segments/TaxesFees added + all admin baselines recaptured 2026-06-02.** The `installAdminMocks` overrides → `capture-baselines` pattern is available for any further populated tables. |
| 6 | **More event content** (operator, now self-serve) | Item 6's admin editor is **LIVE** — add per-event content (mission briefing / timeline / FPS / rules / docs / terrain / faction links) via `/admin/events` → "Detail page content". Foxtrot's mission briefing is seeded; the operator fills the rest there. Images → R2 via `wrangler r2 object put`. |
| 7 | ~~Admin design-consistency sweep~~ | ✅ **DONE 2026-06-17** ([#298](https://github.com/bulletbiter99/air-action-sports/pull/298)). Re-themed the field-rental status/COI pills (shared `classifyStatus`/`classifyCoiStatus`), the `dangerBtn`, error/step/conflict boxes, the selected-customer box, and the Contact-form alert boxes to dark `--color-*-soft` tokens. Per-element inline-style swaps only (no token-value edits) → zero visual-baseline ripple. Memory `admin-dark-theme-contrast.md`. |
| 8 | **Operator activation** | Marketing send (`MARKETING_POSTAL_ADDRESS` + Resend upgrade) + `RESEND_WEBHOOK_SECRET` + Resend webhook + flip `audit_log_fts` — see Operator-pending above + runbooks. |

---

## Resume checklist (fresh session)

```bash
cd C:/Users/bulle/OneDrive/Desktop/Claude\ Code\ Projects/action-air-sports
git checkout main && git pull origin main
npm install
npm test -- --run | tail -3        # expect 3149 / 276
npm run build 2>&1 | tail -3        # expect clean
curl -s https://airactionsport.com/api/health   # {"ok":true,...}
```

---

## Key reference docs

| Path | Purpose |
|---|---|
| `docs/next-session.md` | THIS FILE — current state + work menu |
| `CLAUDE.md` | durable rules + per-milestone/session log (M1–M7 + post-M7 + M8 + **event-content session**) |
| `HANDOFF.md` | full session-start onboarding (stack, schema, API surface) |
| `src/pages/EventDetail.jsx` + `src/hooks/useEvents.js` | **per-event `details_json` rendering** (overrides w/ hardcoded fallbacks) — event-content session |
| memory `event-content-data-driven.md` | how to customize one event's page (details_json) + upload event images to R2 |
| memory `image-focal-positioning.md` | the focal-positioning feature + ⚠️ the **out-of-band 0071/0072 migration state** |
| `src/components/admin/ImageFocalPicker.jsx` + `src/hooks/useSites.js` | reusable focal picker + the `/api/sites` hook (focal-positioning feature) |
| `scripts/update-volga-*.sql` / `update-foxtrot-time.sql` | audit record of the Volga/Foxtrot content + image + faction-link writes |
| `tests/helpers/renderComponent.jsx` | RTL/jsdom render helpers (`render` / `renderWithRouter` / `renderWithAdmin`) — M8; `tests/unit/pages/Waiver.test.jsx` is the first PUBLIC-page RTL suite |
| `worker/lib/emailSender.js` `sendWaiverConfirmation` + the hook in `worker/routes/waivers.js` | **waiver-confirmation receipt** (auto on signing; admin per-booking resend on `/admin/bookings/:id`) — 2026-06-11 |
| `tests/helpers/mockClientFetch.js` | client-side `fetch` mock for component tests — M8 |
| `docs/runbooks/marketing-deploy.md` | Marketing B1–B6 deploy + activation (migrations 0067–0070) |
| `docs/runbooks/m7-deploy.md` | M7 deploy + its operator-pending (0065/0066, Resend, FTS flag) |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 live-Stripe operator items (+ #233/#249 code-readiness audit at top) |
