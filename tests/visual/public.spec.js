// Visual regression — public storefront baselines.
//
// Originally M4 B1b, captured against LIVE airactionsport.com. Converted
// 2026-07-02 to the local-serve + route-mock harness (the proven
// tests/visual-admin pattern): playwright.public.config.js builds + serves the
// SPA locally, and every test installs publicMocks.js fixtures before goto.
// Why: /api/events NEVER loaded from GitHub-runner CI (every baseline back to
// the original M4 capture shows the events error state — zero real coverage
// of event content while the check sat stable-green). With mocks the renders
// are deterministic AND the events grid / home hero / event detail (incl. a
// multi-day op) are finally pixel-locked. Rationale + fixture notes in
// tests/visual/publicMocks.js; operator workflow in
// docs/runbooks/visual-regression.md.
//
// Baselines live in tests/visual/public.spec.js-snapshots/ and are captured
// by .github/workflows/capture-baselines.yml when the PR is labeled
// `capture-baselines`. Operators do NOT capture baselines locally.
//
// Threshold: 1% maxDiffPixelRatio (set in playwright.public.config.js).

import { test, expect } from '@playwright/test';
import { preparePage, DYNAMIC_REGION_SELECTORS } from './helpers.js';
import { installPublicMocks, mockEventSingle, mockEventMultiDay } from './publicMocks.js';

// The shared mask list hides [class*="countdown"], but installPublicMocks
// freezes the clock (page.clock.setFixedTime) so the home countdown band is
// deterministic here — leave it UNmasked so its event-name content is real
// coverage. The admin suite (no frozen clock) keeps the full mask list.
const MASK_SELECTORS = DYNAMIC_REGION_SELECTORS.filter((s) => !/countdown/i.test(s));
const masks = (page) => MASK_SELECTORS.map((s) => page.locator(s));

const shot = (page, name) =>
    expect(page).toHaveScreenshot(name, { fullPage: true, mask: masks(page) });

// Wait for a fixture-driven element so the screenshot never races the SPA's
// post-fetch render (preparePage's networkidle covers the fetches themselves).
const settle = (page, text) =>
    page.getByText(text).first().waitFor({ state: 'visible', timeout: 10_000 });

const SINGLE = mockEventSingle();
const MULTI = mockEventMultiDay();

test.describe('public visual baselines', () => {
    test('home', async ({ page }) => {
        await installPublicMocks(page);
        await page.goto('/');
        await settle(page, SINGLE.title);
        await preparePage(page);
        await shot(page, 'home.png');
    });

    test('events listing', async ({ page }) => {
        await installPublicMocks(page);
        await page.goto('/events');
        await settle(page, MULTI.title);
        await preparePage(page);
        await shot(page, 'events-listing.png');
    });

    test('event detail', async ({ page }) => {
        // Single-day + details:null → every hardcoded fallback section renders
        // (schedule, briefing, rules, terrain) + the populated reviews feed.
        await installPublicMocks(page);
        await page.goto(`/events/${SINGLE.slug}`);
        await settle(page, SINGLE.title);
        await preparePage(page);
        await shot(page, 'event-detail.png');
    });

    test('event detail — multi-day', async ({ page }) => {
        // Overnight op: date-range label + "Day N"-grouped Operation Timeline +
        // data-driven briefing/documents + the zero-reviews (omitted) branch.
        await installPublicMocks(page);
        await page.goto(`/events/${MULTI.slug}`);
        await settle(page, 'Day 2');
        await preparePage(page);
        await shot(page, 'event-detail-multiday.png');
    });

    test('booking step 1 — initial', async ({ page }) => {
        // Two published events + no ?event= → the event picker renders (the
        // first time this surface has had real picker coverage).
        await installPublicMocks(page);
        await page.goto('/booking');
        await settle(page, SINGLE.title);
        await preparePage(page);
        await shot(page, 'booking-step1.png');
    });

    test('booking step 2 — with event preselected', async ({ page }) => {
        // ?event=<slug> deep-link preselects the event → main form with the
        // banner + ticket list.
        await installPublicMocks(page);
        await page.goto(`/booking?event=${SINGLE.slug}`);
        await settle(page, SINGLE.ticketTypes[0].name);
        await preparePage(page);
        await shot(page, 'booking-step2.png');
    });

    test('waiver — error state (invalid token)', async ({ page }) => {
        // Per audit smoke #81: /waiver?token=invalid renders an error UX. The
        // mock returns the real API's 404 body ({ error: 'Invalid waiver link' }).
        await installPublicMocks(page);
        await page.goto('/waiver?token=invalid');
        await expect(page.locator('body')).toContainText(/invalid|expired|error|not found/i, {
            timeout: 10_000,
        });
        await preparePage(page);
        await shot(page, 'waiver-error.png');
    });

    test('booking confirmation — empty state (no session)', async ({ page }) => {
        // /booking/success without a token renders the no-booking fallback.
        await installPublicMocks(page);
        await page.goto('/booking/success');
        await settle(page, 'No booking found');
        await preparePage(page);
        await shot(page, 'booking-confirmation.png');
    });

    test('reviews page', async ({ page }) => {
        // /reviews (reviews feature Batch 6) — populated all-reviews feed.
        await installPublicMocks(page);
        await page.goto('/reviews');
        await settle(page, 'Jake R.');
        await preparePage(page);
        await shot(page, 'reviews-page.png');
    });
});
