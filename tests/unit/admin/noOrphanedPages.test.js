// Guard against the "fully-built feature with no door" class.
//
// AdminEventStaffing shipped in M5 R9 with a header comment naming its intended
// route, and was never imported, routed, or linked. It went unnoticed for
// months WHILE two cron sweeps emailed staff about assignments that no admin
// could open — the feature looked finished from every angle except the one that
// mattered. A 2026-07 link sweep found it only by diffing components against
// the route table by hand.
//
// This asserts every page-like component under src/admin/ is imported by
// src/App.jsx. Sub-components (modals, context, widgets) are legitimately not
// routed and are allowlisted BY NAME WITH A REASON — so adding a new page and
// forgetting to route it fails here, while adding a new modal requires one
// deliberate line that a reviewer can see.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ADMIN_DIR = join(process.cwd(), 'src', 'admin');
const APP_JSX = join(process.cwd(), 'src', 'App.jsx');

// Not pages. Each entry needs a reason — if you cannot write one, it is
// probably a page you forgot to route.
const NOT_PAGES = {
    AdminContext: 'React context provider, consumed via useAdmin()',
    AdminDashboardPersona: 'rendered by AdminDashboard.jsx, which IS routed',
    AdminBookingRefund: 'modal opened from the booking detail page',
    AdminBookingExternalRefund: 'modal opened from the booking detail page',
    AdminBookingRecordPayment: 'modal opened from the booking detail page',
    AdminStaffCertEditor: 'modal opened from the staff detail Certifications tab',
    AdminStaffProfileEdit: 'modal opened from the staff detail Profile tab',
    CustomerCreateModal: 'modal opened from the customers list',
    CustomerTypeahead: 'input component used by the new-booking form',
    CheckInBanner: 'banner rendered by AdminLayout',
    CommandPalette: 'Cmd+K overlay mounted by AdminLayout',
    VirtualizedList: 'shared table primitive',
    charts: 'shared chart primitives (SVG helpers, not a component file)',
};

describe('no orphaned admin pages', () => {
    const appSource = readFileSync(APP_JSX, 'utf8');
    const components = readdirSync(ADMIN_DIR)
        .filter((f) => f.endsWith('.jsx'))
        .map((f) => f.replace(/\.jsx$/, ''));

    it('imports every page-like admin component in App.jsx', () => {
        const orphans = components.filter(
            (name) => !Object.hasOwn(NOT_PAGES, name) && !appSource.includes(`admin/${name}'`)
        );
        expect(orphans, `Orphaned admin page(s): ${orphans.join(', ')}. Either add a <Route> in src/App.jsx, or — if this is a sub-component rather than a page — add it to NOT_PAGES in this file with the reason it is not routed.`).toEqual([]);
    });

    it('keeps the allowlist honest — every entry still exists', () => {
        // A stale allowlist silently re-opens the hole: a deleted-then-recreated
        // page whose name is still listed would never be checked again.
        const missing = Object.keys(NOT_PAGES).filter((n) => !components.includes(n));
        expect(missing, `NOT_PAGES lists component(s) that no longer exist: ${missing.join(', ')}. Remove them.`).toEqual([]);
    });

    it('routes AdminEventStaffing specifically — the page this guard was written for', () => {
        expect(appSource).toContain("admin/AdminEventStaffing'");
        expect(appSource).toContain('events/:id/staffing');
    });
});
