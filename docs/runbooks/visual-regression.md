# Visual Regression Runbook

The visual-regression suite (M4 B1b) captures pixel-stable baselines for the public storefront and gates every PR against unintended UI diffs. Tightens the safety net for any future batch that touches CSS, layout, or shared components.

## What it protects (today)

7 public surfaces, captured against the deployed `https://airactionsport.com`:

| Surface | URL |
|---|---|
| home | `/` |
| events listing | `/events` |
| event detail | `/events/operation-nightfall` (or `E2E_TEST_EVENT_SLUG`) |
| booking step 1 | `/booking` |
| booking step 2 | `/booking?event=operation-nightfall` |
| waiver error state | `/waiver?token=invalid` |
| booking confirmation | `/booking/success` |

### Cloudflare edge-cache freshness (why the gotos are cache-busted)

Because the public suite renders **live prod**, it is exposed to Cloudflare's edge cache: right after a deploy the edge can keep serving the previous build's HTML for a while. That stale render makes a just-shipped UI change invisible to **both** jobs — the compare job passes against the old pixels, and a `capture-baselines` recapture commits nothing ("No baseline changes to commit") — so the intended baseline update silently doesn't happen and then a later PR fails once the edge finally expires. Each `page.goto()` therefore appends a unique cache-bust query param via `bust()` (`tests/visual/helpers.js`), forcing a cache miss → the freshest deployed HTML from the Worker origin. The SPA ignores unknown query params, so rendered pixels are unaffected. If you ship an intentional public UI change, recapture **after** the deploy lands and rely on `bust()` to defeat the edge — no need to guess when the edge PoP has expired.

**Admin baselines are captured as of M7 Batch 9** — see [Admin baselines (M7 B9)](#admin-baselines-m7-b9) below. They use a different harness (local-serve + API route-mock) because admin pages require auth and render non-deterministic data; they live in `tests/visual-admin/` under a separate Playwright config.

## Admin baselines (M7 B9)

Admin pages get their own harness because they can't be screenshotted against production the way public pages are: they require authentication, render non-deterministic database data, and **never go network-idle** (the `useWidgetData` / `useTodayActive` polling).

**How it differs from the public suite:**

| | Public suite | Admin suite |
|---|---|---|
| Config | `playwright.config.js` (`visual` project) | `playwright.admin.config.js` (`visual-admin` project) |
| Target | deployed `airactionsport.com` | **local** `vite preview` of the built SPA |
| Data | real (anonymous) | **route-mocked** `**/api/**` → empty/zero |
| Auth | none | mocked `/api/admin/auth/me` → owner |
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

`maxDiffPixelRatio: 0.01` (1%) — set in [playwright.config.js](../../playwright.config.js) per-project. Tightens to "near-pixel-perfect" while accommodating sub-pixel font rendering jitter that the same headless Chromium build can produce across runs.

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
   - Runs `npm run test:visual:update` against production
   - Commits new PNGs under `tests/visual/__snapshots__/` as `github-actions[bot]`
   - Pushes the commit to your PR head
   - Removes the `capture-baselines` label
4. CI re-runs on the new commit. The `visual` job now passes (baselines match).
5. **Review the new PNGs in the PR diff** — sanity-check that the new look is what you intended.
6. Squash-merge to milestone, then milestone → main per rolling pattern.

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

**Live data state** — the event-detail / booking-step-2 captures depend on a specific event being published. If `operation-nightfall` is retired, either:
- Set the GitHub Actions workflow env `E2E_TEST_EVENT_SLUG` to a different known-published event, OR
- Remove the `event detail` and `booking step 2` tests from `tests/visual/public.spec.js` until a new stable event exists

## Adding a new surface

1. Add a `test('<name>', async ({ page }) => { ... })` block to [tests/visual/public.spec.js](../../tests/visual/public.spec.js):
   ```js
   test('new surface', async ({ page }) => {
       await page.goto('/new-route');
       await preparePage(page);
       await expect(page).toHaveScreenshot('new-surface.png', {
           fullPage: true,
           mask: dynamicMasks(page),
       });
   });
   ```
2. Open the PR. The `visual` job will fail on this surface only (no baseline yet).
3. Label the PR `capture-baselines` to capture the initial baseline.
4. Review the new PNG in the next commit's diff and merge.

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

Each PR run hits production 7 times. Cumulative load is small (one PR per few hours, single-worker runs). If PR volume rises substantially, consider:
- Running visual against `air-action-sports.bulletbiter99.workers.dev` (the .workers.dev fallback URL) to bypass any CDN-level caching artifacts
- Adding `playwright.config.js` `reporter: 'github'` for cleaner annotations on PR diffs
- Capping CI concurrency at the workflow level

These are not pressing concerns at M4 cadence.
