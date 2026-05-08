// Tests for EmptyState's pure helper. The component layer is thin
// presentational JSX over this helper. Following the FilterBar
// precedent: pure helpers tested here; component visual correctness
// verified by integration in admin pages that adopt it across
// M5 R0a/R0b/R0c.

import { describe, it, expect } from 'vitest';
import { inferEmptyStateVariant } from '../../../src/components/admin/EmptyState.jsx';

describe('inferEmptyStateVariant', () => {
    it('returns "no-data" by default with no signals', () => {
        expect(inferEmptyStateVariant({})).toBe('no-data');
        expect(inferEmptyStateVariant()).toBe('no-data');
    });

    it('returns "error" when isError is true', () => {
        expect(inferEmptyStateVariant({ isError: true })).toBe('error');
    });

    it('returns "search" when isFiltered is true', () => {
        expect(inferEmptyStateVariant({ isFiltered: true })).toBe('search');
    });

    it('explicit variant beats every signal', () => {
        expect(inferEmptyStateVariant({ variant: 'no-data', isError: true })).toBe('no-data');
        expect(inferEmptyStateVariant({ variant: 'loading', isError: true, isFiltered: true })).toBe('loading');
    });

    it('isError beats isFiltered (error is more severe)', () => {
        expect(inferEmptyStateVariant({ isError: true, isFiltered: true })).toBe('error');
    });

    it('treats falsy signal flags as absent', () => {
        expect(inferEmptyStateVariant({ isError: false })).toBe('no-data');
        expect(inferEmptyStateVariant({ isFiltered: false })).toBe('no-data');
        expect(inferEmptyStateVariant({ isError: false, isFiltered: false })).toBe('no-data');
    });

    it('passes through unknown explicit variants verbatim', () => {
        // The caller may register a custom variant in the future. Helper
        // is permissive — it returns the string and lets the CSS layer
        // decide how to style unknown variants.
        expect(inferEmptyStateVariant({ variant: 'custom-thing' })).toBe('custom-thing');
        expect(inferEmptyStateVariant({ variant: 'success' })).toBe('success');
    });

    it('treats empty string variant as absent (falsy)', () => {
        expect(inferEmptyStateVariant({ variant: '' })).toBe('no-data');
        expect(inferEmptyStateVariant({ variant: '', isError: true })).toBe('error');
    });

    it('handles null variant by falling through to signal logic', () => {
        expect(inferEmptyStateVariant({ variant: null, isFiltered: true })).toBe('search');
    });
});
