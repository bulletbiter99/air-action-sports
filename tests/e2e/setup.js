// Playwright e2e helpers — kept thin; the smoke tests live in smoke.test.js.
//
// Operator setup (one-time after merge of m1-batch-6-playwright):
//   npx playwright install chromium
//
// Run the smoke suite (operator-triggered, not in CI by default):
//   npm run test:e2e
//   BASE_URL=https://staging.example.com npm run test:e2e
//   E2E_TEST_EVENT_SLUG=ops-night npm run test:e2e   (un-skips audit #79)
//
// These tests hit a DEPLOYED Worker. They are NOT run by `npm test`
// (vitest-only) and are NOT in CI by default.

// Returns the event slug to use for audit smoke #79 (per-event OG title
// rewrite), or null when unset. Test #79 calls test.skip(!slug, ...) when
// this returns null so the smoke suite stays operator-data-agnostic.
export function getEventSlug() {
    return process.env.E2E_TEST_EVENT_SLUG || null;
}
