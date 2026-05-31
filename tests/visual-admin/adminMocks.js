// Route-mock layer for the admin visual-regression suite (M7 Batch 9).
//
// The admin shell gates access purely CLIENT-SIDE: AdminContext.refresh()
// fetches /api/admin/auth/me, and AdminLayout renders the shell only when a
// user comes back (isAuthenticated = !!user). So returning an owner for /me
// authenticates the entire shell — no cookie, no SESSION_SECRET, no production
// data. Data endpoints return empty/zero so every page renders a deterministic
// empty state (stable pixels run-to-run).
//
// Reuses freezeAnimations + waitForFontsLoaded from the public suite. It does
// NOT reuse preparePage — that waits for networkidle, which admin pages never
// reach (useWidgetData / useTodayActive keep polling — M6 Lesson #11).

import { freezeAnimations, waitForFontsLoaded } from '../visual/helpers.js';

// Matches publicUser() (worker/lib/auth.js) + a couple harmless extras.
// role:'owner' is what unlocks the full sidebar; persona is derived from role
// in production (publicUser omits it) but we set it for completeness.
const OWNER = {
    id: 'usr_mock_owner',
    email: 'owner@example.com',
    displayName: 'Mock Owner',
    role: 'owner',
    persona: 'owner',
    lastLoginAt: 1748000000000,
    createdAt: 1700000000000,
};

// Broad owner capability set so every nav entry + the Reports tabs render.
// The six reports.* keys are from migrations/0062_reports_capabilities.sql.
const OWNER_CAPS = [
    'reports.read', 'reports.read.owner', 'reports.read.bookkeeper',
    'reports.read.marketing', 'reports.read.site_coordinator', 'reports.export',
    'bookings.read', 'bookings.read.pii', 'bookings.email', 'bookings.export',
    'bookings.refund', 'bookings.refund.external',
    'staff.read', 'staff.write', 'customers.read', 'customers.write',
];

// Zero-shaped responses for the dashboard's aggregate endpoints so widgets
// render clean $0 / 0 states rather than NaN/blank.
const ZERO_OVERVIEW = {
    totals: { grossCents: 0, netCents: 0, refundCents: 0, taxCents: 0, feeCents: 0, bookings: 0, attendees: 0 },
    byStatus: [],
};
const ZERO_ACTION_QUEUE = { missingWaivers: 0, pendingCountersigns: 0, newFeedback: 0, recentRefunds: 0 };
const ZERO_FUNNEL = { steps: [], days: 30 };

// Generic empty superset — covers the list/detail shapes any page might
// destructure (results/items/data/rows + named collections + pagination).
const EMPTY = {
    results: [], items: [], data: [], rows: [],
    events: [], bookings: [], customers: [], reports: [],
    total: 0, count: 0, page: 1, pageSize: 25, totalPages: 0,
};

/**
 * Install the admin API mock on a page. Call BEFORE page.goto so the initial
 * /me fetch is intercepted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ authed?: boolean }} [opts] authed:false → /me returns 401 (login surface)
 */
export async function installAdminMocks(page, { authed = true } = {}) {
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body, status = 200) =>
            route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

        // Auth surface
        if (path.endsWith('/api/admin/auth/me')) {
            return authed ? json({ user: OWNER, capabilities: OWNER_CAPS }) : json({ error: 'Unauthorized' }, 401);
        }
        if (path.endsWith('/api/admin/auth/setup-needed')) return json({ setupNeeded: false });
        if (path.endsWith('/api/admin/today/active')) return json({ activeEventToday: false, eventId: null, checkInOpen: false });

        // Dashboard aggregates → zero-shaped (clean $0/0, not NaN)
        if (path.includes('/analytics/overview')) return json(ZERO_OVERVIEW);
        if (path.includes('/analytics/funnel')) return json(ZERO_FUNNEL);
        if (path.includes('/analytics/sales-series')) return json({ series: [] });
        if (path.includes('/dashboard/action-queue')) return json(ZERO_ACTION_QUEUE);
        if (path.includes('/dashboard/upcoming-readiness')) return json({ events: [] });

        // Everything else under /api → generic empty superset
        return json(EMPTY);
    });
}

/**
 * Pre-screenshot prep for admin pages. Freezes animations + waits for fonts,
 * then waits for a stable element (NOT networkidle — admin pages poll forever).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [waitForSelector] a stable element that marks the page ready
 * @param {{ timeout?: number }} [opts]
 */
export async function prepareAdminPage(page, waitForSelector, { timeout = 10_000 } = {}) {
    await freezeAnimations(page);
    await waitForFontsLoaded(page);
    if (waitForSelector) {
        await page.locator(waitForSelector).first().waitFor({ state: 'visible', timeout }).catch(() => {});
    }
    // Small settle for lazy-loaded route chunks to paint. toHaveScreenshot's
    // own stability retry handles the rest.
    await page.waitForTimeout(300);
}
