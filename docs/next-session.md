# Next-session entry point — post 2026-06-02 work-menu + deploy session

Fresh-session entry point for Air Action Sports. **Updated 2026-06-03** (close of a large work-menu + deploy session).
M7 closed + deployed; the native Marketing milestone shipped; the **M6 live-Stripe cutover is DONE** (production takes real payments). The **2026-06-02 work-menu session** then completed a 6-item menu + a dark-theme contrast pass and **deployed twice** (`b342b39f` → `94dfb7a9`): applied migrations **0065–0070**, shipped the **marketing route-capability swap**, the **admin dark-theme contrast fix**, **RTL admin-page test coverage**, **representative-data visual baselines**, and **item 6 — admin-editable event content end-to-end** (server sanitizer + admin "Detail page content" editor + Foxtrot seeded live). **What remains:** the item-1 RTL long tail, the full admin **design-consistency sweep**, and operator activation (Marketing send + Resend webhook + FTS flag). Detail below.

---

## Current state at a glance

| Metric | Value |
|---|---|
| `main` HEAD | `f240b4c` (re-pull for exact) |
| Tests | **2823 / 227** all green |
| Build | clean · Lint **0 errors** |
| Production | deployed **`94dfb7a9`** (2026-06-02; latest) · `https://airactionsport.com/api/health` → `{"ok":true,...}` — **live Stripe** + Marketing/deliverability schema active |
| Migrations on remote | **0001–0072 ALL applied** — 0065–0070 applied 2026-06-02. The out-of-band 0071/0072 deferral is **resolved**; a `migrations apply` now finds nothing new. |
| Open PRs | 0 |
| Open milestone | **M8** — items 1–7 of the work menu + the contrast pass done + deployed; **item 6 (event content) COMPLETE**. Remaining: item-1 RTL long tail + the admin design-consistency sweep. |

---

## What shipped — 2026-06-02 work-menu + deploy session (most recent)

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

Migrations **0065–0070 are now applied** and the **marketing route-capability swap is deployed** (`b342b39f`). What remains is env/secret/flag activation — every feature degrades gracefully (empty lists / no-op cron / 500 on the unset webhook) until then.

**Activate marketing sends + deliverability tracking** — full detail in [docs/runbooks/marketing-deploy.md](runbooks/marketing-deploy.md) + [docs/runbooks/m7-deploy.md](runbooks/m7-deploy.md):
1. **`MARKETING_POSTAL_ADDRESS`** (CAN-SPAM, required) + **Resend plan upgrade** (+ optional marketing subdomain) — the campaign/automation send cron **no-ops** until both are set.
2. **`wrangler secret put RESEND_WEBHOOK_SECRET`** + add the Resend dashboard webhook → `https://airactionsport.com/api/webhooks/resend`, subscribing `email.bounced`/`complained` (M7 deliverability alerts) **and** `email.delivered`/`opened`/`clicked` (campaign tracking). Until set, `/api/webhooks/resend` returns 500 + campaign stats stay at 0.
3. **Flip the FTS flag:** `UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';`

**Eyeball (no automated coverage):**
4. The M7 virtualized lists' sticky headers + the Reports custom-range UI.
5. The **dark-theme contrast pass**: `/admin/field-rentals` (+`/new`), `/admin/sites`, an image picker, and any list page's **FilterBar + filter chips** should now render dark + legible (were invisible/white before).

**✅ DONE 2026-06-02 (deployed `b342b39f`):** live-Stripe cutover (all 5 items — production takes real payments) · migrations 0065–0070 applied (Marketing + M7 deliverability) · marketing route-capability swap (`requireCapability`) · admin dark-theme contrast fix. The prior out-of-band-migration deferral is resolved.

---

## Work menu (pick for the next session)

| # | Track | Notes |
|---|---|---|
| 1 | **M8 — JSX coverage backfill (long tail)** ⭐ next | **Batch 1 done** ([#269](https://github.com/bulletbiter99/air-action-sports/pull/269): AdminSegments/Customers/CustomerDetail/TaxesFees/PromoCodes). Remaining: AdminBookings(+Detail), AdminEvents, AdminWaivers, AdminVendors, AdminFieldRentals(+Detail/New), AdminStaff(+Detail), AdminRoster, AdminScan, … Reuse `renderWithAdmin` + `installClientFetch` (+ the sized-ResizeObserver stub for VirtualizedList pages). |
| 2 | **Marketing route capability swap** | ✅ **DONE 2026-06-02** (deployed) — segments/campaigns/automations now `requireCapability('marketing.*')`, method-aware, with caps bound in the route tests. Remaining marketing polish: optional `date_relative` automation trigger + a formal sidebar "Marketing" group + **send activation** (operator-pending #1–2 above). |
| 3 | **M6 live-Stripe cutover** | ✅ **DONE 2026-06-02** — all 5 operator items complete; production takes real payments. [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md). |
| 4 | ~~Full ARIA-grid cell navigation~~ | ✅ **Re-confirmed SKIP 2026-06-02** — keep `role="table"`. Roving-tabindex cell-nav can't reach un-rendered (virtualized) rows, so `grid` would be a fragile half-pattern; the tables already expose full row/cell + position semantics with no nav obligation. Operator decision stands (see CLAUDE.md M8 lesson #6). |
| 5 | ~~Representative-data baselines~~ | ✅ **Customers/Segments/TaxesFees added + all admin baselines recaptured 2026-06-02.** The `installAdminMocks` overrides → `capture-baselines` pattern is available for any further populated tables. |
| 6 | **More event content** (operator, now self-serve) | Item 6's admin editor is **LIVE** — add per-event content (mission briefing / timeline / FPS / rules / docs / terrain / faction links) via `/admin/events` → "Detail page content". Foxtrot's mission briefing is seeded; the operator fills the rest there. Images → R2 via `wrangler r2 object put`. |
| 7 | **Admin design-consistency sweep** ⭐ | Re-theme the legible-but-off-theme **light pills / alert boxes** to the dark theme: field-rental status/COI pills (`AdminFieldRentals` `classifyStatus`/`classifyCoiStatus` light bg+dark text), Contact-form alert boxes, the selected-customer box, the `dangerBtn`. Contrast (legibility) is already fixed; this is visual consistency. Memory `admin-dark-theme-contrast.md`. |
| 8 | **Operator activation** | Marketing send (`MARKETING_POSTAL_ADDRESS` + Resend upgrade) + `RESEND_WEBHOOK_SECRET` + Resend webhook + flip `audit_log_fts` — see Operator-pending above + runbooks. |

---

## Resume checklist (fresh session)

```bash
cd C:/Users/bulle/OneDrive/Desktop/Claude\ Code\ Projects/action-air-sports
git checkout main && git pull origin main
npm install
npm test -- --run | tail -3        # expect 2823 / 227
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
| `tests/helpers/renderComponent.jsx` | RTL/jsdom render helpers (`render` / `renderWithRouter` / `renderWithAdmin`) — M8 |
| `tests/helpers/mockClientFetch.js` | client-side `fetch` mock for component tests — M8 |
| `docs/runbooks/marketing-deploy.md` | Marketing B1–B6 deploy + activation (migrations 0067–0070) |
| `docs/runbooks/m7-deploy.md` | M7 deploy + its operator-pending (0065/0066, Resend, FTS flag) |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 live-Stripe operator items (+ #233/#249 code-readiness audit at top) |
