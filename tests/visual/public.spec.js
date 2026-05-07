// Visual regression — public storefront baselines (M4 B1b).
// audit Group I (visual extension)
//
// Captures pixel-stable baselines for 7 public surfaces. Subsequent M4
// batches that touch CSS, layout, or shared components must not produce
// unintended diffs against these baselines. Per the M4 plan, admin
// baselines are deferred to Batch 5 (captured alongside the IA reorg
// since B5 will reorganize the admin shell anyway).
//
// Baselines live in tests/visual/__snapshots__/<this-file>-snapshots/.
// They are captured by the .github/workflows/capture-baselines.yml
// workflow when the PR is labeled `capture-baselines`. Operators do
// NOT capture baselines locally — see docs/runbooks/visual-regression.md
// for the full workflow rationale.
//
// Threshold: 1% maxDiffPixelRatio (set in playwright.config.js per-project).
//
// Event used for /events/:slug + /booking?event=: defaults to
// `operation-nightfall` (the live event id at M4 kickoff). Override via
// E2E_TEST_EVENT_SLUG to point at a different known-published event.

import { test, expect } from '@playwright/test';
import { preparePage, dynamicMasks } from './helpers.js';

const EVENT_ID = process.env.E2E_TEST_EVENT_SLUG || 'operation-nightfall';

test.describe('public visual baselines', () => {
    test('home', async ({ page }) => {
        await page.goto('/');
        await preparePage(page);
        await expect(page).toHaveScreenshot('home.png', {
            fullPage: true,
            mask: dynamicMasks(page),
        });
    });

    test('events listing', async ({ page }) => {
        await page.goto('/events');
        await preparePage(page);
        await expect(page).toHaveScreenshot('events-listing.png', {
            fullPage: true,
            mask: dynamicMasks(page),
        });
    });

    test('event detail', async ({ page }) => {
        const res = await page.goto(`/events/${EVENT_ID}`);
        // If the event was deleted or renamed in production, skip rather
        // than fail — the suite stays useful as long as the URL is 200.
        test.skip(
            !res || res.status() >= 400,
            `/events/${EVENT_ID} not available in production. Update E2E_TEST_EVENT_SLUG or remove this baseline if the event was retired.`,
        );
        await preparePage(page);
        await expect(page).toHaveScreenshot('event-detail.png', {
            fullPage: true,
            mask: dynamicMasks(page),
        });
    });

    test('booking step 1 — initial', async ({ page }) => {
        await page.goto('/booking');
        await preparePage(page);
        await expect(page).toHaveScreenshot('booking-step1.png', {
            fullPage: true,
            mask: dynamicMasks(page),
        });
    });

    test('booking step 2 — with event preselected', async ({ page }) => {
        // The booking page accepts ?event=<id-or-slug> to land on the main
        // form pre-scoped to a specific event.
        await page.goto(`/booking?event=${EVENT_ID}`);
        await preparePage(page);
        await expect(page).toHaveScreenshot('booking-step2.png', {
            fullPage: true,
            mask: dynamicMasks(page),
        });
    });

    test('waiver — error state (invalid token)', async ({ page }) => {
        // Per audit smoke #81: /waiver?token=invalid renders an error UX
        // that's a 200 response with explanatory copy. Capture that as the
        // canonical waiver baseline since the happy path requires a valid
        // server-issued token.
        await page.goto('/waiver?token=invalid');
        await preparePage(page);
        // Wait for SPA to mount and render the error state before capturing.
        await expect(page.locator('body')).toContainText(/invalid|expired|error|not found/i, {
            timeout: 10_000,
        });
        await expect(page).toHaveScreenshot('waiver-error.png', {
            fullPage: true,
            mask: dynamicMasks(page),
        });
    });

    test('booking confirmation — empty state (no session)', async ({ page }) => {
        // /booking/success without a Stripe session_id query param renders
        // the page's empty / fallback state. Captures the chrome rather
        // than a real confirmation since real confirmations require live
        // Stripe sessions.
        await page.goto('/booking/success');
        await preparePage(page);
        await expect(page).toHaveScreenshot('booking-confirmation.png', {
            fullPage: true,
            mask: dynamicMasks(page),
        });
    });
});
