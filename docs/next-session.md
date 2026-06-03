# Next-session entry point — post-M8 + Volga/Foxtrot event-content session

Fresh-session entry point for Air Action Sports. **Updated 2026-06-02** (event-content session + Volga Flank hero-photo refresh).
M7 is CLOSED + DEPLOYED; the native **Marketing milestone (B1–B6)** is CODE-COMPLETE + merged; **M8**'s
work-menu items 1–4 are done (RTL+jsdom infra, ARIA `table` roles, Reports/Campaigns coverage, visual
baselines); and a follow-on **event-content session (2026-06-02)** shipped the first **data-driven event
pages** and fully built out the **Volga Flank** + **Foxtrot** events (PRs #254/#255/#256/#257 merged;
#1 closed). What remains is M8's item-2 long tail + the standing operator-pending list.

---

## Current state at a glance

| Metric | Value |
|---|---|
| `main` HEAD | `45ee41f` (Merge #266 — data-driven /locations) · docs-sync PR may be open |
| Tests | **2776 / 220** (+32 from the focal-positioning feature) |
| Build | clean · Lint **0 errors** |
| Production | `https://airactionsport.com/api/health` → `{"ok":true,...}` — auto-deploys from `main` via Workers Builds |
| Migrations on remote | **0001–0064 + 0071 + 0072 applied** — 0071/0072 applied **OUT-OF-BAND** so 0065–0070 stay deferred (⚠️ see the focal-positioning section); **0065–0070 in-repo, operator-applies** |
| Open PRs | docs-sync only |
| Open milestone | **M8** — items 1–4 done; remaining = JSX-coverage backfill for older M3+ pages (long tail) |

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

**⚠️ OUT-OF-BAND MIGRATION STATE — read before any `wrangler d1 migrations apply --remote`:** 0071 + 0072 were applied to remote out-of-band (`d1 execute --file` for the ALTERs + a manual `INSERT INTO d1_migrations`) **specifically so the deferred 0065–0070 (Marketing + M7) stay un-applied**. `d1_migrations` now reads 0064 → **0071, 0072** (out of order — harmless). A future `migrations apply` applies 0065–0070 (still pending) and skips 0071/0072 (already recorded). The operator-pending list below is **UNCHANGED**.

---

## ⚠️ Operator-pending (unchanged — deferred features are inert / use fallbacks until done)

Everything below is safe-deployed — routes degrade gracefully (empty lists / no-op cron) until activated. **The event-content session changed none of this** (it added no migrations and touched no marketing/M7/M6 surfaces).

**Marketing (post-M7 / Marketing milestone) — full detail in [docs/runbooks/marketing-deploy.md](runbooks/marketing-deploy.md):**
1. **Apply migrations 0067–0070** to remote (campaigns / tracking / automations / marketing caps).
2. **`MARKETING_POSTAL_ADDRESS`** (CAN-SPAM, required) + **Resend plan upgrade** + (optional) marketing
   subdomain — the campaign/automation send cron **no-ops** until the address + Resend are set.
3. **Resend webhook** now also feeds campaign tracking — subscribe `email.delivered`/`opened`/`clicked`
   too (alongside the bounced/complained M7 already needs).
4. **Marketing route capability swap** (deferred) — segments/campaigns/automations stay `requireAuth`;
   swap to `requireCapability(...)` only AFTER 0070 is verified on remote (else it 403s owners + breaks
   the route tests). Caps are seeded by 0070. Functionally identical today (all admins are owners).

**Carried from M7 — full detail in [docs/runbooks/m7-deploy.md](runbooks/m7-deploy.md):**
5. **Apply migrations 0065 (email_events) + 0066 (alert templates)** + **`wrangler secret put RESEND_WEBHOOK_SECRET`** + add the Resend dashboard webhook → `https://airactionsport.com/api/webhooks/resend`.
6. **Flip the FTS flag:** `UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';`
7. **Eyeball** the 4 virtualized lists' sticky headers + the Reports custom-range UI.

**Carried from M6 — ⚠️ the #1 go-live blocker:** **live-Stripe cutover items 1–5** — [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md). The booking flow works end-to-end but **takes no real payments** until this is done (Stripe is still in SANDBOX). Code is verified live-ready (**#233 audit + #249 re-audit**); only the 5 operator items remain.

---

## Work menu (pick for the next session)

| # | Track | Notes |
|---|---|---|
| 1 | **M8 — JSX coverage backfill (long tail)** | RTL tests for older M3+ JSX-only pages: `AdminCustomers`, `AdminCustomerDetail`, `AdminSegments`, … Reuse `renderWithAdmin` + `installClientFetch`. The repetitive remainder of item 2. |
| 2 | **Marketing route capability swap** | After 0070 is on remote: swap segments/campaigns/automations to `requireCapability('marketing.*')` + bind caps in the route tests. + optional `date_relative` automation trigger + formal sidebar "Marketing" group. |
| 3 | **M6 live-Stripe cutover** | The 5 operator items + $1 e2e — code verified live-ready (#233 + #249). **#1 go-live blocker.** [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md). |
| 4 | **Full ARIA-grid cell navigation** (optional) | Only if wanted: roving-tabindex arrow-key cell nav on the virtualized tables. Deliberately NOT built — the data tables expose `role="table"` (no nav obligation). |
| 5 | **Representative-data baselines for more admin pages** | The #232/#248 pattern (`installAdminMocks` overrides → `capture-baselines`) for any other populated tables worth pixel-locking. |
| 6 | **More event content** | Build out / customize any event via `events.details_json` (memory `event-content-data-driven.md`; Volga is the template). Upload images to R2 via `wrangler r2 object put` (the deploy token has R2 access). |

---

## Resume checklist (fresh session)

```bash
cd C:/Users/bulle/OneDrive/Desktop/Claude\ Code\ Projects/action-air-sports
git checkout main && git pull origin main
npm install
npm test -- --run | tail -3        # expect 2744 / 217
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
| `scripts/update-volga-*.sql` / `update-foxtrot-time.sql` | audit record of the Volga/Foxtrot content + image + faction-link writes |
| `tests/helpers/renderComponent.jsx` | RTL/jsdom render helpers (`render` / `renderWithRouter` / `renderWithAdmin`) — M8 |
| `tests/helpers/mockClientFetch.js` | client-side `fetch` mock for component tests — M8 |
| `docs/runbooks/marketing-deploy.md` | Marketing B1–B6 deploy + activation (migrations 0067–0070) |
| `docs/runbooks/m7-deploy.md` | M7 deploy + its operator-pending (0065/0066, Resend, FTS flag) |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 live-Stripe operator items (+ #233/#249 code-readiness audit at top) |
