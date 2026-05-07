// M4 B7 — tests for src/admin/commandRegistry.js (pure helpers).
//
// commandsFromSidebar derives a flat command list from the SIDEBAR
// config (single source of truth for nav). filterCommands does a
// case-insensitive substring match with prefix-priority sort.

import { describe, it, expect } from 'vitest';
import {
    commandsFromSidebar,
    filterCommands,
} from '../../../src/admin/commandRegistry.js';
import { SIDEBAR } from '../../../src/admin/sidebarConfig.js';

describe('commandsFromSidebar', () => {
    it('produces commands for top-level items + group sub-items', () => {
        const commands = commandsFromSidebar(SIDEBAR, {
            todayState: { activeEventToday: true },
            flags: { customers_entity: true },
        });
        const labels = commands.map((c) => c.label);
        // Top-level items
        expect(labels).toContain('Home');
        expect(labels).toContain('Today');
        expect(labels).toContain('Events');
        expect(labels).toContain('Bookings');
        expect(labels).toContain('Customers');
        // Settings sub-items rendered as "Settings · X"
        expect(labels).toContain('Settings · Overview');
        expect(labels).toContain('Settings · Taxes');
        expect(labels).toContain('Settings · Email');
        expect(labels).toContain('Settings · Team');
        expect(labels).toContain('Settings · Audit');
        expect(labels).toContain('Settings · Waivers');
        expect(labels).toContain('Settings · Vendors');
        expect(labels).toContain('Settings · Promo Codes');
        expect(labels).toContain('Settings · Analytics');
        expect(labels).toContain('Settings · Feedback');
    });

    it('hides Today when activeEventToday=false', () => {
        const commands = commandsFromSidebar(SIDEBAR, {
            todayState: { activeEventToday: false },
            flags: { customers_entity: true },
        });
        expect(commands.find((c) => c.label === 'Today')).toBeUndefined();
    });

    it('hides Customers when customers_entity flag is off', () => {
        const commands = commandsFromSidebar(SIDEBAR, {
            todayState: { activeEventToday: true },
            flags: { customers_entity: false },
        });
        expect(commands.find((c) => c.label === 'Customers')).toBeUndefined();
        // Other top-level still present
        expect(commands.find((c) => c.label === 'Home')).toBeDefined();
    });

    it('marks top-level commands with category "Nav"', () => {
        const commands = commandsFromSidebar(SIDEBAR, {
            todayState: { activeEventToday: true },
            flags: { customers_entity: true },
        });
        const home = commands.find((c) => c.label === 'Home');
        expect(home.category).toBe('Nav');
    });

    it('marks group sub-items with the group label as category', () => {
        const commands = commandsFromSidebar(SIDEBAR, {
            todayState: null,
            flags: {},
        });
        const taxes = commands.find((c) => c.label === 'Settings · Taxes');
        expect(taxes.category).toBe('Settings');
    });

    it('preserves the `to` route + `end` flag', () => {
        const commands = commandsFromSidebar(SIDEBAR, {
            todayState: null,
            flags: {},
        });
        const home = commands.find((c) => c.label === 'Home');
        expect(home.to).toBe('/admin');
        expect(home.end).toBe(true);
        const events = commands.find((c) => c.label === 'Events');
        expect(events.to).toBe('/admin/events');
        expect(events.end).toBe(false);
    });

    it('skips separators', () => {
        const commands = commandsFromSidebar(SIDEBAR, {
            todayState: null,
            flags: {},
        });
        // No command should have type 'separator' (our commands don't have type;
        // the separator passes through getVisibleItems but commandsFromSidebar
        // skips it explicitly).
        const sep = commands.find((c) => !c.label);
        expect(sep).toBeUndefined();
    });

    it('returns empty array for empty/null sidebar', () => {
        expect(commandsFromSidebar([], {})).toEqual([]);
        expect(commandsFromSidebar(null, {})).toEqual([]);
        expect(commandsFromSidebar(undefined, {})).toEqual([]);
    });

    it('handles missing ctx (defaults to no today, no flags)', () => {
        const commands = commandsFromSidebar(SIDEBAR);
        // Today + Customers should be hidden
        expect(commands.find((c) => c.label === 'Today')).toBeUndefined();
        expect(commands.find((c) => c.label === 'Customers')).toBeUndefined();
        // Others present
        expect(commands.find((c) => c.label === 'Home')).toBeDefined();
    });
});

describe('filterCommands', () => {
    const commands = [
        { label: 'Home', to: '/admin' },
        { label: 'Bookings', to: '/admin/bookings' },
        { label: 'Settings · Bookings export', to: '/admin/settings/bookings-export' },
        { label: 'Events', to: '/admin/events' },
        { label: 'Settings · Audit', to: '/admin/audit-log' },
    ];

    it('returns full list (copy) for empty query', () => {
        expect(filterCommands(commands, '')).toEqual(commands);
        expect(filterCommands(commands, '   ')).toEqual(commands);
    });

    it('returns full list (copy) for null/undefined query', () => {
        expect(filterCommands(commands, null)).toEqual(commands);
        expect(filterCommands(commands, undefined)).toEqual(commands);
    });

    it('does case-insensitive substring matching', () => {
        const result = filterCommands(commands, 'BOOK');
        expect(result.map((c) => c.label)).toContain('Bookings');
        expect(result.map((c) => c.label)).toContain('Settings · Bookings export');
    });

    it('puts prefix matches first, then substring matches', () => {
        const result = filterCommands(commands, 'book');
        // "Bookings" starts with "book" → first
        // "Settings · Bookings export" contains "book" but doesn't start → after
        expect(result[0].label).toBe('Bookings');
        expect(result[1].label).toBe('Settings · Bookings export');
    });

    it('returns empty array when no matches', () => {
        expect(filterCommands(commands, 'xyz123notthere')).toEqual([]);
    });

    it('trims whitespace from query', () => {
        expect(filterCommands(commands, '  home  ')).toEqual([
            { label: 'Home', to: '/admin' },
        ]);
    });

    it('returns empty array for non-array input (defensive)', () => {
        expect(filterCommands(null, 'x')).toEqual([]);
        expect(filterCommands(undefined, 'x')).toEqual([]);
        expect(filterCommands('not-array', 'x')).toEqual([]);
    });

    it('skips entries with non-string labels (defensive)', () => {
        const bad = [
            { label: 'Good', to: '/x' },
            { label: 42, to: '/y' },
            { to: '/z' },
            null,
        ];
        const result = filterCommands(bad, 'good');
        expect(result.map((c) => c.to)).toEqual(['/x']);
    });

    it('handles empty commands array', () => {
        expect(filterCommands([], 'home')).toEqual([]);
    });
});
