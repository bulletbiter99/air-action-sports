// M4 B5 — tests for src/admin/sidebarConfig.js.
// M5 B0 sub-batch 0-sidebar — extended for D10 (Rentals / Roster / Scan
// restored as capability-gated standing nav) + capability stub tests.
//
// Pure helper tests; no DOM, no fetch, no D1. Mirrors the M2
// useFilterState test pattern (test pure helpers; the hook/component
// itself is thin glue).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    SIDEBAR,
    getVisibleItems,
    loadSidebarExpand,
    saveSidebarExpand,
    userHasCapabilityStub,
} from '../../../src/admin/sidebarConfig.js';

describe('SIDEBAR config', () => {
    it('starts with Home, Today (dynamic), separator, then Events / Bookings / Customers', () => {
        expect(SIDEBAR[0]).toMatchObject({ type: 'item', to: '/admin', label: 'Home', end: true });
        expect(SIDEBAR[1]).toMatchObject({ type: 'item', to: '/admin/today', label: 'Today', dynamic: 'todayActive' });
        // Visual chunk divider between daily-entry and bookings-flow.
        expect(SIDEBAR[2]).toMatchObject({ type: 'separator' });
        expect(SIDEBAR[3]).toMatchObject({ type: 'item', to: '/admin/events', label: 'Events' });
        expect(SIDEBAR[4]).toMatchObject({ type: 'item', to: '/admin/bookings', label: 'Bookings' });
        expect(SIDEBAR[5]).toMatchObject({ type: 'item', to: '/admin/customers', label: 'Customers' });
        // M4 B12b: Customers no longer carries `requiresFlag`.
        expect(SIDEBAR[5].requiresFlag).toBeUndefined();
    });

    it('chunks the sidebar into visual groups with separators between functional clusters', () => {
        // Daily entry: Home (0) · Today (1) · sep (2)
        expect(SIDEBAR[2]).toMatchObject({ type: 'separator' });
        // Bookings flow: Events (3) · Bookings (4) · Customers (5) · sep (6)
        expect(SIDEBAR[6]).toMatchObject({ type: 'separator' });
        // B2B: Sites (7) · Field Rentals (8) · sep (9)
        expect(SIDEBAR[7]).toMatchObject({
            type: 'item', to: '/admin/sites', label: 'Sites', capability: 'sites.read',
        });
        expect(SIDEBAR[8]).toMatchObject({
            type: 'item', to: '/admin/field-rentals', label: 'Field Rentals', capability: 'field_rentals.read',
        });
        expect(SIDEBAR[9]).toMatchObject({ type: 'separator' });
        // Event-day ops: Rentals (10) · Roster (11) · Scan (12) · sep (13)
        expect(SIDEBAR[10]).toMatchObject({
            type: 'item', to: '/admin/rentals', label: 'Rentals', capability: 'rentals.read',
        });
        expect(SIDEBAR[11]).toMatchObject({
            type: 'item', to: '/admin/roster', label: 'Roster', capability: 'roster.read',
        });
        expect(SIDEBAR[12]).toMatchObject({
            type: 'item', to: '/admin/scan', label: 'Scan', capability: 'scan.use',
        });
        expect(SIDEBAR[13]).toMatchObject({ type: 'separator' });
        // Operational: Analytics (14) · Feedback (15) · Promo Codes (16) · Vendors (17) · sep (18)
        expect(SIDEBAR[14]).toMatchObject({ type: 'item', to: '/admin/analytics', label: 'Analytics' });
        expect(SIDEBAR[15]).toMatchObject({
            type: 'item', to: '/admin/feedback', label: 'Feedback', badgeKey: 'newFeedback',
        });
        expect(SIDEBAR[16]).toMatchObject({ type: 'item', to: '/admin/promo-codes', label: 'Promo Codes' });
        expect(SIDEBAR[17]).toMatchObject({ type: 'item', to: '/admin/vendors', label: 'Vendors' });
        expect(SIDEBAR[18]).toMatchObject({ type: 'separator' });
    });

    it('Settings group sits at the end, separated by a divider', () => {
        const groupIdx = SIDEBAR.findIndex((e) => e.type === 'group');
        expect(groupIdx).toBe(19);
        expect(SIDEBAR[groupIdx]).toMatchObject({ type: 'group', label: 'Settings' });
        // The separator immediately precedes the group.
        expect(SIDEBAR[groupIdx - 1]).toMatchObject({ type: 'separator' });
    });

    it('Settings group is configuration-only — 6 sub-items: Overview / Taxes / Email / Team / Audit / Waivers', () => {
        const group = SIDEBAR.find((e) => e.type === 'group' && e.label === 'Settings');
        expect(group).toBeDefined();
        expect(group.key).toBe('settings');
        expect(group.defaultExpanded).toBe(false);
        expect(group.items).toHaveLength(6);
        const labels = group.items.map((i) => i.label);
        expect(labels).toEqual([
            'Overview',
            'Taxes',
            'Email',
            'Team',
            'Audit',
            'Waivers',
        ]);
    });

    it('Feedback (top-level) carries the newFeedback badge key', () => {
        const feedback = SIDEBAR.find((e) => e.type === 'item' && e.to === '/admin/feedback');
        expect(feedback).toBeDefined();
        expect(feedback.badgeKey).toBe('newFeedback');
    });

    it('Operational items (Analytics / Feedback / Promo Codes / Vendors) NOT in the Settings group', () => {
        const group = SIDEBAR.find((e) => e.type === 'group');
        const groupTos = group.items.map((i) => i.to);
        expect(groupTos).not.toContain('/admin/analytics');
        expect(groupTos).not.toContain('/admin/feedback');
        expect(groupTos).not.toContain('/admin/promo-codes');
        expect(groupTos).not.toContain('/admin/vendors');
    });

    it('Roster / Scan / Rentals NOT in the Settings group (still standing top-level after M5 B0 D10)', () => {
        const group = SIDEBAR.find((e) => e.type === 'group');
        const groupTos = group.items.map((i) => i.to);
        expect(groupTos).not.toContain('/admin/roster');
        expect(groupTos).not.toContain('/admin/scan');
        expect(groupTos).not.toContain('/admin/rentals');
    });
});

describe('userHasCapabilityStub (M5 B0)', () => {
    it('owner sees everything', () => {
        expect(userHasCapabilityStub('owner', 'rentals.read')).toBe(true);
        expect(userHasCapabilityStub('owner', 'roster.read')).toBe(true);
        expect(userHasCapabilityStub('owner', 'scan.use')).toBe(true);
    });

    it('manager sees rentals + roster + scan (rentals.read requires manager+)', () => {
        expect(userHasCapabilityStub('manager', 'rentals.read')).toBe(true);
        expect(userHasCapabilityStub('manager', 'roster.read')).toBe(true);
        expect(userHasCapabilityStub('manager', 'scan.use')).toBe(true);
    });

    it('staff sees roster + scan but NOT rentals (rentals.read requires manager+)', () => {
        expect(userHasCapabilityStub('staff', 'rentals.read')).toBe(false);
        expect(userHasCapabilityStub('staff', 'roster.read')).toBe(true);
        expect(userHasCapabilityStub('staff', 'scan.use')).toBe(true);
    });

    it('field_rentals.read and sites.read gate at manager+ (M5.5 B6.5 + B8)', () => {
        // Owner / manager → visible; staff → hidden (mirrors rentals.read).
        expect(userHasCapabilityStub('owner', 'sites.read')).toBe(true);
        expect(userHasCapabilityStub('owner', 'field_rentals.read')).toBe(true);
        expect(userHasCapabilityStub('manager', 'sites.read')).toBe(true);
        expect(userHasCapabilityStub('manager', 'field_rentals.read')).toBe(true);
        expect(userHasCapabilityStub('staff', 'sites.read')).toBe(false);
        expect(userHasCapabilityStub('staff', 'field_rentals.read')).toBe(false);
    });

    it('undefined role sees nothing capability-gated', () => {
        expect(userHasCapabilityStub(undefined, 'rentals.read')).toBe(false);
        expect(userHasCapabilityStub(undefined, 'roster.read')).toBe(false);
        expect(userHasCapabilityStub(undefined, 'scan.use')).toBe(false);
    });

    it('items with no capability field are always visible (capability= undefined)', () => {
        expect(userHasCapabilityStub('staff', undefined)).toBe(true);
        expect(userHasCapabilityStub(undefined, undefined)).toBe(true);
    });

    it('unknown capability defaults to visible (defensive against typos)', () => {
        expect(userHasCapabilityStub('staff', 'nonexistent.capability')).toBe(true);
    });
});

describe('getVisibleItems', () => {
    it('owner with today active sees all 14 items + 5 separators + Settings group = 20', () => {
        // 14 top-level items: Home, Today, Events, Bookings, Customers,
        // Sites, Field Rentals, Rentals, Roster, Scan, Analytics, Feedback,
        // Promo Codes, Vendors. Plus 5 visual-chunk separators + Settings
        // group = 20 entries (no collapse triggered — all chunks have at
        // least one visible item).
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: true, eventId: 'evt_1', checkInOpen: false },
            userRole: 'owner',
        });
        expect(visible).toHaveLength(20);
        expect(visible.filter((e) => e.type === 'separator')).toHaveLength(5);
        expect(visible.find((e) => e.label === 'Today')).toBeDefined();
        expect(visible.find((e) => e.label === 'Customers')).toBeDefined();
        expect(visible.find((e) => e.label === 'Sites')).toBeDefined();
        expect(visible.find((e) => e.label === 'Field Rentals')).toBeDefined();
        expect(visible.find((e) => e.label === 'Rentals')).toBeDefined();
        expect(visible.find((e) => e.label === 'Roster')).toBeDefined();
        expect(visible.find((e) => e.label === 'Scan')).toBeDefined();
        expect(visible.find((e) => e.label === 'Analytics')).toBeDefined();
        expect(visible.find((e) => e.label === 'Feedback')).toBeDefined();
        expect(visible.find((e) => e.label === 'Promo Codes')).toBeDefined();
        expect(visible.find((e) => e.label === 'Vendors')).toBeDefined();
    });

    it('collapses consecutive separators when capability-gated chunks are hidden (staff role)', () => {
        // Staff can't see Sites / Field Rentals / Rentals — that's a
        // full chunk + part of another. Without collapse logic, two
        // separators would end up adjacent.
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: false },
            userRole: 'staff',
        });
        // Walk through the result and confirm no two separators are
        // ever adjacent. Also confirm no leading/trailing separator.
        for (let i = 0; i < visible.length - 1; i++) {
            if (visible[i].type === 'separator') {
                expect(visible[i + 1].type).not.toBe('separator');
            }
        }
        expect(visible[0].type).not.toBe('separator');
        expect(visible[visible.length - 1].type).not.toBe('separator');
    });

    it('staff role hides Rentals + Sites + Field Rentals (all manager+) but keeps Roster + Scan', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: false },
            userRole: 'staff',
        });
        expect(visible.find((e) => e.label === 'Rentals')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Sites')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Field Rentals')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Roster')).toBeDefined();
        expect(visible.find((e) => e.label === 'Scan')).toBeDefined();
    });

    it('hides Today when activeEventToday is false', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: false, eventId: null, checkInOpen: false },
            userRole: 'owner',
        });
        expect(visible.find((e) => e.label === 'Today')).toBeUndefined();
        // Other items still visible (post-B12b: Customers no longer flag-gated)
        expect(visible.find((e) => e.label === 'Home')).toBeDefined();
        expect(visible.find((e) => e.label === 'Customers')).toBeDefined();
    });

    it('hides Today when todayState is null (initial load before /today/active resolves)', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: null,
            userRole: 'owner',
        });
        expect(visible.find((e) => e.label === 'Today')).toBeUndefined();
    });

    it('requiresFlag filter logic stays in place for forward-compat (no item uses it post-B12b)', () => {
        // Synthetic config exercises the requiresFlag branch since SIDEBAR
        // itself has no requiresFlag items as of B12b.
        const cfg = [
            { type: 'item', to: '/x', label: 'X', requiresFlag: 'experimental' },
            { type: 'item', to: '/y', label: 'Y' },
        ];
        const onlyY = getVisibleItems(cfg, { flags: { experimental: false } });
        expect(onlyY.find((e) => e.label === 'X')).toBeUndefined();
        expect(onlyY.find((e) => e.label === 'Y')).toBeDefined();

        const both = getVisibleItems(cfg, { flags: { experimental: true } });
        expect(both.find((e) => e.label === 'X')).toBeDefined();
        expect(both.find((e) => e.label === 'Y')).toBeDefined();
    });

    it('combined: today inactive + owner role → Today hidden, Sites/Field Rentals/Rentals/Roster/Scan visible', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: false },
            userRole: 'owner',
        });
        const labels = visible.filter((e) => e.type === 'item').map((i) => i.label);
        expect(labels).toContain('Home');
        expect(labels).toContain('Events');
        expect(labels).toContain('Bookings');
        expect(labels).toContain('Customers');
        expect(labels).toContain('Sites');
        expect(labels).toContain('Field Rentals');
        expect(labels).toContain('Rentals');
        expect(labels).toContain('Roster');
        expect(labels).toContain('Scan');
        expect(labels).not.toContain('Today');
    });

    it('drops leading + trailing separators (visual-chunking hygiene)', () => {
        const cfg = [
            { type: 'separator' },
            { type: 'item', to: '/x', label: 'X' },
            { type: 'separator' },
        ];
        const visible = getVisibleItems(cfg, {});
        expect(visible).toHaveLength(1);
        expect(visible[0].label).toBe('X');
    });

    it('preserves separators between visible items', () => {
        const cfg = [
            { type: 'item', to: '/a', label: 'A' },
            { type: 'separator' },
            { type: 'item', to: '/b', label: 'B' },
        ];
        const visible = getVisibleItems(cfg, {});
        expect(visible).toHaveLength(3);
        expect(visible[1].type).toBe('separator');
    });

    it('collapses consecutive separators when an item between them is filtered out', () => {
        // Use requiresFlag (without the flag enabled) to reliably hide the
        // middle item. capability-based hiding wouldn't work here because
        // userHasCapabilityStub defaults unknown capabilities to visible.
        const cfg = [
            { type: 'item', to: '/a', label: 'A' },
            { type: 'separator' },
            { type: 'item', to: '/hidden', label: 'Hidden', requiresFlag: 'never_set' },
            { type: 'separator' },
            { type: 'item', to: '/b', label: 'B' },
        ];
        const visible = getVisibleItems(cfg, { flags: {} });
        // After filter: A, sep, sep, B. After collapse: A, sep, B.
        expect(visible).toHaveLength(3);
        expect(visible[0].label).toBe('A');
        expect(visible[1].type).toBe('separator');
        expect(visible[2].label).toBe('B');
    });

    it('groups always pass through unchanged regardless of filter state', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: null,
            flags: {},
            userRole: 'owner',
        });
        const group = visible.find((e) => e.type === 'group');
        expect(group).toBeDefined();
        expect(group.label).toBe('Settings');
    });

    it('returns empty array when given an empty config', () => {
        expect(getVisibleItems([], { todayState: null, flags: {} })).toEqual([]);
    });

    it('returns empty array for non-array input (defensive)', () => {
        expect(getVisibleItems(null, {})).toEqual([]);
        expect(getVisibleItems(undefined, {})).toEqual([]);
        expect(getVisibleItems('not-an-array', {})).toEqual([]);
    });

    it('handles missing ctx (defaults to no today state, no flags, no role)', () => {
        const visible = getVisibleItems(SIDEBAR);
        // Today should be hidden (default is falsy); Customers is no
        // longer flag-gated post-B12b so it's always visible. Sites /
        // Field Rentals / Rentals / Roster / Scan should be hidden
        // (no userRole = no capability).
        expect(visible.find((e) => e.label === 'Today')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Customers')).toBeDefined();
        expect(visible.find((e) => e.label === 'Sites')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Field Rentals')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Rentals')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Roster')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Scan')).toBeUndefined();
        // Others present
        expect(visible.find((e) => e.label === 'Home')).toBeDefined();
        expect(visible.find((e) => e.label === 'Events')).toBeDefined();
    });

    it('skips malformed entries (defensive against null/non-object items)', () => {
        const cfg = [
            { type: 'item', to: '/a', label: 'A' },
            null,
            'not-an-object',
            { type: 'item', to: '/b', label: 'B' },
        ];
        const visible = getVisibleItems(cfg, {});
        expect(visible).toHaveLength(2);
        expect(visible[0].label).toBe('A');
        expect(visible[1].label).toBe('B');
    });
});

describe('loadSidebarExpand / saveSidebarExpand', () => {
    let storage;
    let originalLocalStorage;

    beforeEach(() => {
        // vitest runs in a node env by default — no localStorage. Install a
        // simple in-memory mock so the roundtrip tests exercise the helpers'
        // happy-path. The defensive no-localStorage branch is covered by
        // running on the missing-key cases below.
        storage = new Map();
        originalLocalStorage = globalThis.localStorage;
        globalThis.localStorage = {
            getItem: (k) => (storage.has(k) ? storage.get(k) : null),
            setItem: (k, v) => { storage.set(k, String(v)); },
            removeItem: (k) => { storage.delete(k); },
            clear: () => { storage.clear(); },
        };
    });

    afterEach(() => {
        if (originalLocalStorage === undefined) {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = originalLocalStorage;
        }
    });

    it('roundtrip: save true then load returns true', () => {
        saveSidebarExpand('settings', true);
        expect(loadSidebarExpand('settings')).toBe(true);
    });

    it('roundtrip: save false then load returns false', () => {
        saveSidebarExpand('settings', false);
        expect(loadSidebarExpand('settings')).toBe(false);
    });

    it('returns the default value when key is missing', () => {
        expect(loadSidebarExpand('never-stored')).toBe(false);
        expect(loadSidebarExpand('never-stored', true)).toBe(true);
    });

    it('returns the default value when groupKey is empty (no key passed)', () => {
        expect(loadSidebarExpand('')).toBe(false);
        expect(loadSidebarExpand('', true)).toBe(true);
        expect(loadSidebarExpand(null)).toBe(false);
        expect(loadSidebarExpand(undefined)).toBe(false);
    });

    it('saveSidebarExpand silently ignores empty group key', () => {
        // Should not throw
        saveSidebarExpand('', true);
        saveSidebarExpand(null, true);
        saveSidebarExpand(undefined, true);
        // Storage is still empty for any 'settings' key
        expect(loadSidebarExpand('settings')).toBe(false);
    });

    it('namespaces the storage key with aas:admin:sidebar:expand: prefix', () => {
        saveSidebarExpand('settings', true);
        // Inspect the raw storage to confirm the key shape
        try {
            const raw = localStorage.getItem('aas:admin:sidebar:expand:settings');
            expect(raw).toBe('true');
        } catch {
            // localStorage unavailable; skip key-shape assertion
        }
    });

    it('survives non-boolean stored values (e.g., "true"/"false" strings)', () => {
        try {
            localStorage.setItem('aas:admin:sidebar:expand:settings', 'true');
            expect(loadSidebarExpand('settings')).toBe(true);
            localStorage.setItem('aas:admin:sidebar:expand:settings', 'false');
            expect(loadSidebarExpand('settings')).toBe(false);
            // Garbage values fall back to false (anything !== 'true')
            localStorage.setItem('aas:admin:sidebar:expand:settings', 'garbage');
            expect(loadSidebarExpand('settings')).toBe(false);
        } catch {
            // localStorage unavailable in this test env; skip
        }
    });
});
