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

**Admin baselines are NOT yet captured.** Per the M4 plan they're deferred to Batch 5 (admin IA reorganization), where the new sidebar shipped in B5 becomes the basis. Until then, admin UI changes are protected only by the M3 manual UAT pattern + the test gate map.

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
- **B5** — admin IA reorg; admin baselines captured for the first time as part of B5's PR
- **Beyond M4** — mobile viewport (375×667) baselines, additional admin surfaces as they stabilize

## Cost notes

Each PR run hits production 7 times. Cumulative load is small (one PR per few hours, single-worker runs). If PR volume rises substantially, consider:
- Running visual against `air-action-sports.bulletbiter99.workers.dev` (the .workers.dev fallback URL) to bypass any CDN-level caching artifacts
- Adding `playwright.config.js` `reporter: 'github'` for cleaner annotations on PR diffs
- Capping CI concurrency at the workflow level

These are not pressing concerns at M4 cadence.
