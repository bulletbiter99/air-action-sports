// Tests for useFilterState's pure helpers (encodeFilters, parseFilters).
// The hook itself is thin glue around them + window.history.replaceState.

import { describe, it, expect } from 'vitest';
import {
    encodeFilters,
    parseFilters,
} from '../../../src/hooks/useFilterState.js';

const SCHEMA = [
    {
        key: 'status',
        label: 'Status',
        type: 'enum',
        options: [
            { value: 'new', label: 'New' },
            { value: 'triaged', label: 'Triaged' },
        ],
    },
    { key: 'q', label: 'Search', type: 'text' },
    { key: 'flag', label: 'Flag', type: 'bool' },
    { key: 'price', label: 'Price', type: 'range' },
];

describe('encodeFilters', () => {
    it('returns empty string when no filters set', () => {
        expect(encodeFilters({}, SCHEMA)).toBe('');
    });

    it('encodes single enum value as ?key=value', () => {
        expect(encodeFilters({ status: 'new' }, SCHEMA)).toBe('status=new');
    });

    it('encodes multi-value enum as repeated ?key=v1&key=v2', () => {
        expect(encodeFilters({ status: ['new', 'triaged'] }, SCHEMA)).toBe(
            'status=new&status=triaged',
        );
    });

    it('skips empty strings', () => {
        expect(encodeFilters({ status: 'new', q: '' }, SCHEMA)).toBe('status=new');
    });

    it('skips empty arrays', () => {
        expect(encodeFilters({ status: [], q: 'x' }, SCHEMA)).toBe('q=x');
    });

    it('skips null and undefined', () => {
        expect(encodeFilters({ status: null, q: 'x' }, SCHEMA)).toBe('q=x');
        expect(encodeFilters({ status: undefined, q: 'x' }, SCHEMA)).toBe('q=x');
    });

    it('skips false bool, encodes true bool as 1', () => {
        expect(encodeFilters({ flag: false }, SCHEMA)).toBe('');
        expect(encodeFilters({ flag: true }, SCHEMA)).toBe('flag=1');
    });

    it('encodes range as comma-joined min,max (URL-encoded comma is %2C)', () => {
        expect(encodeFilters({ price: ['10', '500'] }, SCHEMA)).toBe('price=10%2C500');
    });

    it('URL-encodes special characters in values', () => {
        expect(encodeFilters({ q: 'hello world' }, SCHEMA)).toBe('q=hello+world');
        expect(encodeFilters({ q: 'a&b' }, SCHEMA)).toBe('q=a%26b');
    });
});

describe('parseFilters', () => {
    it('returns empty object on empty input', () => {
        expect(parseFilters('', SCHEMA)).toEqual({});
        expect(parseFilters('?', SCHEMA)).toEqual({});
    });

    it('accepts both leading "?" and bare query strings', () => {
        expect(parseFilters('?status=new', SCHEMA)).toEqual({ status: 'new' });
        expect(parseFilters('status=new', SCHEMA)).toEqual({ status: 'new' });
    });

    it('parses single-value enum as scalar string', () => {
        expect(parseFilters('?status=new', SCHEMA)).toEqual({ status: 'new' });
    });

    it('parses multi-value enum (same key repeated) as array', () => {
        expect(parseFilters('?status=new&status=triaged', SCHEMA)).toEqual({
            status: ['new', 'triaged'],
        });
    });

    it('parses bool=1 as true, omits when key is absent', () => {
        expect(parseFilters('?flag=1', SCHEMA)).toEqual({ flag: true });
        expect(parseFilters('?status=new', SCHEMA)).toEqual({ status: 'new' });
    });

    it('parses bool=0 (or anything other than "1") as false', () => {
        expect(parseFilters('?flag=0', SCHEMA)).toEqual({ flag: false });
        expect(parseFilters('?flag=', SCHEMA)).toEqual({ flag: false });
    });

    it('ignores keys not present in the schema', () => {
        expect(parseFilters('?unknown=x&status=new', SCHEMA)).toEqual({ status: 'new' });
    });

    it('parses range as a [min, max] tuple of strings', () => {
        expect(parseFilters('?price=10%2C500', SCHEMA)).toEqual({ price: ['10', '500'] });
    });

    it('returns [] for malformed range (missing comma)', () => {
        expect(parseFilters('?price=onlyone', SCHEMA)).toEqual({ price: [] });
    });
});

describe('encodeFilters + parseFilters round-trip', () => {
    it('round-trips a non-trivial filter set (excluding range URL-encoding asymmetry)', () => {
        const filters = { status: 'new', q: 'hello', flag: true };
        const qs = encodeFilters(filters, SCHEMA);
        expect(parseFilters('?' + qs, SCHEMA)).toEqual(filters);
    });

    it('round-trips multi-value enum', () => {
        const filters = { status: ['new', 'triaged'] };
        const qs = encodeFilters(filters, SCHEMA);
        expect(parseFilters('?' + qs, SCHEMA)).toEqual(filters);
    });

    it('round-trips range', () => {
        const filters = { price: ['10', '500'] };
        const qs = encodeFilters(filters, SCHEMA);
        expect(parseFilters('?' + qs, SCHEMA)).toEqual(filters);
    });

    it('round-trips an empty filter set', () => {
        expect(parseFilters('?' + encodeFilters({}, SCHEMA), SCHEMA)).toEqual({});
    });
});
