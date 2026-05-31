// Playwright config for ADMIN visual regression (M7 Batch 9).
//
// Separate from the public visual suite (playwright.config.js) on purpose:
// admin pages cannot be screenshotted against production the way public pages
// are, because they
//   (a) require authentication,
//   (b) render non-deterministic database data, and
//   (c) never go network-idle (the useWidgetData / useTodayActive polling —
//       M6 Lesson #11), which breaks the public suite's networkidle wait.
//
// Instead this config serves the BUILT SPA locally (vite preview) and the spec
// intercepts **/api/** with a route-mock (tests/visual-admin/adminMocks.js)
// that returns a logged-in owner + empty/zero data. The result is
// deterministic, needs no SESSION_SECRET / admin credentials, and never touches
// production. This is what dissolves the M4 B11 deferral.
//
// Run:
//   npm run test:visual:admin          — compare against baselines
//   npm run test:visual:admin:update   — capture/refresh baselines (CI only;
//                                         see docs/runbooks/visual-regression.md)
//
// Baselines live under tests/visual-admin/admin.spec.js-snapshots/ and are
// captured by .github/workflows/capture-baselines.yml on PRs labeled
// `capture-baselines`.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    timeout: 60_000,
    retries: 0,
    workers: 1,
    reporter: process.env.CI
        ? [['html', { open: 'never', outputFolder: 'playwright-report' }], ['list']]
        : 'list',
    // Build the SPA, then serve dist/ locally. Self-contained so it works the
    // same in CI and on a dev machine. reuseExistingServer lets local iteration
    // reuse an already-running preview instead of rebuilding every run.
    webServer: {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'visual-admin',
            testDir: 'tests/visual-admin',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
            },
            // Same 1% threshold as the public suite (playwright.config.js).
            expect: {
                toHaveScreenshot: {
                    maxDiffPixelRatio: 0.01,
                },
            },
        },
    ],
});
