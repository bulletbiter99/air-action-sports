// Admin visual regression baselines (M7 Batch 9).
//
// Runs under playwright.admin.config.js: serves the built SPA locally
// (vite preview) and route-mocks **/api/** so the admin shell authenticates as
// an owner with deterministic empty data. See adminMocks.js + the runbook
// (docs/runbooks/visual-regression.md) for the harness rationale.
//
// Baselines: tests/visual-admin/admin.spec.js-snapshots/ (e.g.
// admin-dashboard-visual-admin-linux.png). Captured by
// .github/workflows/capture-baselines.yml on a `capture-baselines`-labeled PR.
//
// Each test installs its mock BEFORE goto (so the initial /me fetch is
// intercepted), then waits for a stable element and screenshots full-page with
// dynamic regions masked.

import { test, expect } from '@playwright/test';
import { dynamicMasks } from '../visual/helpers.js';
import {
    installAdminMocks,
    prepareAdminPage,
    mockEventList,
    mockPromoCodeList,
    mockRosterPayload,
    mockRentalAssignmentList,
} from './adminMocks.js';

// The sidebar nav renders on every authenticated admin page (AdminLayout),
// so it's a reliable "shell mounted + auth succeeded" signal.
const SHELL = 'nav.admin-sidebar-nav';

// Renders only once a list page has rows (filtered.length > 0) — a stronger
// "table painted" signal than SHELL for the populated-table baselines.
const TABLE = '.admin-table-wrap';

const shot = (page, name) =>
    expect(page).toHaveScreenshot(name, { fullPage: true, mask: dynamicMasks(page) });

test.describe('admin visual baselines', () => {
    test('login (unauthenticated)', async ({ page }) => {
        // Login needs an UNauthenticated /me — a logged-in /me would redirect
        // the login route straight to the dashboard.
        await installAdminMocks(page, { authed: false });
        await page.goto('/admin/login');
        await prepareAdminPage(page, 'input[type="password"]');
        await shot(page, 'admin-login.png');
    });

    test('dashboard (persona shell)', async ({ page }) => {
        await installAdminMocks(page);
        await page.goto('/admin');
        await prepareAdminPage(page, SHELL);
        await shot(page, 'admin-dashboard.png');
    });

    test('bookings list', async ({ page }) => {
        await installAdminMocks(page);
        await page.goto('/admin/bookings');
        await prepareAdminPage(page, SHELL);
        await shot(page, 'admin-bookings.png');
    });

    test('events list (virtualized)', async ({ page }) => {
        await installAdminMocks(page);
        await page.goto('/admin/events');
        await prepareAdminPage(page, SHELL);
        await shot(page, 'admin-events.png');
    });

    test('reports', async ({ page }) => {
        await installAdminMocks(page);
        await page.goto('/admin/reports');
        await prepareAdminPage(page, SHELL);
        await shot(page, 'admin-reports.png');
    });

    test('settings', async ({ page }) => {
        await installAdminMocks(page);
        await page.goto('/admin/settings');
        await prepareAdminPage(page, SHELL);
        await shot(page, 'admin-settings.png');
    });
});

// Populated-table baselines (post-M7 track 2). The empty-state baselines above
// never exercise the virtualized lists, so a sticky-header or column-alignment
// regression in Events / PromoCodes / Roster / RentalAssignments slips through
// CI (M7 11b needed a manual eyeball for exactly this). These feed representative
// rows so the populated tables are pixel-locked too. TZ + locale are pinned so
// the rows' toLocale* date renders are deterministic across CI runs — scoped to
// this describe so the six empty-state baselines stay byte-for-byte unaffected.
test.describe('admin visual baselines — populated tables', () => {
    test.use({ timezoneId: 'UTC', locale: 'en-US' });

    test('events list — populated (virtualized)', async ({ page }) => {
        await installAdminMocks(page, {
            overrides: [{ match: '/api/admin/events', body: { events: mockEventList() } }],
        });
        await page.goto('/admin/events');
        await prepareAdminPage(page, TABLE);
        await shot(page, 'admin-events-populated.png');
    });

    test('promo codes — populated (virtualized)', async ({ page }) => {
        await installAdminMocks(page, {
            overrides: [
                { match: '/api/admin/promo-codes', body: { promoCodes: mockPromoCodeList() } },
                { match: '/api/admin/events', body: { events: mockEventList() } },
            ],
        });
        await page.goto('/admin/promo-codes');
        await prepareAdminPage(page, TABLE);
        await shot(page, 'admin-promo-codes-populated.png');
    });

    test('roster — populated (virtualized)', async ({ page }) => {
        await installAdminMocks(page, {
            overrides: [
                { match: /\/api\/admin\/events\/[^/]+\/roster$/, body: mockRosterPayload() },
                { match: '/api/admin/events', body: { events: mockEventList() } },
            ],
        });
        // ?event=evt_mock_1 — AdminRoster auto-selects a ?event= target that
        // matches a known event id (mockEventList includes evt_mock_1, non-past).
        await page.goto('/admin/roster?event=evt_mock_1');
        await prepareAdminPage(page, TABLE);
        await shot(page, 'admin-roster-populated.png');
    });

    test('rental assignments — populated (virtualized)', async ({ page }) => {
        await installAdminMocks(page, {
            overrides: [
                { match: '/api/admin/rentals/assignments', body: { assignments: mockRentalAssignmentList() } },
                { match: '/api/admin/events', body: { events: mockEventList() } },
            ],
        });
        await page.goto('/admin/rentals/assignments');
        await prepareAdminPage(page, TABLE);
        await shot(page, 'admin-rental-assignments-populated.png');
    });
});
