// Shared utilities for the visual regression suite (M4 B1b).
//
// Every visual test should call preparePage(page) after the initial goto
// and before toHaveScreenshot — it freezes animations and waits for fonts.
// Without this, two consecutive runs against the same URL can produce
// different pixel output (mid-animation frame, fallback font flash, etc.)
// and the diff threshold won't save you.

/**
 * Disable CSS animations + transitions globally on the page so snapshots
 * captured during an in-flight animation are stable.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function freezeAnimations(page) {
    await page.addStyleTag({
        content: `
            *, *::before, *::after {
                animation-duration: 0s !important;
                animation-delay: 0s !important;
                transition-duration: 0s !important;
                transition-delay: 0s !important;
                scroll-behavior: auto !important;
            }
        `,
    });
}

/**
 * Wait for browser fonts to be loaded. Without this, a screenshot may
 * capture the page mid-FOUT (Flash Of Unstyled Text) with fallback fonts
 * substituted, producing different pixel output than a fully-loaded view.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function waitForFontsLoaded(page) {
    await page.evaluate(() => document.fonts.ready);
    // Tiny grace period for any post-font-load layout shift.
    await page.waitForTimeout(200);
}

/**
 * Standard pre-screenshot prep: freeze animations + wait for fonts.
 * Call after page.goto() and before expect(page).toHaveScreenshot().
 *
 * @param {import('@playwright/test').Page} page
 */
export async function preparePage(page) {
    await freezeAnimations(page);
    await waitForFontsLoaded(page);
}

/**
 * Selectors for elements that contain dynamic content (timestamps, countdowns,
 * relative-time labels). Pass to toHaveScreenshot's `mask` option to keep
 * snapshots stable as time passes.
 *
 * Add to this list when you find a flaky region — prefer fixing the source
 * (data-dynamic="..." attribute) when possible. Selectors here are heuristic
 * and may over-mask harmlessly.
 */
export const DYNAMIC_REGION_SELECTORS = [
    '[data-dynamic]',          // explicit opt-in via attribute
    'time[datetime]',          // HTML5 time element with machine-readable datetime
    '[class*="countdown" i]',  // class names containing "countdown"
    '[class*="time-ago" i]',   // "X minutes ago" labels
];

/**
 * Build a mask array of locators from DYNAMIC_REGION_SELECTORS for a given page.
 * Pass directly to toHaveScreenshot({ mask: ... }).
 *
 * @param {import('@playwright/test').Page} page
 */
export function dynamicMasks(page) {
    return DYNAMIC_REGION_SELECTORS.map((s) => page.locator(s));
}
