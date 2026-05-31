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
import { installAdminMocks, prepareAdminPage } from './adminMocks.js';

// The sidebar nav renders on every authenticated admin page (AdminLayout),
// so it's a reliable "shell mounted + auth succeeded" signal.
const SHELL = 'nav.admin-sidebar-nav';

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
