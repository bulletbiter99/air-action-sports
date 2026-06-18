# Next-session entry point — post 2026-06-17 (admin design-consistency sweep COMPLETE)

Fresh-session entry point for Air Action Sports. **Updated 2026-06-11** (close of a customer-support-driven session: waiver-form UX fixes + the new **waiver-confirmation email** feature — PRs #291–#295 + migration 0073, all merged + deployed + live-verified). Two sessions happened since the prior sync: **2026-06-06** homepage reorder/polish (#289/#290) and **2026-06-11** (both summarized below).
⚠️ **Heads-up on the cutover:** earlier docs recorded the M6 live-Stripe cutover as "DONE 2026-06-02," but it was actually **broken** — production was silently still in Stripe **TEST mode** (every checkout session `cs_test_`) until it was really cut over + e2e-verified on **2026-06-03**. Production now collects real money correctly. See the **2026-06-03 section** below + memory `stripe-live-cutover-fixed-2026-06-03.md`. The earlier **2026-06-02 work-menu session** then completed a 6-item menu + a dark-theme contrast pass and **deployed twice** (`b342b39f` → `94dfb7a9`): applied migrations **0065–0070**, shipped the **marketing route-capability swap**, the **admin dark-theme contrast fix**, **RTL admin-page test coverage**, **representative-data visual baselines**, and **item 6 — admin-editable event content end-to-end** (server sanitizer + admin "Detail page content" editor + Foxtrot seeded live). **What remains (as of 2026-06-17):** operator activation only (Marketing send + Resend webhook + FTS flag) — the item-1 RTL long tail **and** the admin design-consistency sweep are now **DONE** (see the 2026-06-17 section below). Detail below.

---

## Current state at a glance

| Metric | Value |
|---|---|
| `main` HEAD | `8a3fc07` (re-pull for exact) |
| Tests | **2945 / 251** all green |
| Build | clean · Lint **0 errors** |
| Production | deployed from `main` via Workers Builds · `https://airactionsport.com/api/health` → `{"ok":true,...}` — live Stripe (cut over 2026-06-03) + Marketing/deliverability schema active + waiver-confirmation receipts live (2026-06-11). The admin design-consistency sweep is deployed (per-element token/header swaps; no behavior change). |
| Migrations on remote | **0001–0073 ALL applied** — no new migrations since 2026-06-11; a `migrations apply` finds nothing new. |
| Open PRs | 0 (all merged through #314) |
| Open milestone | **None active.** The admin design-consistency sweep is **COMPLETE** (batches 1–5b, PRs #306 + #308–#314). Remaining work is operator activation only (Marketing send + Resend webhook + FTS flag + the 2 cutover invoices). |

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

Result: every admin **list / index / create-form** page now uses `AdminPageHeader`; **detail** pages keep their on-theme bespoke headers (the `AdminBookingsDetail` `.abd-header` precedent); the bare cluster tables are wrapped in the house table-box; Field Rentals uses the shared chip-based `FilterBar`. Added/rewrote RTL render tests for the newly-covered pages (Staff New, EventArchive, Analytics, Staff Library, Today, New Booking) → **2945 / 251**.

**Deliberately DECLINED (operator-agreed, NOT oversights):**
- **AdminCampaigns FilterBar** — kept its clean segmented status-button row (the chip "+ Add filter" flow is more clicks for a single filter).
- **AdminDashboardPersona header** — the `/admin` landing dashboard's personalized header (user + persona tag) is purpose-built, not a list/detail header.
- **FieldRentals detail/new page primary buttons** — still rounded (minor; the FilterBar migration targeted the list page).

**Durable lessons** (full detail in memory):
- **`FilterBar` is chip-based**, not always-visible selects — migrating a page is a real UX shift, and its test must mock `/api/admin/saved-views` (FilterBar calls `useSavedViews` when `savedViewsKey` is set). Test filters URL-driven (`?status=sent` → assert the `Remove Status filter` chip + scoped fetch), not via the picker UI.
- **Detail-page house style exists** (`AdminBookingsDetail.css` `.abd-header-row h1` — 24px/900/uppercase/`--cream` + tinted monospace `<code>` + `.abd-back`); conform a detail page only if it diverges from it.
- **The `capture-baselines` recapture flow** (only needed when a changed page HAS an admin baseline — Bookings/Customers/Segments/Campaigns/Automations/Reports do; Staff/FieldRentals/Analytics/Today don't): add the label → bot recaptures → **then push an empty commit** to clear GitHub's anti-recursion `action_required` block so CI re-runs green.
- **Side finding (still open, pre-existing):** the `admin-taxes-fees` visual baseline actually captures the public homepage, not the admin page — a broken baseline worth fixing someday.

---

## What shipped — 2026-06-17 session (M8 design sweep + RTL coverage long tail)

Cleared **both ⭐ work-menu items**. **8 PRs merged + deployed** (#297 audit cleanup · #298 design sweep · #299–#304 RTL batches A1–A6). Tests **2860 → 2933 / 245** (+73). No `src/` runtime changes except the design sweep's token swaps; everything else is additive test files. No new migrations.

- **Production test-data cleanup** ([#297](https://github.com/bulletbiter99/air-action-sports/pull/297)): swept 10 leftover test bookings (Glen Anderson's 5× $0.30 carts + the cutover-era $0.56 / "Cutover Verify" / 3× Tyson-Wright-TEST rows) + 1 orphaned operator customer from prod D1; recorded as audit SQL under `scripts/cleanup-*.sql`. Paid revenue untouched (prod bookings 56 → 46). The 2 outstanding cutover invoices (Kayden Case + Eduardo Ames, $27.75 ea) are still owed — see Operator-pending.
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
- **4 test-mode "paid" bookings collected $0** (real cards can't complete a test-mode checkout). Operator kept their bookings + QR tickets and sent each a **live Stripe invoice** to collect. **Reconciliation method:** on payment, clear the dead test `stripe_payment_intent` (NULL; status stays `paid`) + write an `audit_log booking.payment_reconciled` row. **✅ Paid + reconciled:** Tyson Wright (`bk_v8JmtpX9L6lclQ`), Kyle Kitagawa (`bk_9keBjkqsBhw7Et`). **⏳ Still owed:** Kayden Case (`bk_HabP7q2dPblyHA`, $27.75) + Eduardo Ames (`bk_BusRxaodwLrQN6`, $27.75) — see Operator-pending.
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

**Collect the final 2 cutover-remediation invoices (2026-06-03):** the 4 test-mode "paid" bookings collected $0; live Stripe invoices were sent. **Still owed:** Kayden Case (`bk_HabP7q2dPblyHA`, $27.75) + Eduardo Ames (`bk_BusRxaodwLrQN6`, $27.75). When each pays: clear the dead test `stripe_payment_intent` (set NULL) + write an `audit_log booking.payment_reconciled` row — method in memory `stripe-live-cutover-fixed-2026-06-03.md`. (Tyson Wright + Kyle Kitagawa already paid + reconciled.)

  **Update 2026-06-04 (revenue reconciliation):** the dashboard's paid total was $55.50 ahead of Stripe because it counted these 2 as paid. Fixed — both set to `status='unpaid'` (test PIs cleared) so they drop out of paid-revenue, and the event-day check-in scanner now flags **"⚠ Payment due"** for them (PR [#286](https://github.com/bulletbiter99/air-action-sports/pull/286), `src/event-day/AttendeeDetail.jsx` — flags any scanned booking whose status ≠ paid/comp). Also cleaned up the $0.56 e2e test booking (cancelled — it had re-paid via a delayed Stripe webhook retry; lesson: a redelivery re-pays any non-`paid` booking). Dashboard paid is now **$497.80 = Stripe net volume**. When Case/Ames pay, reconcile to `status='paid'`.

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

| # | Track | Notes |
|---|---|---|
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
npm test -- --run | tail -3        # expect 2933 / 245
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
