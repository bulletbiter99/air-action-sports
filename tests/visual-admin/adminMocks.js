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
 * @param {{ authed?: boolean, overrides?: Array<{ match: string|RegExp, body: any }> }} [opts]
 *   authed:false → /me returns 401 (login surface).
 *   overrides → per-test data injected for specific endpoints (populated-table
 *   baselines). `match` is a path suffix (endsWith) or RegExp tested against the
 *   pathname; the first hit wins. Unmatched paths fall through to the
 *   empty/zero defaults, so a test only overrides what it needs.
 */
export async function installAdminMocks(page, { authed = true, overrides = [] } = {}) {
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body, status = 200) =>
            route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

        // Per-test data overrides (checked first). Lets a test return
        // representative rows for specific endpoints while everything else stays
        // empty/zero. Existing callers pass no overrides → behavior unchanged.
        for (const o of overrides) {
            const hit = o.match instanceof RegExp ? o.match.test(path) : path.endsWith(o.match);
            if (hit) return json(o.body);
        }

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

// ── Representative fixtures for the virtualized-table baselines ──────────
//
// The empty-state baselines above don't exercise the virtualized lists
// (Events / PromoCodes / Roster / RentalAssignments), so a sticky-header or
// column-alignment regression slips through CI (M7 11b needed a manual eyeball
// for exactly this reason). These builders feed deterministic, populated rows
// so the populated tables get pixel-locked too. Values are fixed (no clock /
// random); timestamps are constants and the populated tests pin TZ+locale so
// the toLocale* renders are reproducible across CI runs.

/** Events list payload (`GET /api/admin/events` → { events }). evt_mock_1 is non-past so Roster can auto-select it. */
export function mockEventList() {
    const out = [];
    for (let i = 1; i <= 10; i++) {
        const past = i > 7;
        out.push({
            id: `evt_mock_${i}`,
            title: `Operation Mock ${i}`,
            slug: `operation-mock-${i}`,
            displayDate: `Jun ${i + 9}, 2026`,
            dateIso: `2026-06-${String(i + 9).padStart(2, '0')}`,
            location: i % 2 ? 'Ghost Town, Hiawatha UT' : 'Foxtrot, Kaysville UT',
            ticketTypes: [{ id: `tt_${i}_a` }, { id: `tt_${i}_b` }],
            attendeesCount: 12 * i,
            grossCents: 80000 * i,
            published: !past && i % 4 !== 0,
            past,
        });
    }
    return out;
}

/** Promo codes list payload (`GET /api/admin/promo-codes` → { promoCodes }). */
export function mockPromoCodeList() {
    const out = [];
    for (let i = 1; i <= 10; i++) {
        out.push({
            id: `promo_mock_${i}`,
            code: `MOCK${String(i).padStart(2, '0')}`,
            discountType: i % 2 ? 'percent' : 'fixed',
            discountValue: i % 2 ? 10 + i : 500 * i,
            minOrderCents: i % 3 === 0 ? 5000 : 0,
            eventId: i % 4 === 0 ? `evt_mock_${i}` : null,
            usesCount: i,
            maxUses: i % 2 ? 100 : null,
            startsAt: i % 3 === 0 ? 1_750_377_600_000 : null,
            expiresAt: i % 3 === 0 ? 1_755_648_000_000 : null,
            active: i % 5 !== 0,
        });
    }
    return out;
}

/** Roster payload (`GET /api/admin/events/:id/roster` → { attendees, event }). */
export function mockRosterPayload() {
    const attendees = [];
    for (let i = 1; i <= 12; i++) {
        attendees.push({
            id: `att_mock_${i}`,
            firstName: 'Player',
            lastName: String(i),
            email: `player${i}@example.com`,
            phone: `801-555-${String(1000 + i)}`,
            ticketType: i % 2 ? 'General Admission' : 'VIP',
            waiverSigned: i % 3 !== 0,
            checkedInAt: i % 4 === 0 ? 1_750_464_000_000 : null,
            bookingStatus: i % 5 === 0 ? 'comp' : 'paid',
            buyerName: `Buyer ${i}`,
            isMinor: i % 6 === 0,
            customAnswers: {},
        });
    }
    return { attendees, event: { customQuestions: [] } };
}

/** Rental assignments list payload (`GET /api/admin/rentals/assignments` → { assignments }). */
export function mockRentalAssignmentList() {
    const cats = ['Rifle', 'Pistol', 'Mask', 'Vest'];
    const conds = [null, 'good', 'fair', 'damaged'];
    const out = [];
    for (let i = 1; i <= 10; i++) {
        const returned = i % 2 === 0;
        const cond = returned ? conds[i % conds.length] : null;
        out.push({
            id: `asg_mock_${i}`,
            itemName: `${cats[i % cats.length]} #${i}`,
            itemSku: `SKU-${1000 + i}`,
            itemCategory: cats[i % cats.length],
            attendeeName: `Player ${i}`,
            eventTitle: `Operation Mock ${(i % 10) + 1}`,
            checkedOutAt: 1_750_420_000_000 + i * 3_600_000,
            checkedInAt: returned ? 1_750_440_000_000 + i * 3_600_000 : null,
            conditionOnReturn: cond,
            damageNotes: cond === 'damaged' ? 'Scratched optic' : null,
        });
    }
    return out;
}
