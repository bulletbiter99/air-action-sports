// Playwright config for PUBLIC visual regression (2026-07-02 harness).
//
// Mirrors playwright.admin.config.js: builds the SPA, serves dist/ locally
// (vite preview), and the spec route-mocks **/api/** with representative
// fixtures (tests/visual/publicMocks.js). The suite originally lived as the
// `visual` project inside playwright.config.js and screenshotted LIVE
// airactionsport.com — but /api/events never loaded from GitHub-runner CI
// (Cloudflare bot management challenging datacenter-IP XHR is the leading
// suspect), so every baseline since the original M4 capture showed the events
// error state and event content had zero visual coverage. Local-serve + mocks
// makes the renders deterministic and finally pixel-locks event content.
//
// The `smoke` project (tests/e2e, operator-triggered against deployed prod)
// stays in playwright.config.js — live smoke is still its whole point.
//
// Run:
//   npm run test:visual          — compare against baselines
//   npm run test:visual:update   — capture/refresh baselines (CI only;
//                                  see docs/runbooks/visual-regression.md)
//
// Baselines stay under tests/visual/public.spec.js-snapshots/ (the project
// name is still `visual`, so existing snapshot filenames keep matching) and
// are captured by .github/workflows/capture-baselines.yml on PRs labeled
// `capture-baselines`.

import { defineConfig, devices } from '@playwright/test';

// 4174 — one above the admin suite's 4173 so the two preview servers never
// fight over a port when run back-to-back (capture-baselines runs both).
const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    timeout: 60_000,
    retries: 0,
    workers: 1,
    reporter: process.env.CI
        ? [['html', { open: 'never', outputFolder: 'playwright-report' }], ['list']]
        : 'list',
    // Build the SPA, then serve dist/ locally. Self-contained so it works the
    // same in CI and on a dev machine.
    webServer: {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        // Pin rendering-relevant environment so toLocale* dates and any
        // local-time math are reproducible across CI runs. Denver matches the
        // site's audience + the tz-naive dateIso values in the fixtures.
        timezoneId: 'America/Denver',
        locale: 'en-US',
    },
    projects: [
        {
            // Keep the historical project name — snapshot filenames embed it
            // (e.g. home-visual-linux.png), so renaming would orphan baselines.
            name: 'visual',
            testDir: 'tests/visual',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
            },
            // 1% threshold — same rationale as the admin suite: near-pixel-
            // perfect while absorbing sub-pixel font rendering jitter.
            expect: {
                toHaveScreenshot: {
                    maxDiffPixelRatio: 0.01,
                },
            },
        },
    ],
});
