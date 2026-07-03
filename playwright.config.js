// Playwright config for Air Action Sports — SMOKE suite only.
//
//   * smoke — public-route smoke suite (M1 B6, audit Group I #77-#83).
//             Operator-triggered: `npm run test:e2e`. Lives in tests/e2e/.
//             Targets a DEPLOYED Worker (live smoke is its whole point).
//             Default baseURL is the canonical custom domain
//             (https://airactionsport.com); override via BASE_URL env var.
//
// The `visual` project (public visual regression) lived here from M4 B1b
// until 2026-07-02, screenshotting live prod. It now lives in
// playwright.public.config.js as a local-serve + route-mock harness (the
// tests/visual-admin pattern) — /api/events never loaded from GitHub-runner
// CI, so live captures had zero event-content coverage. See
// docs/runbooks/visual-regression.md.
//
// Operator setup (one-time after merge):
//   npx playwright install chromium
//
// vitest.config.js excludes tests/e2e/** and tests/visual/**, so the
// runners don't fight over the same files.

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
    ],
});
