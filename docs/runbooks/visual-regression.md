# Visual Regression Runbook

The visual-regression suite (M4 B1b) captures pixel-stable baselines for the public storefront and gates every PR against unintended UI diffs. Tightens the safety net for any future batch that touches CSS, layout, or shared components.

> **⚠️ Harness change (2026-07-02):** the public suite **no longer screenshots live production.** It now uses the same local-serve + route-mock harness as the admin suite — see [Public harness (2026-07-02)](#public-harness-2026-07-02) below for what changed and why.

## Public harness (2026-07-02)

The public suite originally captured the deployed `https://airactionsport.com`. That design had a fatal blind spot, discovered 2026-07-01: **`/api/events` never successfully loaded from GitHub-runner CI** — the committed `events-listing` baseline AND the original M4 capture (`860d13a`) both show the *"Couldn't load events. Please refresh in a moment."* error state. Every capture and every compare reproduced the same failure, so the check sat stable-green while event content (home hero/cards/countdown, events grid, event detail) had **zero real visual coverage**. `/api/events` returns `Cache-Control: no-store` (never edge-cached — the earlier "stale CF colo cache" theory was a misdiagnosis) and has no rate limiter; the leading suspect is Cloudflare bot management challenging datacenter-IP XHR from headless Chrome.

The fix: the public suite now mirrors the admin harness —

- [`playwright.public.config.js`](../../playwright.public.config.js) builds the SPA and serves `dist/` locally (`vite preview`, port 4174; the admin suite uses 4173).
- Every test installs [`tests/visual/publicMocks.js`](../../tests/visual/publicMocks.js) before `goto`: representative fixtures for `/api/events` (2 events, one multi-day), `/api/events/:slug`, `/api/sites`, `/api/reviews/*`, `/api/taxes-fees`, plus the waiver/booking error bodies. Fixture shapes mirror the real serializers (`formatEvent`/`formatTicketType`, `publicReview`, `formatPublicSite`).
- `installPublicMocks` also **freezes the browser clock** (`page.clock.setFixedTime`) so the home countdown band renders deterministic pixels (it's deliberately *unmasked* now — its event-name content is real coverage), and the config pins `timezoneId: 'America/Denver'` + `locale: 'en-US'` for date renders.
- Fixture images are static `/images/*` assets that ship in `dist/` — never Worker-only `/uploads/*` keys, which the local preview server can't serve.

Consequences of the philosophy change:

- **Deterministic baselines.** No more live-prod races: publishing/retiring an event, a new review, or a Cloudflare-layer change can never drift a baseline. Recaptures no longer need to wait for a deploy to land ("recapture AFTER the deploy" is obsolete).
- **Event content is finally pixel-locked** — a regression in the events grid, home hero, countdown band, event detail (incl. multi-day range label + Day-N schedule grouping), booking picker/form, or the reviews surfaces now fails CI.
- **Prod rendering is no longer directly observed.** The operator-triggered smoke suite (`npm run test:e2e`, still in `playwright.config.js`) remains the live-prod check; browser-verify after deploys per the usual workflow.

## What it protects (today)

9 public surfaces, rendered from the built SPA + mocked API fixtures:

| Surface | URL | Fixture notes |
|---|---|---|
| home | `/` | hero from featured event cover, countdown (frozen clock), 2 event cards, live-testimonials branch, 4.8★ hero stat |
| events listing | `/events` | 2 upcoming events incl. the multi-day op |
| event detail | `/events/operation-mock-alpha` | single-day, `details:null` → all hardcoded fallback sections + populated reviews feed |
| event detail (multi-day) | `/events/operation-mock-overnight` | date-range label, Day-N grouped timeline, data-driven briefing/documents, zero-reviews branch |
| booking step 1 | `/booking` | 2 events → the event picker renders |
| booking step 2 | `/booking?event=operation-mock-alpha` | preselected form, banner + 2 ticket types |
| waiver error state | `/waiver?token=invalid` | mock mirrors the real 404 body |
| booking confirmation | `/booking/success` | no token → fallback state |
| reviews page | `/reviews` | populated all-reviews feed |

**Admin baselines are captured as of M7 Batch 9** — see [Admin baselines (M7 B9)](#admin-baselines-m7-b9) below. The admin harness came first (M7 B9); the public suite adopted its pattern on 2026-07-02. They live in `tests/visual-admin/` under a separate Playwright config.

## Admin baselines (M7 B9)

Admin pages get their own harness because they can't be screenshotted against production the way public pages are: they require authentication, render non-deterministic database data, and **never go network-idle** (the `useWidgetData` / `useTodayActive` polling).

**How it differs from the public suite** (since 2026-07-02 both use local-serve + route-mock; the remaining differences):

| | Public suite | Admin suite |
|---|---|---|
| Config | `playwright.public.config.js` (`visual` project, port 4174) | `playwright.admin.config.js` (`visual-admin` project, port 4173) |
| Target | **local** `vite preview` of the built SPA | **local** `vite preview` of the built SPA |
| Data | **route-mocked** `**/api/**` → representative fixtures (`publicMocks.js`) | **route-mocked** `**/api/**` → empty/zero (+ per-test `overrides`) |
| Auth | none needed | mocked `/api/admin/auth/me` → owner |
| Clock | frozen (`page.clock.setFixedTime`) — countdowns deterministic | real (pages have no countdowns; timestamps masked/fixed) |
| Script | `npm run test:visual` | `npm run test:visual:admin` |
| Tests | `tests/visual/public.spec.js` | `tests/visual-admin/admin.spec.js` |
| Baselines | `tests/visual/public.spec.js-snapshots/` | `tests/visual-admin/admin.spec.js-snapshots/` |

**Why route-mock and not a real session?** Capturing admin baselines once looked like it required either a forged session cookie (`SESSION_SECRET` in CI — a forgery vector) or real admin credentials, plus it would screenshot live, changing data (the M4 B11 deferral). But the admin shell gates access purely client-side: `AdminContext` fetches `/api/admin/auth/me` and `AdminLayout` renders the shell only when `isAuthenticated`. So a Playwright `page.route` mock returning an owner for `/me` authenticates the whole shell with **no secret and no production load**, and empty/zero data for every other endpoint makes the renders deterministic. See [tests/visual-admin/adminMocks.js](../../tests/visual-admin/adminMocks.js).

**Surfaces captured (6):**

| Surface | Route | Auth |
|---|---|---|
| login | `/admin/login` | unauthenticated (`/me` → 401) |
| dashboard | `/admin` | owner |
| bookings | `/admin/bookings` | owner |
| events | `/admin/events` | owner |
| reports | `/admin/reports` | owner |
| settings | `/admin/settings` | owner |

**Populated-table surfaces (4, post-M7 track 2):** the six above are empty-state, so they never exercise the virtualized lists — a sticky-header or column-alignment regression slips through (M7 11b needed a manual eyeball for exactly this). These feed representative rows via `installAdminMocks(page, { overrides })`, where `overrides` is `[{ match, body }]` (path-suffix or RegExp; first hit wins; unmatched paths still get the empty/zero defaults). The fixtures (`mockEventList` / `mockPromoCodeList` / `mockRosterPayload` / `mockRentalAssignmentList`) use fixed values + constant timestamps, and the populated `test.describe` pins `timezoneId: 'UTC'` + `locale: 'en-US'` so the rows' `toLocale*` date renders are reproducible — scoped so the six empty-state baselines stay byte-for-byte unchanged.

| Surface | Route | Data |
|---|---|---|
| events (populated) | `/admin/events` | 10 events (published / draft / past mix) |
| promo codes (populated) | `/admin/promo-codes` | 10 codes (percent / fixed, scoped / global) |
| roster (populated) | `/admin/roster?event=evt_mock_1` | 12 attendees (signed / pending / checked-in / minor / comp) |
| rental assignments (populated) | `/admin/rentals/assignments` | 10 assignments (out / returned, good / fair / damaged) |

**The never-idle gotcha.** Admin pages poll, so `waitForLoadState('networkidle')` never resolves. `prepareAdminPage()` skips it — it freezes animations + waits for fonts (reusing the public helpers) + waits for a stable element (`nav.admin-sidebar-nav` on authed pages; the password field for login) + a short settle. `toHaveScreenshot`'s two-stable-frames retry handles the rest.

**Capture / CI** mirrors the public flow: the `visual-admin` CI job compares against baselines; on a `capture-baselines`-labeled PR the capture workflow also runs `npm run test:visual:admin:update` in the same runner and commits the PNGs (`git add tests/visual tests/visual-admin`). The first-ever admin capture happened on the M7 B9 PR.

**Adding a new admin surface:**
1. Add a `test('<name>', …)` to [tests/visual-admin/admin.spec.js](../../tests/visual-admin/admin.spec.js): `installAdminMocks(page)` → `goto('/admin/<route>')` → `prepareAdminPage(page, 'nav.admin-sidebar-nav')` → `toHaveScreenshot('<name>.png', { fullPage: true, mask: dynamicMasks(page) })`.
2. If the page needs a non-empty shape to render cleanly, add a targeted zero/empty response in `installAdminMocks`. For a **populated**-table baseline, pass `{ overrides: [{ match, body }] }` to `installAdminMocks` instead (see the populated surfaces above) and wrap the test in a `test.describe` that pins `timezoneId` + `locale` if any row renders a `toLocale*` date.
3. Label the PR `capture-baselines` to seed the baseline; review the new PNG in the diff.

## Threshold

`maxDiffPixelRatio: 0.01` (1%) — set per-project in [playwright.public.config.js](../../playwright.public.config.js) + [playwright.admin.config.js](../../playwright.admin.config.js). Tightens to "near-pixel-perfect" while accommodating sub-pixel font rendering jitter that the same headless Chromium build can produce across runs.

## How CI works

```
PR opens → ci.yml's `visual` job runs
  ├─ if baselines exist + match within 1%   → ✓ pass
  └─ if baselines missing OR diff > 1%      → ✗ fail
                                              + uploads playwright-visual-report
                                              + uploads playwright-visual-diffs
```

The `test` job (lint + vitest + coverage) and the `visual` job run **in parallel** — neither blocks the other. Visual is the long pole at ~2 min once Chromium is cached.

## Capturing or refreshing baselines (operator workflow)

**Whenever a UI change is intentional** — e.g., redesigned a component, fixed a layout bug, swapped a font — the baseline diff fires. To accept the new look:

1. Push the change to your PR. The `visual` CI job will fail with diffs in the artifact.
2. **Label the PR `capture-baselines`.** This triggers [`.github/workflows/capture-baselines.yml`](../../.github/workflows/capture-baselines.yml).
3. The bot:
   - Checks out the PR head branch
   - Runs `npm run test:visual:update` + `npm run test:visual:admin:update` (both local-serve + route-mock — production is never touched)
   - Commits new PNGs under `tests/visual/public.spec.js-snapshots/` + `tests/visual-admin/admin.spec.js-snapshots/` as `github-actions[bot]`
   - Pushes the commit to your PR head
   - Removes the `capture-baselines` label
4. CI re-runs on the new commit. The `visual` job now passes (baselines match).
5. **Review the new PNGs in the PR diff** — sanity-check that the new look is what you intended.
6. Merge the PR to main (feature branches PR directly to main; Workers Builds auto-deploys on merge).

**Why CI-driven and not local?** Font rendering, browser version, and viewport rounding differ between any two environments. Capturing in the same CI runner that compares ensures pixel-identical baselines. The `npm run test:visual:update` script exists for solo dev iteration but baselines pushed to the repo only ever come from CI.

## Investigating a failure

When the `visual` CI job fails:

1. Open the failed CI run on GitHub.
2. Scroll to **Artifacts** at the bottom. Download:
   - `playwright-visual-diffs` — contains `<surface>-actual.png` (what CI saw), `<surface>-expected.png` (the baseline), `<surface>-diff.png` (highlighted pixel differences)
   - `playwright-visual-report` — Playwright's HTML report with the same data, browseable via `npx playwright show-report` after extraction
3. Eyeball the diff image. Three outcomes:
   - **Real regression** — fix the source of the change in your PR.
   - **Intentional change** — see "Capturing or refreshing baselines" above.
   - **Flake** — see "Known flake sources" below.

## Known flake sources + how to handle

**Dynamic content** (timestamps, "X minutes ago", live counters) is masked via the `dynamicMasks(page)` helper in [tests/visual/helpers.js](../../tests/visual/helpers.js). The default selectors mask `[data-dynamic]`, `time[datetime]`, `[class*="countdown"]`, `[class*="time-ago"]`. Add new selectors to `DYNAMIC_REGION_SELECTORS` if a new flaky region appears — prefer adding `data-dynamic="true"` to the source element when possible (more explicit than class-name heuristics).

**Animations** are frozen via `freezeAnimations(page)` (zero-duration override applied as an injected stylesheet). New animated components inherit this automatically.

**Font rendering** — `waitForFontsLoaded(page)` ensures `document.fonts.ready` resolves + a 200ms grace before the screenshot. If a flake appears that looks like character anti-aliasing changes, increase the grace window.

**Live data state — obsolete since 2026-07-02.** The public suite renders fixture events (`operation-mock-alpha` / `operation-mock-overnight` in `publicMocks.js`), so publishing/retiring real events can never drift a baseline and `E2E_TEST_EVENT_SLUG` no longer applies to the visual suite (the smoke suite still uses it). If a page grows a new API call, add it to `installPublicMocks` — unmocked `/api/*` paths 404 loudly, so the miss shows up as an obvious error state in the pixel diff.

**Clock-sensitive content** (the home countdown band) is frozen via `page.clock.setFixedTime(FROZEN_NOW)` inside `installPublicMocks`, so it renders deterministic values and is deliberately unmasked. If a new always-ticking element appears, prefer the frozen clock over masking.

## Adding a new surface

1. Add a `test('<name>', async ({ page }) => { ... })` block to [tests/visual/public.spec.js](../../tests/visual/public.spec.js):
   ```js
   test('new surface', async ({ page }) => {
       await installPublicMocks(page);          // BEFORE goto — intercepts the initial fetches
       await page.goto('/new-route');
       await settle(page, 'Some fixture text'); // wait for a fixture-driven element
       await preparePage(page);
       await shot(page, 'new-surface.png');
   });
   ```
2. If the page calls an endpoint `installPublicMocks` doesn't cover, add a fixture branch for it (unmocked `/api/*` 404s loudly by design). Mirror the real serializer's field names — check the worker route, not just the page.
3. Open the PR. The `visual` job will fail on this surface only (no baseline yet).
4. Label the PR `capture-baselines` to capture the initial baseline.
5. Review the new PNG in the next commit's diff and merge.

## When NOT to use this suite

- **Functional behavior** — write a vitest unit test instead.
- **Pre-merge UAT** — eyeball the change in `npm run dev` first; visual regression is the safety net, not the primary review.
- **Cross-browser parity** — currently Chromium-only. Adding Firefox/WebKit projects would multiply the baseline storage cost; not in M4 scope.

## M4 batch context

- **B1a** — Group G worker-level tests (separate batch, already merged)
- **B1b** — this suite + the capture-baselines workflow + this runbook
- **B5** — admin IA reorg (the new sidebar); admin baselines were deferred here, then again in B11 (M4 B11), and finally landed in **M7 Batch 9** via the local-serve + route-mock harness above
- **Post-M7 (track 2)** — representative-data admin baselines (4 populated virtualized tables) via the `overrides` route-mock layer
- **Beyond** — mobile viewport (375×667) baselines, additional admin surfaces as they stabilize

## Cost notes

Since 2026-07-02 neither visual suite touches production — both build + serve the SPA inside the CI runner. The only live-prod Playwright traffic left is the operator-triggered smoke suite (`npm run test:e2e`). The capture workflow runs two builds back-to-back (one per config's `webServer`); at ~250ms per Vite build this is noise.
