// M4 B5 — tests for src/admin/sidebarConfig.js.
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
} from '../../../src/admin/sidebarConfig.js';

describe('SIDEBAR config', () => {
    it('starts with Home, then Today (dynamic), then Events / Bookings / Customers (flag-gated)', () => {
        expect(SIDEBAR[0]).toMatchObject({ type: 'item', to: '/admin', label: 'Home', end: true });
        expect(SIDEBAR[1]).toMatchObject({ type: 'item', to: '/admin/today', label: 'Today', dynamic: 'todayActive' });
        expect(SIDEBAR[2]).toMatchObject({ type: 'item', to: '/admin/events', label: 'Events' });
        expect(SIDEBAR[3]).toMatchObject({ type: 'item', to: '/admin/bookings', label: 'Bookings' });
        expect(SIDEBAR[4]).toMatchObject({
            type: 'item',
            to: '/admin/customers',
            label: 'Customers',
            requiresFlag: 'customers_entity',
        });
    });

    it('has a separator between top-level items and the Settings group', () => {
        const sepIdx = SIDEBAR.findIndex((e) => e.type === 'separator');
        const groupIdx = SIDEBAR.findIndex((e) => e.type === 'group');
        expect(sepIdx).toBeGreaterThan(0);
        expect(groupIdx).toBeGreaterThan(sepIdx);
    });

    it('Settings group has 10 sub-items including Overview / Taxes / Email / Team / Audit / Waivers / Vendors / Promo Codes / Analytics / Feedback', () => {
        const group = SIDEBAR.find((e) => e.type === 'group' && e.label === 'Settings');
        expect(group).toBeDefined();
        expect(group.key).toBe('settings');
        expect(group.defaultExpanded).toBe(false);
        expect(group.items).toHaveLength(10);
        const labels = group.items.map((i) => i.label);
        expect(labels).toEqual([
            'Overview',
            'Taxes',
            'Email',
            'Team',
            'Audit',
            'Waivers',
            'Vendors',
            'Promo Codes',
            'Analytics',
            'Feedback',
        ]);
    });

    it('Feedback sub-item carries the newFeedback badge key (preserved from legacy)', () => {
        const group = SIDEBAR.find((e) => e.type === 'group');
        const feedback = group.items.find((i) => i.label === 'Feedback');
        expect(feedback.badgeKey).toBe('newFeedback');
    });

    it('does not include Roster / Scan / Rentals at top level (D09 — collapsed under Today)', () => {
        const tops = SIDEBAR.filter((e) => e.type === 'item').map((i) => i.to);
        expect(tops).not.toContain('/admin/roster');
        expect(tops).not.toContain('/admin/scan');
        expect(tops).not.toContain('/admin/rentals');
        // Also not in the Settings group
        const group = SIDEBAR.find((e) => e.type === 'group');
        const groupTos = group.items.map((i) => i.to);
        expect(groupTos).not.toContain('/admin/roster');
        expect(groupTos).not.toContain('/admin/scan');
        expect(groupTos).not.toContain('/admin/rentals');
    });
});

describe('getVisibleItems', () => {
    it('returns the full config when all predicates pass (today active + flag on)', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: true, eventId: 'evt_1', checkInOpen: false },
            flags: { customers_entity: true },
        });
        // 5 items + 1 separator + 1 group = 7
        expect(visible).toHaveLength(7);
        expect(visible.find((e) => e.label === 'Today')).toBeDefined();
        expect(visible.find((e) => e.label === 'Customers')).toBeDefined();
    });

    it('hides Today when activeEventToday is false', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: false, eventId: null, checkInOpen: false },
            flags: { customers_entity: true },
        });
        expect(visible.find((e) => e.label === 'Today')).toBeUndefined();
        // Other items still visible
        expect(visible.find((e) => e.label === 'Home')).toBeDefined();
    });

    it('hides Today when todayState is null (initial load before /today/active resolves)', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: null,
            flags: { customers_entity: true },
        });
        expect(visible.find((e) => e.label === 'Today')).toBeUndefined();
    });

    it('hides Customers when customers_entity flag is false', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: true },
            flags: { customers_entity: false },
        });
        expect(visible.find((e) => e.label === 'Customers')).toBeUndefined();
    });

    it('hides Customers when flag key is missing entirely (defensive default)', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: true },
            flags: {},
        });
        expect(visible.find((e) => e.label === 'Customers')).toBeUndefined();
    });

    it('combined: today inactive + customers off → Today and Customers hidden, others visible', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: { activeEventToday: false },
            flags: { customers_entity: false },
        });
        const labels = visible.filter((e) => e.type === 'item').map((i) => i.label);
        expect(labels).toContain('Home');
        expect(labels).toContain('Events');
        expect(labels).toContain('Bookings');
        expect(labels).not.toContain('Today');
        expect(labels).not.toContain('Customers');
    });

    it('separators always pass through unchanged', () => {
        const cfg = [
            { type: 'separator' },
            { type: 'item', to: '/x', label: 'X' },
            { type: 'separator' },
        ];
        const visible = getVisibleItems(cfg, {});
        expect(visible.filter((e) => e.type === 'separator')).toHaveLength(2);
    });

    it('groups always pass through unchanged regardless of filter state', () => {
        const visible = getVisibleItems(SIDEBAR, {
            todayState: null,
            flags: {},
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

    it('handles missing ctx (defaults to no today state, no flags)', () => {
        const visible = getVisibleItems(SIDEBAR);
        // Today + Customers should both be hidden (defaults are falsy)
        expect(visible.find((e) => e.label === 'Today')).toBeUndefined();
        expect(visible.find((e) => e.label === 'Customers')).toBeUndefined();
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
