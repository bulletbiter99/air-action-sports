// Tests for AdminPageHeader's pure helper. The component layer is
// thin presentational JSX over this helper plus props passthrough.
// We follow the FilterBar precedent: pure helpers tested here,
// component correctness verified by integration in the 16 admin pages
// that adopt it across M5 R0a/R0b/R0c.

import { describe, it, expect } from 'vitest';
import { buildBreadcrumbItems } from '../../../src/components/admin/AdminPageHeader.jsx';

describe('buildBreadcrumbItems', () => {
    it('returns an empty array for non-array input', () => {
        expect(buildBreadcrumbItems(null)).toEqual([]);
        expect(buildBreadcrumbItems(undefined)).toEqual([]);
        expect(buildBreadcrumbItems('not an array')).toEqual([]);
        expect(buildBreadcrumbItems({ label: 'Settings' })).toEqual([]);
        expect(buildBreadcrumbItems(42)).toEqual([]);
    });

    it('passes through { label, to } items in order', () => {
        const result = buildBreadcrumbItems([
            { label: 'Settings', to: '/admin/settings' },
            { label: 'Audit Log' },
        ]);
        expect(result).toEqual([
            { label: 'Settings', to: '/admin/settings' },
            { label: 'Audit Log' },
        ]);
    });

    it('coerces string entries to { label }', () => {
        expect(buildBreadcrumbItems(['Home', 'Settings'])).toEqual([
            { label: 'Home' },
            { label: 'Settings' },
        ]);
    });

    it('trims whitespace from label strings', () => {
        expect(
            buildBreadcrumbItems([
                { label: '  Settings  ', to: '/admin/settings' },
                '  Audit Log  ',
            ])
        ).toEqual([
            { label: 'Settings', to: '/admin/settings' },
            { label: 'Audit Log' },
        ]);
    });

    it('strips items without a usable label', () => {
        expect(
            buildBreadcrumbItems([
                { label: '' },
                { label: '   ' },
                { to: '/no-label' },
                { label: null },
                {},
            ])
        ).toEqual([]);
    });

    it('strips empty / whitespace-only string entries', () => {
        expect(buildBreadcrumbItems(['', '  ', 'Real'])).toEqual([{ label: 'Real' }]);
    });

    it('filters out null and undefined entries', () => {
        expect(
            buildBreadcrumbItems([
                null,
                { label: 'A' },
                undefined,
                { label: 'B', to: '/b' },
                null,
            ])
        ).toEqual([
            { label: 'A' },
            { label: 'B', to: '/b' },
        ]);
    });

    it('filters out non-object, non-string entries', () => {
        expect(
            buildBreadcrumbItems([42, true, { label: 'A' }, () => {}, Symbol('x')])
        ).toEqual([{ label: 'A' }]);
    });

    it('coerces non-string label values to string', () => {
        expect(
            buildBreadcrumbItems([
                { label: 42 },
                { label: 123, to: '/x' },
            ])
        ).toEqual([
            { label: '42' },
            { label: '123', to: '/x' },
        ]);
    });

    it('coerces non-string to values to string', () => {
        // ESLint may complain about object label vs primitive; the helper
        // String()-coerces to keep the contract stable.
        expect(buildBreadcrumbItems([{ label: 'A', to: 99 }])).toEqual([
            { label: 'A', to: '99' },
        ]);
    });

    it('preserves item order', () => {
        const result = buildBreadcrumbItems([
            { label: 'First' },
            { label: 'Second' },
            { label: 'Third', to: '/3' },
        ]);
        expect(result.map((i) => i.label)).toEqual(['First', 'Second', 'Third']);
    });

    it('works with an empty array (no crash)', () => {
        expect(buildBreadcrumbItems([])).toEqual([]);
    });
});
