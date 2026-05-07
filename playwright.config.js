// Playwright config for Air Action Sports.
//
// Two projects share this config:
//   * smoke   — public-route smoke suite (M1 B6, audit Group I #77-#83).
//                Operator-triggered: `npm run test:e2e`.
//                Lives in tests/e2e/.
//   * visual  — visual regression suite (M4 B1b). Captures pixel-stable
//                baselines for 7 public surfaces; gates PRs in CI.
//                Lives in tests/visual/. Baselines under
//                tests/visual/__snapshots__/ — captured by the
//                .github/workflows/capture-baselines.yml workflow when
//                the PR is labeled `capture-baselines`. See
//                docs/runbooks/visual-regression.md.
//
// Both projects target a DEPLOYED Worker — they are not for local-dev
// validation. Default baseURL is the canonical custom domain
// (https://airactionsport.com); override via BASE_URL env var.
//
// Operator setup (one-time after merge):
//   npx playwright install chromium
//
// vitest.config.js excludes tests/e2e/** and tests/visual/**, so the
// two runners don't fight over the same files.

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://airactionsport.com';

export default defineConfig({
    timeout: 30_000,
    retries: 0,
    workers: 1,
    // CI gets the html report (uploaded as an artifact on failure) plus a
    // line-streamed list view. Local dev gets the list view only.
    reporter: process.env.CI
        ? [['html', { open: 'never', outputFolder: 'playwright-report' }], ['list']]
        : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'smoke',
            testDir: 'tests/e2e',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'visual',
            testDir: 'tests/visual',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
            },
            // Per-project expect overrides — applies to expect(page).toHaveScreenshot(...).
            // 1% threshold per the M4 milestone prompt; tightens to "near-pixel-perfect"
            // while accommodating sub-pixel font rendering jitter that the same headless
            // Chromium build can produce across runs.
            expect: {
                toHaveScreenshot: {
                    maxDiffPixelRatio: 0.01,
                },
            },
        },
    ],
});
