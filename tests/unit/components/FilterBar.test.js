// Tests for FilterBar's pure logic helpers (getActiveChips,
// filterAvailableFilters). The component itself is thin JSX over these
// helpers and the useSavedViews hook (whose pure helpers are tested
// alongside).
//
// Why pure-helper tests instead of component-render tests: keeps M2
// dependency-light (no @testing-library/react / jsdom). The component's
// JSX is small enough to verify by eye + via AdminFeedback integration.

import { describe, it, expect } from 'vitest';
import {
    getActiveChips,
    filterAvailableFilters,
} from '../../../src/components/admin/FilterBar.jsx';
import { loadViews, saveViews } from '../../../src/hooks/useSavedViews.js';

const SCHEMA = [
    {
        key: 'status',
        label: 'Status',
        type: 'enum',
        options: [
            { value: 'new', label: 'New' },
            { value: 'triaged', label: 'Triaged' },
            { value: 'in-progress', label: 'In progress' },
            { value: 'resolved', label: 'Resolved' },
        ],
    },
    {
        key: 'type',
        label: 'Type',
        type: 'enum',
        options: [
            { value: 'bug', label: 'Bug' },
            { value: 'idea', label: 'Idea' },
        ],
    },
    {
        key: 'priority',
        label: 'Priority',
        type: 'enum',
        options: [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
        ],
    },
    { key: 'archived', label: 'Archived', type: 'bool' },
    { key: 'price', label: 'Price', type: 'range' },
];

describe('getActiveChips', () => {
    it('returns empty array when no filters are active', () => {
        expect(getActiveChips({}, SCHEMA)).toEqual([]);
    });

    it('returns one chip per active enum filter, with display value from option label', () => {
        const result = getActiveChips({ status: 'new', type: 'bug' }, SCHEMA);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ key: 'status', label: 'Status', displayValue: 'New' });
        expect(result[1]).toMatchObject({ key: 'type', label: 'Type', displayValue: 'Bug' });
    });

    it('skips empty-string filter values', () => {
        const result = getActiveChips({ status: '', type: 'bug', priority: '' }, SCHEMA);
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('type');
    });

    it('skips empty arrays for multi-select enum', () => {
        const result = getActiveChips({ status: [], type: 'bug' }, SCHEMA);
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('type');
    });

    it('joins multi-select enum values with comma in displayValue', () => {
        const result = getActiveChips({ status: ['new', 'triaged'] }, SCHEMA);
        expect(result).toHaveLength(1);
        expect(result[0].displayValue).toBe('New, Triaged');
    });

    it('falls back to raw value when option is not in schema', () => {
        const result = getActiveChips({ status: 'unknown-status' }, SCHEMA);
        expect(result[0].displayValue).toBe('unknown-status');
    });

    it('skips bool=false (not active) and renders Yes/No for bool=true', () => {
        expect(getActiveChips({ archived: false }, SCHEMA)).toEqual([]);
        const truthy = getActiveChips({ archived: true }, SCHEMA);
        expect(truthy).toHaveLength(1);
        expect(truthy[0].displayValue).toBe('Yes');
    });

    it('formats range as "min–max"', () => {
        const result = getActiveChips({ price: ['10', '50'] }, SCHEMA);
        expect(result).toHaveLength(1);
        expect(result[0].displayValue).toBe('10–50');
    });
});

describe('filterAvailableFilters', () => {
    it('returns all filters when no active filters and no query', () => {
        const result = filterAvailableFilters('', SCHEMA, {});
        expect(result).toHaveLength(SCHEMA.length);
    });

    it('excludes already-active filters', () => {
        const result = filterAvailableFilters('', SCHEMA, { status: 'new' });
        expect(result.map((f) => f.key)).not.toContain('status');
        expect(result).toHaveLength(SCHEMA.length - 1);
    });

    it('matches by label substring (case-insensitive)', () => {
        const result = filterAvailableFilters('prio', SCHEMA, {});
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('priority');
    });

    it('returns empty when query matches nothing', () => {
        expect(filterAvailableFilters('xyz-nope', SCHEMA, {})).toEqual([]);
    });

    it('treats empty array values as inactive (filter still available)', () => {
        const result = filterAvailableFilters('', SCHEMA, { status: [] });
        expect(result.map((f) => f.key)).toContain('status');
    });

    it('treats bool=false as inactive (filter still available)', () => {
        const result = filterAvailableFilters('', SCHEMA, { archived: false });
        expect(result.map((f) => f.key)).toContain('archived');
    });

    it('exposes non-enum types in the picker (typeahead/date/bool/range get a TODO indicator at render time)', () => {
        // The component renders non-enum types as a "(coming in M3+)" placeholder
        // (see FilterBar.jsx FilterPicker). The pure helper just lists them as
        // available; the component is what shows the TODO.
        const all = filterAvailableFilters('', SCHEMA, {});
        const types = all.map((f) => f.type);
        expect(types).toContain('enum');
        expect(types).toContain('bool');
        expect(types).toContain('range');
    });
});

describe('useSavedViews pure helpers', () => {
    function makeFakeStorage(initial = {}) {
        const store = { ...initial };
        return {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => {
                store[k] = String(v);
            },
            removeItem: (k) => {
                delete store[k];
            },
            __raw: () => ({ ...store }),
        };
    }

    it('loadViews returns [] when key is missing', () => {
        const storage = makeFakeStorage();
        expect(loadViews('adminFeedback', storage)).toEqual([]);
    });

    it('loadViews parses a JSON array', () => {
        const storage = makeFakeStorage({
            'aas:savedViews:adminFeedback': JSON.stringify([
                { name: 'Open bugs', filters: { status: 'new', type: 'bug' } },
            ]),
        });
        const result = loadViews('adminFeedback', storage);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Open bugs');
    });

    it('loadViews returns [] on malformed JSON', () => {
        const storage = makeFakeStorage({
            'aas:savedViews:adminFeedback': '{not json',
        });
        expect(loadViews('adminFeedback', storage)).toEqual([]);
    });

    it('loadViews returns [] when stored value is not an array', () => {
        const storage = makeFakeStorage({
            'aas:savedViews:adminFeedback': JSON.stringify({ not: 'array' }),
        });
        expect(loadViews('adminFeedback', storage)).toEqual([]);
    });

    it('saveViews writes the JSON-serialized array under the prefixed key', () => {
        const storage = makeFakeStorage();
        const views = [{ name: 'X', filters: { status: 'new' } }];
        saveViews('adminFeedback', views, storage);
        const raw = storage.__raw()['aas:savedViews:adminFeedback'];
        expect(JSON.parse(raw)).toEqual(views);
    });

    it('saveViews + loadViews round-trip', () => {
        const storage = makeFakeStorage();
        const views = [
            { name: 'Open bugs', filters: { status: 'new', type: 'bug' } },
            { name: 'My triaged', filters: { status: 'triaged' } },
        ];
        saveViews('adminFeedback', views, storage);
        expect(loadViews('adminFeedback', storage)).toEqual(views);
    });

    it('namespaces by page so two pages do not collide', () => {
        const storage = makeFakeStorage();
        saveViews('adminFeedback', [{ name: 'A', filters: {} }], storage);
        saveViews('adminBookings', [{ name: 'B', filters: {} }], storage);
        expect(loadViews('adminFeedback', storage)[0].name).toBe('A');
        expect(loadViews('adminBookings', storage)[0].name).toBe('B');
    });

    it('handles missing page (returns []) and missing storage (no-op)', () => {
        expect(loadViews('', makeFakeStorage())).toEqual([]);
        expect(loadViews('adminFeedback', null)).toEqual([]);
        // saveViews with null storage should be a no-op (not throw)
        expect(() => saveViews('adminFeedback', [], null)).not.toThrow();
    });
});
