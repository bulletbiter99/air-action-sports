# Next-session entry point — growth plan STARTED (2026-07-31)

## ✅ Current state

`main` (re-pull for exact HEAD) · **3631 / 307** tests · lint 0 errors · build clean · **0 open PRs** · migrations **0001–0080 ALL APPLIED to remote — this session added NONE** · production auto-deploys on merge via Workers Builds.

**Nothing is blocking.** The 2026-07-31 session executed the first slice of the growth plan (8 PRs, #418–#425) plus a full dead-link sweep. Everything shipped is verified live in production, not merely merged.

**Read the 2026-07-31 section immediately below before picking up the growth plan** — the plan document itself is now partly stale, and this session's re-verification is what supersedes it.

## 🚩 THE ONE THING THAT GATES EVERYTHING ELSE

**AI crawlers are blocked at the Cloudflare edge.** Measured live 2026-07-31:

```
GPTBot/1.2      403      Googlebot/2.1         200
OAI-SearchBot   403      bingbot/2.0           200
ClaudeBot/1.0   403      facebookexternalhit   200
PerplexityBot   403      (regular browser)     200
```

Cloudflare also **injects a managed robots.txt** ahead of `public/robots.txt` that says `Disallow: /` for ClaudeBot, GPTBot, Google-Extended, CCBot, Bytespider, Amazonbot, Applebot-Extended and meta-externalagent, plus `Content-Signal: ai-train=no`.

**Editing `public/robots.txt` CANNOT fix this** — the managed block is prepended at the edge and is not in the repo. The fix is Cloudflare dashboard → Security → Bots → AI Scrapers & Crawlers. **The operator decided (2026-07-31) to allow search/reference while keeping `ai-train=no`, but has not yet confirmed the toggle was flipped.** Re-verify with the curl block above before assuming.

Until it flips, every structured-data improvement below is real for Google/Bing/social scrapers and **invisible to the AI assistants the growth plan was mostly aimed at**. This likely also explains the long-standing mystery of `/api/events` never loading from GitHub-runner CI.

## ✅ DONE — growth plan, first slice + dead-link sweep (2026-07-31, PRs #418–#425)

Two multi-agent workflows ran first: an 11-agent re-verification of `docs/growth-plan-2026-07.md` against current `main` (the plan was written at `def6848`, ~40 PRs earlier), and a 12-agent dead-link sweep (504 link targets checked). Both produced adversarial critiques that **changed what shipped** — see the lessons at the bottom.

| PR | What | Verified live |
|---|---|---|
| [#418](https://github.com/bulletbiter99/air-action-sports/pull/418) | **`rewriteEventOg` predicate aligned to the #404 contract.** It still filtered `AND published = 1` while the public route had moved to `published = 1 OR past = 1`, so with all 5 events archived, EVERY event page served the generic homepage shell to crawlers and social scrapers — no title, no OG image, no JSON-LD | ✅ real titles + OG + the 4.7★ aggregateRating |
| [#419](https://github.com/bulletbiter99/air-action-sports/pull/419) | **Removed a 50% cancellation credit the business does not honor.** `faq.js` promised it; the booking page implied the opposite. Operator confirmed: nothing is recoverable inside 48h. Now one shared constant in `src/data/policies.js` | ✅ `/faq` |
| [#420](https://github.com/bulletbiter99/air-action-sports/pull/420) | **Fabricated testimonials deleted site-wide.** `SocialProof` was never wired to `useReviews`, so `/locations` and every event page rendered invented quotes — including one praising "Echo Urban", a site that has never existed — at a hardcoded 5 stars, while 3 real reviews went unused | ✅ `/locations` |
| [#421](https://github.com/bulletbiter99/air-action-sports/pull/421) | **Event JSON-LD emitted for every event, not just reviewed ones.** The node was gated on the event having reviews, so an event emitted no structured data until somebody reviewed it | ✅ Fire Storm now emits a full Event node |
| [#422](https://github.com/bulletbiter99/air-action-sports/pull/422) | **`og-image.jpg` created** (referenced 18×, did not exist — every social share of every page had no preview) **+ sitemap generated from D1** | ✅ `image/jpeg`; sitemap 15→20 URLs, all 5 events with real `lastmod` |
| [#423](https://github.com/bulletbiter99/air-action-sports/pull/423) | **Orphaned surfaces given a door** — `AdminEventStaffing` was never routed while two cron sweeps emailed staff about it; the kiosk had no entry point | — |
| [#424](https://github.com/bulletbiter99/air-action-sports/pull/424) | **Empty states stopped pointing at nothing** — `/events` blamed the user's filters when nothing was scheduled; the floating Book pill advertised a dead end on every page | ✅ against live zero-event state |
| [#425](https://github.com/bulletbiter99/air-action-sports/pull/425) | **Home site cards driven by the sites API** — the hardcoded mirror had drifted 4 ways | ✅ 4 cards, correct badges |

### ⚠️ Production changed underneath this session

The operator edited D1 mid-session, and a handoff written from earlier reads would have been wrong on both counts:

- **A 4th site was added** — "The Chem Plant" (`site_1qwerWhCEME3`, `coming-soon`, public). The homepage did not show it until #425.
- **Foxtrot was flipped to `badge='open'`.** The homepage still said "Coming Soon" until #425.

**Always re-read `/api/sites` and `/api/events` live rather than trusting any doc, including this one.**

### What the dead-link sweep actually found

504 targets checked, 37 findings, **12 refuted as false positives by the adversarial pass**. The headline is that **all 76 unique literal internal link targets in `src/` resolve** — sidebar config, vendor portal, CSS backgrounds, all 12 event image URLs, all 11 R2 uploads are clean. The real problems were elsewhere, and **four systemic causes matter more than the individual links**:

1. **Soft-404s.** The worker serves the SPA shell at HTTP 200 for every unmatched path — so a dead link, a missing image, and a working page are byte-indistinguishable to any status check, monitor, crawler or CI job. `/images/foxtrot.jpg` returns `200 text/html`. **Nothing can 404, so nothing can be detected.** Not yet fixed.
2. **The 404 page destroys its own evidence** — `NotFound.jsx` auto-redirects to `/` after 10s, so a user cannot read or screenshot the URL that failed. Not yet fixed.
3. **No link checking in CI.** There is a real-schema guard compiling every SQL literal, but nothing asserts a route exists. Partially addressed: `tests/unit/admin/noOrphanedPages.test.js` now catches unrouted admin pages.
4. **Hand-maintained SEO config.** Fixed for the sitemap (#422); the pattern may recur elsewhere.

**Still open from the sweep** (none shipped): the portal sign-out lands on an error page after a *successful* logout; `Ticket.jsx` prints a waiver URL with the token truncated to 8 chars; 8 admin deep-links silently drop their query params (root cause: `src/hooks/useFilterState.js` — written to make URLs the source of truth — has **zero importers**); three CSV export buttons navigate via `window.location.href` and dead-end; `/gallery` and `/event/walkup` have no inbound link.

### Growth-plan status — what is and is not done

The re-verification produced **28 batches**. Shipped this session: the archive/OG fix, JSON-LD un-gate, og-image, sitemap, and parts of the content-truth pass. **NOT started:**

- **Phase 1 content truth (most of it).** `faq.js` is still largely fabricated: it promises **gear hire at all sites** (production has `rental_items = 0`), says **"all three of our sites"** (there are now 4), states **350/500 FPS** against the ROE's canonical 350/450/450/550, sets **milsim at 18+** when both July ops sold to 12+, and is written in British English throughout. The About page invents three staff members under its own `PLACEHOLDER` comment and claims 1,000 players against a real 91. Home's hero still claims **"5+ Battle Sites / 2k+ Players Deployed / 50+ Events Run"** against 4 sites / 91 attendees / 5 events.
- **Phase 2 remainder** — `offers` node, structured `PostalAddress`, LocalBusiness enrichment (it currently emits only name/description/url/rating — no address, telephone, logo, `sameAs`), per-route meta map, real 404 status, llms.txt, IndexNow.
- **Phase 3 measurement** — zero analytics exist. `siteConfig.ga4Id` is a dead `G-XXXXXXXXXX` placeholder nothing reads. There is **no CSP**, so a beacon is unblocked (the `withSecurityHeaders` comment deferring CSP pending "the Peek widget" is stale — Peek is gone from `index.html`).
- **Phase 4 lifecycle** — all of it. Note the marketing engine no-ops without `MARKETING_POSTAL_ADDRESS`.
- **A missing batch the plan dropped: all-in pricing.** Ticket prices display bare with mandatory tax + fees appearing only at the summary line. The plan's own research flags this as an **FTC Junk Fees Rule requirement for live-event tickets**. Worth treating as compliance, not conversion.

### Corrections to the plan — do NOT re-derive these

1. **`eventStatus` must stay `EventScheduled` for past events.** `schema.org/EventStatusType` has exactly five members and none mean "completed". A batch proposed changing it; that would emit an unrecognized enum. Signal pastness via `startDate`/`offers.availability`.
2. **Do NOT "fix" the JSON-LD `startDate` timezone.** The naive-local datetime is a *recorded decision* (`reviewAggregates.js`) — a wrong DST offset is worse than none. It resembles the `date_iso` bug family but is not one.
3. **Do NOT pass a raw D1 row to `salesClosedError`.** It reads `event.salesCloseAt` (camelCase); a raw row has `sales_close_at`, so the cutoff check would silently pass for everything.
4. **Migration-then-code ordering is not optional here.** Merging auto-deploys via Workers Builds while the operator applies migrations manually, so a PR containing both ships code that reads columns which do not exist yet. Split into two PRs.
5. **A `KNOWN_ROUTES` allow-list for real 404s is a maintenance landmine** — every future public page would silently become uncrawlable. Derive from the route table instead.
6. The plan's claim that reviews are zero is stale; and **`{{waiverLink}}` is NOT broken** — a critique claimed it, but the template uses `waiver_link`, which has three real producers. Verified.

### Durable lessons

1. **A test can pass vacuously and look green.** `FloatingBookPill.test.jsx` first used `response:` where `tests/helpers/mockClientFetch.js` expects **`body:`**. The mock returned `undefined`, the events list was always `[]`, and both *assert-absence* tests **passed with the component absent for entirely the wrong reason** — only the *assert-presence* tests failed and exposed it. Every guard shipped this session was then **proven by mutation** (break the code, watch the test fail, restore).
2. **`useEvents` caches per key at MODULE level.** Without `clearEventsCache()` in `beforeEach`, the first test's fixture satisfies every later test in the file.
3. **A test whose regex still matches after a contract change is worse than a failing one.** #418 changed a SQL predicate that `rewriteEventOg.test.js` asserted with `/published\s*=\s*1/` — which matches `(published = 1 OR past = 1)` perfectly well, so it would have rubber-stamped the change while its stated intent became false. Assert the full shape.
4. **The gate map can be incomplete.** `tests/unit/worker/reviewJsonLd.test.js` pins `worker/index.js` behavior and was **not registered** for it — following the map literally would have missed it, the same failure mode as the Group H backfill in #391. Both it and `sitemap.test.js` are now registered.
5. **`git add -A` stages `marketing/`**, which is deliberately never committed. Stage by explicit path.
6. **The `admin-taxes-fees-populated` baseline is secretly a homepage capture** (known mislabel) — a Home change shifts it while `admin-events` does not. Useful signal, still worth fixing someday.
7. **Deleting a fabrication beats correcting it.** Both `testimonials.js` and `locations.js` were deleted rather than fixed: a hardcoded mirror of operator-editable data regenerates the drift, and a curated fallback array is a fabrication with a delay fuse — one moderation hide re-renders invented content in place of real content.

## ✅ DONE — timezone follow-ups + 0080 apply (2026-07-28, third session — PRs #412–#416)

The operator authorized the 0080 apply and asked to complete the two follow-ups from the `date_iso` timezone series. Both are **closed**:

| PR | What |
|---|---|
| — | **Migration 0080 APPLIED to remote** (operator-authorized). Verified: `sua_seed_v1_placeholder` active, and `body_sha256` independently recomputed from the body **as stored in production** — it matches, so agreement-signature integrity holds. `kind=agreement` uploads no longer 409. The placeholder still needs attorney-approved text before a real renter signs ([runbooks/sua-template.md](runbooks/sua-template.md)). |
| [#412](https://github.com/bulletbiter99/air-action-sports/pull/412) | **`main` was red — permanently, since 03:00 Mountain that morning.** The FOURTH clock-fixture rot (#291 → #393 → the Sprint-3 fix → this): `reviewInvites.test.js`'s send-path tests passed the real `Date.now()` while the candidate anchor was derived from the pinned `NOW`, so the anchor aged out of the 18-48h window at `NOW+48h` and nine tests failed with `considered: 0`. Not a daily flake — a rot with an expiry date. Every sweep invocation now pins `now: NOW`; the file-top comment names the rule. |
| [#413](https://github.com/bulletbiter99/air-action-sports/pull/413) | **Follow-up 1 — event conflict windows narrowed to real start→end times.** New `eventOccupancyWindow` in `worker/lib/eventConflicts.js`: an event occupies its real span when `end_date_iso` carries a TIME component, else the whole Denver day (byte-identical to before). **Opt-in by design** — narrowing on absent data would guess occupancy, and a wrong guess is a silent double-booking. A **date-only** end must NOT narrow (`eventInstantMs` reads it as midnight → would drop the span's whole last day; pinned). No public rendering change: `isMultiDay` keys off a LATER calendar day, so a same-day end is invisible publicly. The admin form's end-date helper now names all three outcomes (later day / same day / blank). No migration. |
| [#414](https://github.com/bulletbiter99/air-action-sports/pull/414) | **Follow-up 2, part 1 — period WINDOWS onto the Denver calendar.** `resolvePeriodWindow` (mtd/qtd/ytd), `parseCustomBounds` (the operator's date pickers), analytics `?period=mtd`. New business-calendar helpers in `worker/lib/eventTime.js` (worker-only; the src mirror deliberately untouched): `denverMonthKey`, `denverDayStartMs`, `denverAddDays`, `denverDayStartFor`, `denverWeekStartMs`, `denverMonthStartMs/QuarterStartMs/YearStartMs`. |
| [#415](https://github.com/bulletbiter99/air-action-sports/pull/415) | Docs — un-parked `business-calendar-utc-skew.md` (since updated again at close: **CLOSED**). |
| [#416](https://github.com/bulletbiter99/air-action-sports/pull/416) | **Follow-up 2, part 2 — the BUCKETS.** The nine `strftime('%Y-%m')` month buckets → raw fetch + pure `rollupByDenverMonth` (compute helpers byte-untouched); the scorecard re-anchored to DENVER Mondays (the `CAST(/604800000)` week index cannot express variable-length DST weeks); the cash-flow horizon + its budget day-walk (a fixed-ms walk takes EIGHT steps through the 25h fall-back week — double-allocates a day; pinned). |

**Measured before changing the basis (read-only vs production): ZERO figures move.** All 83 payments keep their buckets; the nearest payment to a reattribution band is 6.17h clear. A property of the current dataset, not of the change.

**Durable from this session:**
1. **The clock-fixture rule, fourth occurrence:** a relative window asserted against a fixed date always has an expiry. If a file pins `NOW`, every time-dependent invocation must use `NOW` — mixing in `Date.now()` re-arms the bomb.
2. **`Number(null) === 0`** (M5.5 lesson #7) struck again in fresh authoring — `rollupByDenverMonth` filed NULL timestamps into `1969-12` until the nullish-check moved before `Number()`. The test caught it.
3. **Never cross a calendar boundary by adding fixed ms** — DST days are 23/25h, DST weeks 6d23h/7d1h. Calendar-step on Denver date parts (`denverAddDays`), then resolve back. Three distinct pinned failure shapes: duplicated Monday, 8-step week walk, off-by-an-hour custom-range end.
4. The remaining adjacent item (deliberately out of scope): **daily** sales-series buckets still bucket on UTC days — noted in `business-calendar-utc-skew.md`.

## ✅ DONE — Admin-audit SPRINT 4 (2026-07-28, PRs #403–#411, migration 0080)

Nine PRs (8 feature + this docs sync). The operator chose the **maximal** variant everywhere a question was asked: the full archive contract including the Critical-DNT checkout gates, SUA seed AND runbook, recurrence UI AND runbook, persona dropdown AND dormancy doc.

| PR | What |
|---|---|
| [#403](https://github.com/bulletbiter99/air-action-sports/pull/403) | **Stale-copy sweep** — the public privacy policy named THREE processors the site doesn't use (Google Analytics, Formspree, Mailchimp → now Stripe/Resend/Cloudflare); AdminSegments batch jargon; FilterBar "(coming in M3+)" |
| [#404](https://github.com/bulletbiter99/air-action-sports/pull/404) | **C1 archive contract** — archived (`past=1`) events visible on /games + detail regardless of `published` (they could NEVER appear before — every end-of-life action unpublishes); `/quote` + `/checkout` 409 on `past=1` OR a passed `sales_close_at` (Critical-DNT additive; Groups A/B byte-green); AdminEvents gets an "Online sales close" field (empty = no cutoff — the form sends explicitly so the server's start−2h default can't silently kill gate-time phone sales); EventDetail/Booking render honest closed states |
| [#405](https://github.com/bulletbiter99/air-action-sports/pull/405) | **C8 pending-card lifecycle** — payment link recoverable from booking detail (retrieveSession); `POST /:id/cancel` for pending/abandoned that **expires the Stripe session first** (else webhook redelivery resurrects the booking — the 2026-06-03 lesson); reschedule target capacity check + past-target 409 + modal filters to bookable events |
| [#406](https://github.com/bulletbiter99/air-action-sports/pull/406) | **C9 labor completion** — the PUT edit the file header always advertised (approval_required RECOMPUTED from the new amount), reject with required reason (rejected_at had no writer since 0036), tax-year lock enforced on approve/reject/mark-paid/edit per 0036's own comment |
| [#407](https://github.com/bulletbiter99/air-action-sports/pull/407) | **1099 tax-identity editor** (Sprint 2 tail) — PUT /:id/tax-identity writes 0078's columns at last; EIN normalized + stored ENCRYPTED, plaintext in no bind/audit/response; staff detail exposes legalName + einOnFile only |
| [#408](https://github.com/bulletbiter99/air-action-sports/pull/408) | **B5 SUA seed** — migration **0080** seeds a PLACEHOLDER site-use agreement (NOT-ATTORNEY-REVIEWED banner) so `kind=agreement` uploads stop 409ing at a phantom page; [docs/runbooks/sua-template.md](runbooks/sua-template.md) is the management story (immutable versions; body_sha256 = sha256(body) exactly, pinned by a real-schema data test) |
| [#409](https://github.com/bulletbiter99/air-action-sports/pull/409) | **B4 recurrences** — `/api/admin/field-rental-recurrences` (create/pause/resume/end; the 0049 caps finally have a consumer) + series card on rental detail + [docs/runbooks/field-rental-recurrences.md](runbooks/field-rental-recurrences.md). **Resume never backfills the paused gap** (sentinel bumps to yesterday); **end cancels only future cancellable instances**, never paid ones |
| [#410](https://github.com/bulletbiter99/air-action-sports/pull/410) | **Persona dropdown** — PUT /users/:id accepts `persona` (D08 enum); a "Login Accounts & Dashboard Personas" section on Settings — also the first login-accounts read surface since AdminUsers was decommissioned in M5 R17. `admin-settings` baseline recaptured |
| [#411](https://github.com/bulletbiter99/air-action-sports/pull/411) | This docs sync |

### ~~⚠️ NEW operator action — apply migration 0080~~ — ✅ APPLIED 2026-07-28 (later session, operator-authorized)

Applied + verified same day: the seeded row is active and `body_sha256` was independently recomputed from the body as stored in production (match — signature integrity holds). Agreement uploads no longer 409. What survives of this item: **replace the placeholder with attorney-approved text** per [docs/runbooks/sua-template.md](runbooks/sua-template.md) before a real renter signs it.

### Sprint 4 corrections + parked items

- **The audit's stale-copy list was half done already**: "Coming in M5" tiles were removed in #254 and "(B7b)" fixed in #397. The live rot was the privacy policy naming **three** unused processors (not just Mailchimp).
- **C8's "reschedule offers unpublished targets"**: the server already rejected unpublished targets (#284) — the modal *offering* them was the remaining half. Capacity was the real server gap.
- **C9 was worse than written**: the route header advertised a PUT that never existed.
- **Parked with reasons**: `w2_salary` CHECK-widening (dead SQL documented at both sites; needs an actual salaried person + a D1 table rebuild — 0 labor rows today); custom-dates recurrence creation (SQL recipe in the runbook); role/active editing for login accounts (API-only; persona is the one Settings write because it's a lens, not access).

### Durable lessons (Sprint 4)

1. **The mockD1 first-handler-wins trap fired again** in test authoring (a `beforeEach` person-bind silently beat an in-test null re-bind) — the fix is a per-test `bindPerson()` helper, pattern now pinned in `tax-identity.test.js` with the lesson cited inline.
2. **A capability seeded with no consumer is a tripwire worth grepping for** — `field_rentals.recurrence_*` (0049) and the D08 persona column (0028) both sat unconsumed for months; both audits' "unreachable feature" findings started exactly there.
3. **Enforcing a previously-phantom field changes the safe default.** `sales_close_at` defaulted to start−2h when nothing read it; with enforcement, that default would have silently killed day-of phone purchases at the gate. The admin form now sends the value explicitly (empty = null = no cutoff) so only operator-typed cutoffs enforce.
4. **Cancel without killing the Stripe session is not cancel** — a webhook redelivery re-pays any non-`paid` booking, so the C8 cancel expires the Checkout session before flipping status (new additive `expireCheckoutSession` helper).
5. **Resume-a-paused-series semantics need a decision**: the generation cron reads `generated_through + 1`, so naive resume retro-generates the paused gap (including past dates). Resume bumps the sentinel to yesterday; documented in the runbook + pinned by a test.

## ✅ DONE — Admin-audit SPRINT 3 (2026-07-28, PRs #393–#400)

Eight PRs. **No migrations** — every column these features needed already existed, which is itself the theme: most of Sprint 3 was wiring up things the schema and the server had been ready for since M5.

| PR | What |
|---|---|
| [#393](https://github.com/bulletbiter99/air-action-sports/pull/393) | **`main` was red.** A clock-flaky test — see below. |
| [#394](https://github.com/bulletbiter99/air-action-sports/pull/394) | **A latent production landmine** in the nightly customer-tag sweep — see below. |
| [#395](https://github.com/bulletbiter99/air-action-sports/pull/395) | **C3** customer edit + marketing-consent write path + manual tags |
| [#396](https://github.com/bulletbiter99/air-action-sports/pull/396) | **C7** surface `unpaid`/`abandoned` + record an out-of-band payment received |
| [#397](https://github.com/bulletbiter99/air-action-sports/pull/397) | **C2** field-rental lead triage (edit + reschedule) + 3 adjacent defects |
| [#398](https://github.com/bulletbiter99/air-action-sports/pull/398) | **C4** dormant marketing pipeline made visible and recoverable |
| [#399](https://github.com/bulletbiter99/air-action-sports/pull/399) | **B7** staff archive / cert revoke+edit+renew / doc retire wired to the UI |
| [#400](https://github.com/bulletbiter99/air-action-sports/pull/400) | **C6** admin incidents — file **and** resolve |

### The two bugs found along the way

**`main` was red on arrival, six hours a day.** `resend-review-invite.test.js` derived its fixture dates in UTC while #392 had correctly moved `eventHasEnded` onto the Denver calendar. Between 18:00 and 24:00 Mountain, UTC-yesterday *is* Denver-today, so the strict `<` collapsed and every happy path 409'd. Green on CI at merge (morning), red the same evening. **This is the UTC-vs-Mountain trap from the previous session landing inside the fix for it** — worth expecting again in any fixture that derives a date.

**A latent landmine in the nightly tag sweep.** `customer_tags` has `PRIMARY KEY (customer_id, tag)` with `tag_type` **outside** the key; the sweep INSERTed system tags bare, in one atomic `db.batch()`, and `worker/index.js` only `.catch()`es it to `console.error`. So one manual tag named `vip` would have rolled back the whole batch and **silently frozen system-tag refresh for every customer, indefinitely**. It arms itself on a delay — the system tags are conditional, so a manual `vip` on a $40 customer collides with nothing until their lifetime value crosses $500. Unreachable only because nothing wrote manual tags; **C3's UI is what would have armed it**, so it was fixed first and separately (`INSERT OR IGNORE` + an exported `SYSTEM_TAG_NAMES` the write path reserves).

### Operator-facing changes worth knowing

- **A phone opt-out can finally be honoured.** Production was **79 of 79** customers `email_marketing=1` — nobody had ever opted out, because only the customer's own emailed unsubscribe link could write it. Opting *out* is a plain toggle; opting back **in** requires a typed reason (it overrides the customer's own decision, and `email_marketing = 0` is the only persisted trace an unsubscribe happened), and is **refused outright** for an address that hard-bounced or filed a spam complaint.
- **`unpaid` / `abandoned` bookings are visible for the first time** (10 abandoned rows existed with no way to list them), and **"Record payment received"** now exists — the flow the Stripe-cutover invoices needed by hand in June. It only accepts an already-**provisioned** booking; a `pending`/`abandoned` one has no attendees, so marking it paid would mint a ticketless ghost.
- **Marketing can no longer strand a campaign.** Sending while `MARKETING_POSTAL_ADDRESS` is unset used to leave it in `sending` forever with no exit. Send-now is now refused with a banner naming what's missing; scheduling still works; `sending → canceled` recovers anything already stuck.

### Corrections to the audit (verified in source)

- **B7 is wrong twice.** `/archive` exists but there is **no `/unarchive`** — archiving was one-way, so #399 shipped the mirror rather than putting an unrecoverable button on the page. And `AdminStaffCertEditor` already implemented `edit`/`renew` in full — nothing ever *passed* those modes.
- **C2's "refunded status rejected with jargon"**: `allowedNextStatuses` is a faithful mirror of the server's `STATUS_TRANSITIONS` map, which *does* include `refunded`; the route special-cases it earlier. The mirror stayed; a separate `selectableNextStatuses` answers what to *offer*.

### Deliberately deferred, with reasons

- **C4's test-send, per-recipient delivery view, and the segment "Last count" cache.** None can be exercised until the operator lands the marketing env vars, and no test-send path exists anywhere to reuse — a feature, not a fix.
- **B7's staff-document role-tagging.** Needs a roles-catalogue picker and a per-document tag list; a feature rather than a button.

## 🎯 START HERE — what's left

Ordered by value. The 2026-07-31 section above has the detail behind each.

1. **The content-truth pass (Phase 1).** The highest-value remaining code work, and it is now *urgent* rather than cosmetic: #418/#421 made event pages and structured data crawler-visible, so the fabricated copy in `faq.js` and `About.jsx` is exactly what search engines and (once unblocked) AI assistants will quote. Shipping machine-readable markup over false copy amplifies the falsehood. **Most of it needs no new facts** — deleting an invented claim requires nothing; only *replacing* it does. Start with the deletions.
2. **Phase 2 remainder** — the `offers` node, `PostalAddress`, and LocalBusiness enrichment. That node currently carries only name/description/url/rating: **no address, telephone, logo or `sameAs`**, which for a local business is the single biggest structured-data gap. Google also treats `image` as required for rich-result eligibility, and it is never emitted — so the genuine 4.7★ rating probably cannot render as a snippet today.
3. **All-in pricing** — a batch the growth plan dropped without comment. The FTC Junk Fees Rule applies to live-event tickets, so treat it as compliance.
4. **Phase 3 measurement.** Nothing can be evaluated without it, and there is no CSP blocking a beacon. Cheap and unblocked apart from the operator creating the Cloudflare Web Analytics site.
5. **The remaining dead links** — portal sign-out error, truncated ticket waiver URL, 8 param-dropping admin deep-links, 3 dead-end CSV buttons. Plus the two systemic ones: **real 404 statuses** (derive from the route table, NOT an allow-list — see correction #5 above) and the 404 page's 10-second self-erasing redirect.
6. **The kiosk decision** (audit D4). It now has an entry point (#423) but is still documented as dead end-to-end and has never had a session. An entry point made it reachable and testable; it did not certify it. Repair or retire.
7. **Phase 4 lifecycle** — blocked in practice on `MARKETING_POSTAL_ADDRESS`; the transactional abandoned-booking recovery is the one piece that is not.

## ⚠️ Operator-pending

### New, from the 2026-07-31 session

0. **⭐ Flip the Cloudflare AI-crawler setting** — see the gate section at the top. Decided but unconfirmed; this is the highest-leverage item on the list and no code can substitute for it.
1. **Replace `public/images/og-image.jpg` with a purpose-made 1200×630.** The file now exists (it did not before, while being referenced 18×), but it is `gallery-ghost-town-1.jpg` at 1777×1209 / 1.47:1, so platforms centre-crop ~139px off top and bottom. Dropping a proper 1.91:1 image at the same path needs **no code change**.
2. **Apply `scripts/rename-echo-urban-blurb.sql`.** The sites row still reads `location_blurb = 'CQB Site — Echo Urban Warehouse'`, so "Echo Urban" — a venue that has never existed — still renders as the card subtitle on `/` and `/locations`. It is the last place that name survives. Script has before/after verification and a rollback.
3. **Decide whether to publish an event.** All 5 are `published=0, past=1`, so `/api/events` returns `[]` and nothing is bookable. Six of the growth plan's 28 batches improve a checkout path that currently 409s for every event — their revenue contribution is exactly zero until something is on sale. The empty states now degrade honestly (#424), so this is a business decision, not a bug.

### Carried forward (unchanged by this session)

4. **SUA attorney review** — migration 0080 is applied and the agreement flow works, but the seeded agreement is a placeholder with a NOT-ATTORNEY-REVIEWED banner. Replace it with counsel-approved text per [docs/runbooks/sua-template.md](runbooks/sua-template.md) **before a real renter signs** (retire v1 + insert v2 — versions are immutable; never UPDATE a live row's body).
5. **Resend plan upgrade** — now evidenced, not theoretical. The 2026-07-26 review-invite run logged `considered:23 sent:13 failed:10` with `alarm:false`; 10 sends were 429'd. Batch pacing (shipped in #392) mitigates it, but the plan limit is the root cause. Also still needed for Marketing send, along with `MARKETING_POSTAL_ADDRESS`.
6. **`RESEND_WEBHOOK_SECRET` + the Resend dashboard webhook** → `https://airactionsport.com/api/webhooks/resend` (subscribe `email.bounced` + `email.complained`). Feeds bounce/complaint tracking *and* review-invite suppression.
7. **`audit_log_fts` flag flip** — `UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';` Until then audit search uses the LIKE fallback.

## ✅ DONE — the whole date_iso timezone family (2026-07-27, PRs #391 + #392)

`events.date_iso` / `end_date_iso` store **naive America/Denver wall clock, no offset** (`2026-07-25T08:30:00`, always 19 chars — the admin `datetime-local` input plus a literal `:00`). SQLite `unixepoch()` and JS `Date.parse()` in a Worker both read a naked datetime as **UTC**, so anything deriving an instant from it was 6h (MDT) / 7h (MST) early.

**`worker/lib/eventTime.js` is now the canonical resolver**, with a client mirror at `src/utils/eventTime.js` (dual-target tested — do NOT import `worker/` from `src/`). Use it for any new `date_iso` consumer:

| Function | Use |
|---|---|
| `eventInstantMs(dateIso)` | naive Denver string → true epoch ms (null if malformed) |
| `denverDateFor(ms)` | instant → the Denver calendar date; use instead of `date('now')` / `toISOString().slice(0,10)` |
| `denverWallClockWindow(a, b)` | instant window → wall-clock bounds for `date_iso BETWEEN ? AND ?` |
| `eventStartsWithin(iso, a, b)` | exact instant membership test |
| `toDenverWallClock(ms)` | instant → the stored 19-char shape |

*(Since 2026-07-28 the same file also carries the BUSINESS-CALENDAR helpers — `denverMonthKey`, `denverDayStartMs`, `denverAddDays`, `denverDayStartFor`, `denverWeekStartMs`, `denverMonthStartMs`/`QuarterStartMs`/`YearStartMs` — used by every financial window + bucket. Worker-only; not mirrored to `src/utils`.)*

**#391 — the reminder cron.** 18 Last Light customers got "T-MINUS 1 HOUR" at 1:20 AM on event day with `Check-in: 8:00 AM` in the same email, and the sentinel stamp then suppressed the real send. Two-stage filter now: wall-clock bounds in SQL (exact off a DST transition), exact instant re-check in JS.

**#392 — the other ~30 sites**, in five commits: public countdown + `/games` "Invalid Date"; admin "today" (`/today/active` going blind from 6 PM Mountain, deferred revenue, site archive guard); review invites + the resend gate; the conflict engine; and the staffing/vendor/`sales_close_at` tail.

### Four traps this cost real effort to establish — don't re-derive them

1. **`unixepoch(x,'utc')` / `,'localtime'` is a NO-OP in D1 and fails SILENTLY.** SQLite's modifiers read the host process TZ; a Worker's host is UTC. Verified against production — bare, `'utc'` and `'localtime'` all return the identical integer in both January and July. It is the single most likely way to "fix" this and ship it still broken.
2. **A hardcoded `-06:00` is wrong ~4 months a year.** The 6h skew was 6h only because July is MDT.
3. **Widening a range guarded by a `LIMIT` is not a free safety margin.** An adversarial review caught a high-severity regression *introduced by the fix*: padding the window plus an `ORDER BY date_iso` front-loaded the `LIMIT` with already-closed rows whose sentinel was still NULL (reachable via send-failure rollback, big-event overflow, and admin reschedule), starving the rows actually due into a silent no-op sweep. The bounds are exact off-transition for this reason.
4. **A naive-ISO string in a test fixture is ambient-TZ-dependent.** `Date.parse('2026-11-07T18:00:00')` resolves in the *runner's* zone — so it passes on a Mountain dev machine and fails on the UTC CI runner by exactly the offset. It caught out this very PR. Run `TZ=UTC npx vitest run` to reproduce CI.

### Second failure mode, easy to miss

Besides naive-string-as-instant, there is a **UTC-"today" vs Mountain-date** mode: a *correct* date-portion extract (`date(date_iso)`, `substr(...,1,10)`) compared against `date('now')` or `toISOString().slice(0,10)`. Both sides are dates, so it reads as safe — but it is wrong for the six-hour band 18:00–24:00 Mountain **every day**, self-correcting at local midnight so it presents as flaky rather than broken. Several files carried comments asserting it was fine.

### Deliberately NOT fixed

- **`eventDaySession.js:102`** — offset-wrong, but the 30h pad absorbs it for every real event shape and the kiosk is dead end-to-end (audit A1). Changing an auth window nobody exercises is more risk than the bug. *(Still true.)*
- **`sales_close_at` enforcement** — the math is fixed; wiring it to checkout is a Critical DNT change needing its own conversation. → *since ENFORCED in Sprint 4 #404 (the C1 archive contract).*
- **The business-calendar skew** — parked at the time. → *since CLOSED 2026-07-28 (#414 + #416; see the top of this file).*
- **Skew that genuinely cancels** — span validations parsing BOTH endpoints naively (`events.js:282`, `AdminEvents.jsx:332`), and client `new Date(naive)` → `toLocaleDateString()`, which is an exact round-trip and correct in every timezone. Don't "fix" these.


## ✅ DONE — Sprint 2: broken-wiring fixes + a real-schema guard (2026-07-25, PRs #383–#389)

**7 PRs merged.** `main` **`b6b26a1`** · tests **3198 → 3236 / 284** · lint 0 errors · build clean · migrations 0078 + 0079 shipped in-repo that session and were **applied 2026-07-27** (they read as OPERATOR-PENDING below because that section is preserved as written).

All six Sprint 2 items from [docs/admin-workflow-audit-2026-07.md](admin-workflow-audit-2026-07.md) were re-verified against current `main` first (the audit was written at `def6848`, before #379 landed 52 files) — **all six confirmed**, with three material corrections, plus production row counts that reframed two of them.

| PR | What |
|---|---|
| [#383](https://github.com/bulletbiter99/air-action-sports/pull/383) | **Real-schema guard** (the audit's meta-fix) + the 5 bugs it caught on first run |
| [#384](https://github.com/bulletbiter99/air-action-sports/pull/384) | check-in/check-out read `attendees.event_id`, a column that never existed → join `bookings` |
| [#385](https://github.com/bulletbiter99/air-action-sports/pull/385) | **A4** CronHealth read 3 field names that exist nowhere in the repo |
| [#386](https://github.com/bulletbiter99/air-action-sports/pull/386) | **A6** event duplicate named 31 of 40 columns → derive the carry set from the source row |
| [#387](https://github.com/bulletbiter99/air-action-sports/pull/387) | **B3** Venue picker → conflict detection is reachable for the first time |
| [#388](https://github.com/bulletbiter99/air-action-sports/pull/388) | **A2** migration **0078** — `persons.legal_name` + `ein_ciphertext`; 1099 surface unbroken |
| [#389](https://github.com/bulletbiter99/air-action-sports/pull/389) | **A3** migration **0079** — stop emailing a payment link that goes nowhere |

### ⭐ The headline finding — TRUE STRIPE FEE CAPTURE HAS NEVER WORKED

Building the schema guard immediately surfaced **four bugs the audit never found**, one of them serious:

`worker/lib/stripeFeeSync.js` ran `UPDATE bookings SET … updated_at = ?`. **`bookings` has no `updated_at` column** (it's `created_at`/`paid_at`-stamped only), and the per-row `catch` swallowed the throw — every candidate silently counted as "failed". Verified against production: **74 paid/refunded bookings, 0 with `stripe_fee_cents`.** So the nightly `runStripeFeeSync` cron has captured *nothing* since it shipped 2026-06-24, and the "Stripe fees & true net" report (#328) plus the refund-side reconciliation (#335) have never had data. Fixed in #383 — **the next 03:00 UTC run will begin backfilling** (LIMIT 50/night, so ~2 nights for the current 74).

The other three: the Bookkeeper **A/R aging + DSO** report (#330) 500s on every request (`c.full_name`; the column is `name`); `rental_items.qr_token` in the equipment-return scan; and `attendees.event_id` in both check-in handlers (#384).

### The guard itself

`tests/helpers/realSchema.js` applies all 78 `migrations/*.sql` into an in-memory SQLite (`better-sqlite3`, pinned `^12` — v13 needs Node 22 and CI pins 20). `tests/unit/schema/workerSql.test.js` extracts **every static SQL literal in `worker/`** (717 today) and `prepare()`s each — SQLite resolves column names at prepare time, so a missing column throws with zero fixture rows. Runs in the existing CI `test` job in ~0.1s.

**Why this class kept shipping:** `tests/helpers/mockD1.js` is a shape mock — it substring/regex-matches SQL and returns whatever fixture the test registered, never checking that the columns exist. `stripeFeeSync.test.js` passed before *and* after the fix.

Allowlist (each needs a written reason; the suite asserts allowlisted statements **still fail**, so fixing one forces removing its entry): only `laborEntries.js`'s deliberate forward-compat write remains.

**Known gaps:** only *static* SQL (~100 `${}`-interpolated statements are skipped), and only column existence — a statement can compile and still be semantically wrong.

### Corrections to the audit (verified in source)

- **A2**: `POST /lock-year` was never broken — it doesn't touch `persons`. Only the report, CSV and cron were dead. Separately the audit's **B7 is wrong**: compensation / mailing-address writes are *not* "built server-side with zero UI callers" — `PUT /api/admin/staff/:id` has an 8-column allow-list and those writes don't exist at all.
- **A3**: the intended pay landing was specified *inside the admin router* (`requireAuth` on `'*'`), so a customer clicking it would have gotten **401** even if built. Never architecturally viable.
- **A6**: two extra defects — the duplicate never called `instantiateChecklists`, and the client prompt default was the bare string `'(copy)'` (accepting it produced an event titled `(copy)` with id/slug `copy`).
- **B3**: the server *already* accepted `siteId`; the gap was purely client-side plus a missing `formatEvent` key.

### Production reality check (why A3/A2 were latent, not live)

`booking_charges` = **0** and `event_day_sessions` = **0** — the kiosk has never opened a session, so no damage charge has ever existed and the 404 link never reached a customer. `labor_entries` = **0** — the 1099 report renders empty even when fixed. `events` with `site_id` = **2 of 5** (3 active sites).

### ✅ DONE 2026-07-27 — the two migrations below were applied (kept for the verification recipe)

```bash
npx wrangler d1 migrations apply air-action-sports-db --remote
```

Applied **0078** (`persons.legal_name` + `ein_ciphertext`) and **0079** (rewrites the `additional_charge_notice` template to drop the dead `{{paymentLink}}`) — both confirmed on remote. The post-apply checks, for reference:

1. `GET /api/admin/1099-thresholds` → **200** with an empty `recipients` array (was 500).
2. Next 03:00 UTC `cron.swept` audit row no longer carries `meta_json.taxYearAutoLock.error`.
3. `/admin/email-templates` → `additional_charge_notice` shows no `{{paymentLink}}`.
4. **Watch `stripe_fee_cents` start populating** after the next two 03:00 UTC runs.

### Durable lessons

1. **Admin visual baselines can drift semantically while the check stays green.** `maxDiffPixelRatio: 0.01` means a single-tile text change (~0.2% of a 1440×906 full-page shot) never trips the compare — and `--update-snapshots` only rewrites a snapshot whose comparison *failed*, so a `capture-baselines` run legitimately reports "No baseline changes to commit". Small UI regressions need unit coverage; the visual suite won't catch them.
2. **Locally the admin visual suite reuses a running preview server** (`reuseExistingServer: !process.env.CI`) — i.e. a stale `dist/`. A real UI change will look like it had no effect. Use `CI=1` to force a fresh build.
3. **`npm install` on Windows prunes the top-level `@esbuild/linux-x64` lock entry**, which would break `vite build` on the ubuntu runners. Splice new packages into the lock at npm's own key positions instead of regenerating it.
4. **`npm run lint` reports 24 errors locally that CI never sees** — they're all in `static-backup/`, which is gitignored. Lint the tracked source (`npx eslint src worker tests scripts`) to reproduce CI.
5. **Retargeting a PR's base does not re-trigger CI** (`pull_request` fires on opened/synchronize/reopened, not edited). Close + reopen it.

### What's next

> ⚠️ **Written at the Sprint-3 close; both items below have since been resolved or reclassified.** Sprint 4 closed the same day (#403–#411) and the audit is fully done — see the top of this file.

~~Sprint 3~~ closed 2026-07-28. ~~**Sprint 4 (contracts & polish)**~~ also closed 2026-07-28; the whole of [docs/growth-plan-2026-07.md](growth-plan-2026-07.md) remains. Two items surfaced by that sprint were still open at the time of writing:

- ~~**The 1099 tax-identity editor.** 0078 adds the columns but there is still **no write path**~~ — ✅ **SHIPPED in #407**: `PUT /api/admin/staff/:id/tax-identity` writes `legal_name` + an **encrypted** `ein_ciphertext`, with the staff-detail editor on top.
- **`pay_kind = 'w2_salary'` is dead SQL** (`thresholds1099.js:154,209`). `labor_entries.pay_kind`'s CHECK (migration 0036) doesn't permit that value — it's a `persons.compensation_kind` value — so salaried W-2 totals silently return 0. **Needs a product decision**, and note the schema guard *cannot* catch this class (it compiles fine).

---

## ✅ DONE — Event-day readiness sprint + open-reads access model (2026-07-24 → 07-25, PRs #377–#381)

**This session closed the night before / morning of the July 25-26 events** (which have since run). Five PRs merged + deployed (prod Version **`fabeb661`**); `main` **`051ba98`** + this docs sync · tests **3198 / 279** · lint 0 errors · NO new migrations. Two big research artifacts also landed (see the roadmaps section below).

| PR | What |
|---|---|
| [#377](https://github.com/bulletbiter99/air-action-sports/pull/377) | **Two-event day + multi-day widget fixes** — `/today/active` returns an additive `events:[{id,title}]` (LIMIT 2→6; `eventId` contract unchanged); `/admin/today` renders one Roster/Check-in/Rentals tile group PER active event (was a link-less "ambiguous" card on exactly the July-25 shape); TodayEvents/TodayCheckIns widgets treat an event as "today" across its whole `endDateIso` span (Fire Storm's Sunday morning previously showed "No events today"); TodayEvents Scan link now carries `?event=`. |
| [#378](https://github.com/bulletbiter99/air-action-sports/pull/378) | **AdminScan event-day safeguards** — persistent "⚠ Payment due — booking is {status}" banner on the scanned-attendee card (by-qr already returned `booking.status`; the card ignored it) + a "Different event" banner + `window.confirm` gate on wrong-event check-ins (two events, same site, same day) + fixed the dead expected-event fetch (`GET /:id` doesn't exist → `/:id/detail`; "Scanning for:" never resolved). |
| [#379](https://github.com/bulletbiter99/air-action-sports/pull/379) | **OPEN-READS ACCESS MODEL** (operator-requested; 52 files). Every admin page is now VIEWABLE by any authenticated admin; every WRITE keeps its capability/role gate; field-level sensitive reads (bookings/staff PII masks, sensitive notes, EIN decrypt, compensation) preserved byte-identically. New greppable `requireReadAccess` middleware in `worker/lib/capabilities.js` (verifies auth + eagerly loads `user.capabilities` — the load downstream field-masks depend on). Deliberately still gated: `GET /users/invitations` (raw invite token = live credential), bulk exports (bookings CSV / `reports.export` / 1099), compensation-class reads (labor entries, 1099 thresholds). Reviews list opens but nulls reviewer email/ipHash for non-moderators. Sidebar/palette/page guards opened client-side; **Settings → Charges** nav entry added (the damage-charge queue was a hidden URL). Functionally a no-op for the 4 current owner-role admins. |
| [#380](https://github.com/bulletbiter99/air-action-sports/pull/380) | **Today-page walk-in "New Booking" tile** — 4th tile per event group → `/admin/new-booking?event=<id>`; AdminNewBooking preselects that event (falls back to first). Covers the walk-up flow the dead kiosk was meant to serve. Also fixed a latent double-fetch (`load()` identity depended on `eventId` → the mount effect ran twice; surfaced as a CI unhandled-rejection). |
| [#381](https://github.com/bulletbiter99/air-action-sports/pull/381) | **Sprint-1 completion** — (a) review-invite visibility: booking detail returns additive `reviewInvite.sentAt` + submitted `review{}`; new `POST /:id/resend-review-invite` (owner/manager; sentinel-disciplined like the sweep — stamp-before-send, restore-on-fail, reuses an existing token so previously-emailed links stay alive; 409s: not-paid/comp, event-not-ended [end_date_iso-aware], already-reviewed); "Review invite" status row + Send/Resend button on `/admin/bookings/:id`. (b) **Reschedule price-diff fix**: the move-booking modal read camelCase keys off snake_case line items → "They paid" always showed $0.00; now reads `unit_price_cents` (fixture corrected to the real stored shape + RTL pin). |

**Event-weekend notes for the NEXT session (post-July-26):**
- **Review invites fire the night of ~July 26** (18–48h after each event's end anchor). Check `/admin/bookings/:id` → "Review invite" row; manual (re)send button is live. ⚠️ `RESEND_WEBHOOK_SECRET` is still unset → suppression/bounce tracking inactive (operator-pending #2 below).
- **First real reviews** will wake the dormant reviews feature (SSR aggregateRating appears once count ≥ 1; homepage Avg-Rating stat at ≥1; testimonial swap at ≥3 with comments). Run the SSR acceptance gate in the reviews section below. — ✅ **THIS HAPPENED:** 3 reviews arrived 2026-07-25/26; the 1★ was operator-hidden 2026-07-27, so the public aggregate is **2 / 4.5★**.
- **When the operator archives the July events**, the archive dead-end applies (audit finding C1: `/games` requires `published=1` but end-of-life actions unpublish; `sales_close_at` is unenforced — an "archived" published event stays bookable by deep link). Decide the archive contract before archiving.
- The kiosk (`/event`) remains dead end-to-end (audit A1) — the admin path (Today → per-event Scan/Roster/New Booking) is the operational system and got hardened this session.

## 🗺️ NEW ROADMAPS — two research artifacts now in-repo (2026-07-24)

1. **[docs/growth-plan-2026-07.md](growth-plan-2026-07.md)** — conversion + LLM/AI-discoverability upgrade plan (10-agent audit+research workflow; all 22 high-impact claims code-verified). Headlines: the site is invisible to non-JS AI crawlers (Event JSON-LD is review-gated = zero today, no `offers` node); abandoned checkouts are silently swept warm leads; content contradictions (FAQ says milsim 18+ vs 12+ live events, fabricated About/testimonials/hero stats); zero analytics; the marketing engine is idle. 6 phases: operator quick wins → truth/funnel sprint → machine-readable site → measurement → lifecycle revenue → bigger bets. **Execution NOT started** (the admin-audit sprints took priority for event day).
2. **[docs/admin-workflow-audit-2026-07.md](admin-workflow-audit-2026-07.md)** — full admin operator-journey audit (9-agent workflow; all 23 high-impact claims confirmed). **Sprints 1–3 are all COMPLETE** — Sprint 1 (event-day readiness) #377/#378/#381 plus the open-reads model #379; Sprint 2 closed 2026-07-25 (#383–#389); Sprint 3 closed 2026-07-28 (#393–#400). ~~**Only Sprint 4 remains**~~ — **Sprint 4 also closed 2026-07-28 (#403–#411): the audit is FULLY DONE.** It shipped the archive contract + `sales_close_at` enforcement, recurrence API+UI, the SUA seed, the persona dropdown, and the stale-copy sweep.

---

## ✅ DONE — Follow-up fixes + close-out (2026-07-03)

Three small PRs closed out the week's threads, all merged + deployed (Version `58a2ef22`): **[#372](https://github.com/bulletbiter99/air-action-sports/pull/372)** fixed the chip-spawned side finding below (EventDetail "Other Operations" cards unstyled on direct `/events/:slug` loads — the card styles now ship in `event-detail.css`); **[#374](https://github.com/bulletbiter99/air-action-sports/pull/374)** normalized event-type casing in D1 (`scripts/normalize-event-type-casing.sql`) so badge tint variants match; **[#375](https://github.com/bulletbiter99/air-action-sports/pull/375)** constrained event type at the source (admin `<select>` + server normalize). `main` HEAD **`def6848`** · tests **3162 / 277** · 0 open PRs · all worktrees/branches cleaned.

---

## ✅ DONE — Public visual suite converted to route-mocked local-serve harness (2026-07-02)

The 2026-07-01 discovery below is **FIXED** ([#371](https://github.com/bulletbiter99/air-action-sports/pull/371), merged + all CI green): the public visual suite no longer screenshots live prod. New `playwright.public.config.js` (builds + serves dist/ locally, port 4174; pins `America/Denver`+`en-US`) + `tests/visual/publicMocks.js` (representative fixtures mirroring the real serializers — 2 events incl. a **multi-day** op, sites, reviews, taxes-fees; frozen browser clock so the home countdown is deterministic; unmocked `/api/*` 404s loudly). `playwright.config.js` is now smoke-only (`test:e2e` still targets live prod — deliberate). **9 baselines** (the 7 originals recaptured with real event content + NEW `event-detail-multiday.png` + `reviews-page.png`) — event content is pixel-locked in CI for the first time. Consequences: baselines are deterministic (recapture any time via the `capture-baselines` label; "recapture AFTER deploy" is obsolete), and prod rendering is covered by the smoke suite + post-deploy browser checks, not visual CI. Full record: CLAUDE.md 2026-07-02 session + `docs/runbooks/visual-regression.md` ("Public harness (2026-07-02)"). **Side finding (chip spawned):** EventDetail's "Other Operations" cards use `.event-card`, defined only in chunk-scoped `home.css`/`events.css`/`booking.css` → unstyled on direct `/events/:slug` loads (the PR #293 chunk-CSS pattern). ✅ **FIXED by [#372](https://github.com/bulletbiter99/air-action-sports/pull/372) (2026-07-03)** — the card styles now ship in `event-detail.css`.

---

## ✅ DONE — Operation Fire Storm build → night-only rebuild + /safety briefing (2026-07-01)

Two waves. **Wave 1** ([#363](https://github.com/bulletbiter99/air-action-sports/pull/363) + [#365](https://github.com/bulletbiter99/air-action-sports/pull/365) + [#366](https://github.com/bulletbiter99/air-action-sports/pull/366)): the three planning docs (`operation fire storm`, `operations for july 25-26`, `safety briefing`) built the draft `ghost-town-18hr-milsim` into **Operation Fire Storm** + published the **`/safety`** briefing page (+ footer/sitemap; linked from the event's Required Documents) + aligned the pyro wording site-wide (categorical no-pyro; `faq.js` + `/safety`) + set the price to **$80**. **Wave 2** ([#367](https://github.com/bulletbiter99/air-action-sports/pull/367), Version `898e9324`): the operator received the event's **promo message** (the real spec) → the event was **REBUILT as the NIGHT-ONLY 16-HOUR op** via `scripts/rebuild-operation-fire-storm-night.sql` (supersedes the wave-1 seed). Tests **3150 / 276**; NO new migrations. **Operation Last Light untouched.**

- **Final event shape (DRAFT, `published=0`, verified in D1):** check-in **Sat 25 Jul 7:45 PM** → END OF PEACE **8:00 PM** → ENDEX **Sun 12:00 PM** (`date_iso` 19:45, `end_date_iso` next-day 12:00); single **$80** "Full Event" ticket `tt_gt_firestorm`; **teams picker (required, per player): Russian Forces / NATO Forces** (civilians assigned on-site with color tape); LIMITED AMMO mechanic (carry what you get; ammo/hidden caches; armor+ammo trucks to conquer; achievements rewarded in ammo); bio BBs; flashlight required (NVG recommended); cash at the gate; free water on-site; FPS tiers 350/450/550 + LMG; age = site standard (operator declined the message's under-16 rule).
- **Team visibility:** every player picks a team at booking (required select per attendee). See rosters at **`/admin/roster`** — each player shows their team, the **search filters by team** (type "Russian"), and the **CSV export** has a `q_faction` column ([#367](https://github.com/bulletbiter99/air-action-sports/pull/367)).
- **EventDetail multi-day fixes** ([#367](https://github.com/bulletbiter99/air-action-sports/pull/367)): overnight/multi-day events render "Non-stop airsoft gameplay (time range)" in What's Included (was a backwards "Full-day … 7:45 PM through 12:00 PM"); Required-Documents links now render their note.

**✅ PUBLISHED (2026-07-01, by the operator):** Fire Storm is **LIVE** at `/events/operation-fire-storm`, taking real bookings. During publish the operator consolidated tickets themselves: deleted the 4 seeded rows and re-activated the original `tt_NBVUMAr6EnUb` at **$80 / capacity 350** (deliberate — kept over the 150 design cap; `events.total_slots` raised to 350 to match). The ticket was then rethemed to **"Operation Fire Storm - Entry"** (`scripts/retheme-operation-fire-storm-ticket.sql`). The night-only content **survived the admin saves intact** (verified in D1 + live render + a full booking-flow walk: banner → ticket → Player 1 → required Russian/NATO picker). Last Light (8:30 AM) still sorts first → remains the home-hero/featured event. `/events/operation-fire-storm` added to the sitemap.

**⚠️ DISCOVERY (2026-07-01) — ✅ FIXED 2026-07-02 (see the section at the top):** the public visual suite's event-dependent baselines were **error-state captures and always had been** — the committed `events-listing` PNG (both the original M4 capture and the 2026-07-01 recapture) showed *"Couldn't load events. Please refresh in a moment."* because **`/api/events` never successfully loaded from GitHub-runner CI** (likely Cloudflare bot-management challenging datacenter-IP XHR; the route has no rate limiter). The check stayed green because every CI run reproduced the same error state — zero real visual coverage of event content; the earlier "CF edge-cache staleness" theory (memory `visual-baseline-cf-cache-gotcha`) was a misdiagnosis of this. **Resolved by converting the suite to route-mocked fixtures ([#371](https://github.com/bulletbiter99/air-action-sports/pull/371))** — the live-capture path (and any Cloudflare-side allowlisting) is no longer needed.

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

`main` HEAD **`4fbbf4a`** (batches 1–6 code landed at `69e6a74`; Batch 7 docs at `4fbbf4a`) · **3149 / 276** tests · migrations **0001–0077** applied. The feature is **dormant** in production (no reviews exist yet; the invite cron's launch cutoff = 2026-06-28 + the 18–48h window mean the first invites go out ~2026-07-25 after **Operation Last Light** ends — nothing emails or displays until then). — ✅ **SUPERSEDED 2026-07-27:** it is no longer dormant. 23 invites went out (a day early — fixed in #392) and 3 reviews were submitted; one was hidden, so the public aggregate is **2 / 4.5★**.

**⚠️ Operator-pending / next-session TODO:**
1. ✅ **RESOLVED 2026-07-01 — CAN-SPAM classification = TRANSACTIONAL + deliverability suppression (option B).** The invite ships without a postal-address/unsubscribe footer (one-per-booking, promotion-free, tied to a completed transaction); the sweep (`worker/lib/reviewInvites.js`) now skips addresses with a recorded hard bounce / spam complaint via `email_events.suppressed_marketing` (best-effort; NOT gated on the `customers.email_marketing` preference). See `docs/runbooks/reviews-deploy.md`.
2. ✅ **RESOLVED 2026-07-02 — home baseline recapture is moot.** The public visual suite no longer tests LIVE prod: it was converted to a route-mocked local-serve harness ([#371](https://github.com/bulletbiter99/air-action-sports/pull/371)), so `home.png` renders deterministic fixtures and prod's hero-stat count can't drift it. The baseline was recaptured with the new harness on that PR. See the 2026-07-02 section above + `docs/runbooks/visual-regression.md`.

**SSR acceptance gate (post-deploy, once reviews exist):** `curl -s https://airactionsport.com/ | grep -c application/ld+json` should show the injected `LocalBusiness` block. It returns **1** now that real reviews exist — a `0` would be a regression (it returned 0 while the feature was dormant); the rich-result surface is the per-event `Event` aggregate at `/events/<slug>` (run it through Google's Rich Results Test after the first review). Don't rely on Home's client JSON-LD — it was removed in Batch 6 (single source = the SSR injection).

---

## Prior context (2026-06-27 and earlier — kept for history)

_The **reviews feature above is COMPLETE + DEPLOYED** and is the authoritative current state. Within the block below, the **"Current state at a glance" table + "Resume checklist" are kept up to date** (they mirror the top); the dated **"DONE / What shipped — &lt;date&gt;"** narratives are preserved as history, so their inline `main` HEAD / test-count figures reflect that session's close — not current._

# Next-session entry point — post 2026-06-27 (OPERATION LAST LIGHT live + image/focal-point pass)

Fresh-session entry point for Air Action Sports. **Updated 2026-06-27.** This session built the `ghost-town-iii-regular-play` draft into **OPERATION LAST LIGHT** — a single-day, 12-hour mission-based event (25 July 2026, Ghost Town / Hiawatha UT, $60) — added a required Russian-vs-NATO **teams picker**, and **PUBLISHED it**. It is now the **first and only published event**, taking **real bookings on live Stripe**. Then a large **image + focal-point pass**: (1) fixed a real bug where `adaptEvent` (useEvents.js) **never forwarded the `*ImagePosition` fields**, so event **cards + the event-detail hero silently used `center`** regardless of the focal picker — now forwarded; (2) pinned the card / locations / hero / banner surfaces to the focal-picker aspect ratios so cover-cropping is WYSIWYG; (3) added a per-event, **per-surface cover-title placement** control (**overlay / below / hidden**) for the event hero + booking banner (admin "Detail page content" → two dropdowns); (4) the **landing-page hero now pulls from the event's Cover (Universal Fallback)** image. `main` **`4af416a`**, **3053 / 264** tests, migrations **0001–0076** (NO new migrations — all via `details_json` + data). Full detail in the **"✅ DONE — 2026-06-27" section** below + memory `event-image-focal-and-title-placement`.

**(2026-06-26) — MULTI-DAY EVENTS shipped + deployed.** A 6-phase feature (PR [#338](https://github.com/bulletbiter99/air-action-sports/pull/338)) added genuine multi-day events (a structured `events.end_date_iso` span) end-to-end — conflict detection, the event-day check-in window (+ a fixed latent timed-date NaN bug), today-active + deferred-revenue span-awareness, public date-range + per-day schedule rendering, and an admin end-date input + per-day schedule editor — merged after a multi-agent code review (findings folded in) with all CI green. **Migration 0076** (`events.end_date_iso`, additive nullable) is applied. The first multi-day event, **`Ghost Town: 18HR MILSIM` (25-26 July 2026)**, was seeded as a **draft** ([#340](https://github.com/bulletbiter99/air-action-sports/pull/340), `published=0`) — since rebuilt + **PUBLISHED as Operation Fire Storm** (2026-07-01, see the top sections). The 2 unpaid Foxtrot cutover invoices were **cancelled** ([#339](https://github.com/bulletbiter99/air-action-sports/pull/339)). `main` **`f1bfa98`**, **3050 / 264** tests, migrations **0001–0076**. (See the "Multi-day events" section below + memory `multiday-events-feature`.) **Prior (2026-06-25): the accounting-dashboard roadmap went FULLY complete** (all 11 surfaces shipped). This session shipped **4 feature PRs + 2 maintenance/docs PRs (#330–#335)**: **A/R aging + DSO** ([#330](https://github.com/bulletbiter99/air-action-sports/pull/330)), **admin visual baseline recapture** ([#331](https://github.com/bulletbiter99/air-action-sports/pull/331)), the **Owner weekly scorecard** ([#332](https://github.com/bulletbiter99/air-action-sports/pull/332)), a docs sync ([#333](https://github.com/bulletbiter99/air-action-sports/pull/333)), a ScorecardGrid render test ([#334](https://github.com/bulletbiter99/air-action-sports/pull/334)), and the **refund-side Stripe-fee reconciliation** ([#335](https://github.com/bulletbiter99/air-action-sports/pull/335) — completes the true-fee feature). Tests **3003 → 3020 / 260**; **no new migrations.** **No roadmap items remain** — remaining work is operator activation only (Marketing send + Resend webhook + FTS flag). Prior context: **2026-06-24** accounting suite #319–#328 (migrations 0074 + 0075); the 2026-06-18 admin design-consistency sweep (#306 / #308–#315 / #317); 2026-06-17 cleared both ⭐ M8 work-menu items (#297–#304); **2026-06-11** waiver-confirmation email + waiver UX (#291–#295, migration 0073) and **2026-06-06** homepage reorder/polish (#289/#290) — all summarized below.
⚠️ **Heads-up on the cutover:** earlier docs recorded the M6 live-Stripe cutover as "DONE 2026-06-02," but it was actually **broken** — production was silently still in Stripe **TEST mode** (every checkout session `cs_test_`) until it was really cut over + e2e-verified on **2026-06-03**. Production now collects real money correctly. See the **2026-06-03 section** below + memory `stripe-live-cutover-fixed-2026-06-03.md`. The earlier **2026-06-02 work-menu session** then completed a 6-item menu + a dark-theme contrast pass and **deployed twice** (`b342b39f` → `94dfb7a9`): applied migrations **0065–0070**, shipped the **marketing route-capability swap**, the **admin dark-theme contrast fix**, **RTL admin-page test coverage**, **representative-data visual baselines**, and **item 6 — admin-editable event content end-to-end** (server sanitizer + admin "Detail page content" editor + Foxtrot seeded live). **What remains (as of 2026-06-17):** operator activation only (Marketing send + Resend webhook + FTS flag) — the item-1 RTL long tail **and** the admin design-consistency sweep are now **DONE** (see the 2026-06-17 section below). Detail below.

---

## Current state at a glance

| Metric | Value |
|---|---|
| `main` HEAD | re-pull for exact (merged through **#416** — the timezone follow-ups close) |
| Tests | **3611 / 304** all green |
| Build | clean · Lint **0 errors** (`npx eslint src worker tests scripts` — plain `npm run lint` also walks the gitignored `static-backup/`, which CI never sees and which reports 24 pre-existing errors). **Reproduce CI exactly with `TZ=UTC npx vitest run`** — the runner is UTC and a naive-ISO fixture is ambient-TZ-dependent. |
| Production | deployed + verified through **#416** (Workers Builds) · `https://airactionsport.com/api/health` → `{"ok":true,...}` — live Stripe + accounting suite + multi-day + reviews + open-reads admin + event-day hardening + the full date_iso timezone fix + **all four admin-audit sprints** + **the timezone follow-ups (conflict narrowing + the Denver business calendar)** live. **Post-#404 archive contract:** archived (`past=1`) events now render on `/games` and their public detail pages **regardless of `published`** (prod verified serving 5 archived events) — and are **not bookable** (quote/checkout 409). A bare `/api/events` (no `include_past=1`) still filters to upcoming published events and can legitimately return `[]`. |
| Migrations on remote | **0001–0080 ALL applied** (0080 applied 2026-07-28; seeded SUA verified incl. an independent `body_sha256` recompute — agreement uploads work; the placeholder text still needs attorney review). |
| Open PRs | 0 |
| Open milestone | **None active, and nothing is blocking.** The **admin workflow audit is FULLY CLOSED** — all four sprints (Sprint 4: 2026-07-28, PRs #403–#411). **Both timezone follow-ups CLOSED 2026-07-28 (#412–#416).** Work menu: **growth plan** (not started) → the kiosk repair-or-retire decision. Operator activation: replace the placeholder SUA with attorney text, Resend plan upgrade, `MARKETING_POSTAL_ADDRESS`, `RESEND_WEBHOOK_SECRET` + webhook, `audit_log_fts` flag. |
| Reviews | **LIVE with real data** — 3 submitted, 1 operator-hidden → public aggregate **2 / 4.5★**. |

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
5. ~~**Public visual baselines test LIVE prod**, so recapture must run AFTER deploy lands~~ **SUPERSEDED 2026-07-02:** the public suite is now route-mocked + locally served ([#371](https://github.com/bulletbiter99/air-action-sports/pull/371)) — baselines are deterministic and recapture no longer waits on a deploy. The `admin-taxes-fees` admin baseline is actually a homepage capture (known mislabel — fix someday).

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
- **First event — `Ghost Town: 18HR MILSIM` (DRAFT, [#340](https://github.com/bulletbiter99/air-action-sports/pull/340)):** 25-26 July 2026 at Ghost Town (`site_3ZQ2j67XEwDG`); "King Coal" theme (GRG vs Cinderjacks); day-keyed schedule; a `faction` custom question; 3 day-pass ticket types (Full Weekend 100 / Day 1 50 / Day 2 50 = 150 per physical day). `scripts/seed-ghost-town-18hr-milsim.sql` applied; **`published=0`** at the time. **✅ SUPERSEDED 2026-07-01:** this draft was rebuilt into **Operation Fire Storm** (night-only 16-hr op) and **PUBLISHED** — single ticket `tt_NBVUMAr6EnUb` "Operation Fire Storm - Entry", $80, capacity 350; the King Coal 2-day structure, GRG/Cinderjacks factions, and the $45/$85/$110 day-pass placeholders are gone. No operator TODO remains — see the Fire Storm sections at the top. (The separate same-day draft `Ghost Town III: Recruitment` is now **Operation Last Light** — built + published 2026-06-27.)
- **Foxtrot invoices CANCELLED ([#339](https://github.com/bulletbiter99/air-action-sports/pull/339)):** the 2 unpaid cutover bookings (Kayden Case `bk_HabP7q2dPblyHA` + Eduardo Ames `bk_BusRxaodwLrQN6`, $27.75 ea) → `status='cancelled'` (collection abandoned; signed waivers/attendees/customers kept; reversible). `scripts/cancel-foxtrot-unpaid-cutover.sql`.

**Durable lessons (this session):** (1) the public events API serializes via `formatEvent` (worker/routes/events.js) and filters `published=1` — at that session's close (2026-06-26) ALL prod events were unpublished, so `/api/events` returned `[]`; correct behavior, not a regression. (Operation Last Light + Operation Fire Storm are published now, so the API returns them.) (2) `events.past` is archive-driven, not date-driven. (3) Adding a column to a `SELECT` breaks mockD1 tests keyed to the exact old SQL string — update the mock regexes (hit the event-day route + conflict + today-active suites). (4) the event-day kiosk + `/today/active` had latent timed-`date_iso` bugs (NaN / never-matched-today) that this work fixed as a side effect.

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

PRs [#289](https://github.com/bulletbiter99/air-action-sports/pull/289) + [#290](https://github.com/bulletbiter99/air-action-sports/pull/290): homepage section reorder + conversion improvements; section background dark/mid alternation restored; attendee counters now render only at **≥50** (shared helper — Home + Event Detail + Events listing); nav **"Games" → `/games`** archive (was the `/#games` anchor). ⚠️ The home/events **public visual baselines were last captured at #289** — #290's background changes postdate them (a Cloudflare edge-cache race blocked the recapture; memory `visual-baseline-cf-cache-gotcha`). Visual CI has passed consistently since. **OBSOLETE 2026-07-02 ([#371](https://github.com/bulletbiter99/air-action-sports/pull/371)):** the public visual suite is now a route-mocked local-serve harness — baselines are deterministic, the CF edge-cache theory was a misdiagnosis, and the cache-bust fix is unnecessary.

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

## ⚠️ Operator-pending (historical — as of the 2026-06-02 deploy)

> **⚠️ SUPERSEDED — do not read this section as current.** The live operator-pending list is in the
> **Sprint 2 section at the top of this file** and in the *Current state at a glance* table. Since this
> section was written, migrations **0078 + 0079** were added — they were **applied 2026-07-27**, resolving what was then
> the highest-priority operator action. Everything below is kept for the history of how the earlier
> items were resolved.

**Unchanged by the 2026-06-06 + 2026-06-11 sessions.** Migrations **0065–0070 are now applied** and the **marketing route-capability swap is deployed** (`b342b39f`). What remains is env/secret/flag activation — every feature degrades gracefully (empty lists / no-op cron / 500 on the unset webhook) until then.

**✅ RESOLVED 2026-06-25 — the final 2 cutover invoices were CANCELLED (collection abandoned):** of the 4 test-mode "paid" bookings that collected $0, two paid their live Stripe invoice (Tyson Wright + Kyle Kitagawa — reconciled). The other two — **Kayden Case (`bk_HabP7q2dPblyHA`) + Eduardo Ames (`bk_BusRxaodwLrQN6`), $27.75 ea (Foxtrot)** — were never paid; on 2026-06-25 the operator chose to stop carrying them, so both were set to `status='cancelled'` + `cancelled_at` (signed waivers / attendees / customer rows intentionally KEPT; reversible) via `scripts/cancel-foxtrot-unpaid-cutover.sql`. **No further collection planned.** (Reconciliation method for the two that DID pay is in memory `stripe-live-cutover-fixed-2026-06-03.md`.)

  **Update 2026-06-04 (revenue reconciliation):** the dashboard's paid total was $55.50 ahead of Stripe because it counted these 2 as paid. Fixed — both set to `status='unpaid'` (test PIs cleared) so they drop out of paid-revenue, and the event-day check-in scanner now flags **"⚠ Payment due"** for them (PR [#286](https://github.com/bulletbiter99/air-action-sports/pull/286), `src/event-day/AttendeeDetail.jsx` — flags any scanned booking whose status ≠ paid/comp). Also cleaned up the $0.56 e2e test booking (cancelled — it had re-paid via a delayed Stripe webhook retry; lesson: a redelivery re-pays any non-`paid` booking). Dashboard paid is now **$497.80 = Stripe net volume**. **Update 2026-06-25:** rather than wait for payment, the operator cancelled both (collection abandoned) — `status='cancelled'`, see the RESOLVED item above + `scripts/cancel-foxtrot-unpaid-cutover.sql`.

**Activate marketing sends + deliverability tracking** — full detail in [docs/runbooks/marketing-deploy.md](runbooks/marketing-deploy.md) + [docs/runbooks/m7-deploy.md](runbooks/m7-deploy.md):
1. **`MARKETING_POSTAL_ADDRESS`** (CAN-SPAM, required) + **Resend plan upgrade** (+ optional marketing subdomain) — the campaign/automation send cron **no-ops** until both are set.
2. **`wrangler secret put RESEND_WEBHOOK_SECRET`** + add the Resend dashboard webhook → `https://airactionsport.com/api/webhooks/resend`, subscribing `email.bounced`/`complained` (M7 deliverability alerts) **and** `email.delivered`/`opened`/`clicked` (campaign tracking). Until set, `/api/webhooks/resend` returns 500 + campaign stats stay at 0. The bounce/complaint events now ALSO feed **review-invite suppression** (`runReviewInviteSweep` skips `email_events.suppressed_marketing` addresses, [#370](https://github.com/bulletbiter99/air-action-sports/pull/370)) — worth setting before the first review invites (~2026-07-26).
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
| 3 | **M6 live-Stripe cutover** | ✅ **DONE 2026-06-03** (the 2026-06-02 record was inaccurate — prod was silently in Stripe TEST mode until then). Production now takes real payments, verified e2e. ✅ The 2 remediation invoices (Kayden Case + Eduardo Ames) were CANCELLED 2026-06-25 — collection abandoned, nothing outstanding. [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md). |
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
TZ=UTC npm test -- --run | tail -3  # expect 3611 / 304 (TZ=UTC reproduces CI — see the Build row above)
npm run build 2>&1 | tail -3        # expect clean
curl -s https://airactionsport.com/api/health   # {"ok":true,...}
```

---

## Key reference docs

| Path | Purpose |
|---|---|
| `docs/next-session.md` | THIS FILE — current state + work menu |
| `docs/growth-plan-2026-07.md` | **conversion + LLM-discoverability roadmap** (6 phases; execution not started) |
| `docs/admin-workflow-audit-2026-07.md` | **admin operator-journey audit** — **FULLY CLOSED 2026-07-28**, all four sprints (read as history; parked leftovers are named in its top banner) |
| `worker/lib/capabilities.js` `requireReadAccess` | the open-reads model's greppable read-gate marker (#379) — reads open to any authed admin, loads caps for field-level masks |
| `CLAUDE.md` | durable rules + per-milestone/session log (M1–M7 + post-M7 + M8 + **event-content session**) |
| `HANDOFF.md` | full session-start onboarding (stack, schema, API surface) |
| `src/pages/EventDetail.jsx` + `src/hooks/useEvents.js` | **per-event `details_json` rendering** (overrides w/ hardcoded fallbacks) — event-content session |
| memory `event-content-data-driven.md` | how to customize one event's page (details_json) + upload event images to R2 |
| memory `image-focal-positioning.md` | the focal-positioning feature (the out-of-band 0071/0072 migration state was RESOLVED 2026-06-02 — historical only) |
| `src/components/admin/ImageFocalPicker.jsx` + `src/hooks/useSites.js` | reusable focal picker + the `/api/sites` hook (focal-positioning feature) |
| `scripts/update-volga-*.sql` / `update-foxtrot-time.sql` | audit record of the Volga/Foxtrot content + image + faction-link writes |
| `tests/helpers/renderComponent.jsx` | RTL/jsdom render helpers (`render` / `renderWithRouter` / `renderWithAdmin`) — M8; `tests/unit/pages/Waiver.test.jsx` is the first PUBLIC-page RTL suite |
| `worker/lib/emailSender.js` `sendWaiverConfirmation` + the hook in `worker/routes/waivers.js` | **waiver-confirmation receipt** (auto on signing; admin per-booking resend on `/admin/bookings/:id`) — 2026-06-11 |
| `tests/helpers/mockClientFetch.js` | client-side `fetch` mock for component tests — M8 |
| `docs/runbooks/marketing-deploy.md` | Marketing B1–B6 deploy + activation (migrations 0067–0070) |
| `docs/runbooks/m7-deploy.md` | M7 deploy + its operator-pending (0065/0066, Resend, FTS flag) |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 live-Stripe operator items (+ #233/#249 code-readiness audit at top) |
