// Playwright config for the public-route smoke suite. These tests run
// SEPARATELY from vitest (`npm test` stays vitest-only) and target a
// DEPLOYED Worker — they are not for local-dev validation.
//
// Operator setup (one-time after merge):
//   npx playwright install chromium
//
// Run the smoke suite:
//   npm run test:e2e
//   BASE_URL=https://staging.example.com npm run test:e2e
//   E2E_TEST_EVENT_SLUG=ops-night npm run test:e2e   (tightens audit #79)
//
// vitest.config.js excludes `tests/e2e/**`, so the two runners don't
// fight over the same files.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 30_000,
    retries: 0,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: process.env.BASE_URL || 'https://air-action-sports.bulletbiter99.workers.dev',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
