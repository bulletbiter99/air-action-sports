// M6 B3 — pure helpers in worker/lib/emailTemplates.js.
// No DB, no I/O — predicate + validator behavior only.

import { describe, it, expect } from 'vitest';
import {
    STATUS_VALUES,
    DEFAULT_STATUS,
    isPublishedTemplate,
    isValidStatus,
    normalizeStatus,
} from '../../../worker/lib/emailTemplates.js';

describe('STATUS_VALUES constant', () => {
    it('exposes draft and published in stable order', () => {
        expect(STATUS_VALUES).toEqual(['draft', 'published']);
    });

    it('is frozen — cannot be mutated by callers', () => {
        expect(Object.isFrozen(STATUS_VALUES)).toBe(true);
    });
});

describe('DEFAULT_STATUS constant', () => {
    it('equals published — matches the migration 0056 column default', () => {
        expect(DEFAULT_STATUS).toBe('published');
    });

    it('is a value in STATUS_VALUES', () => {
        expect(STATUS_VALUES).toContain(DEFAULT_STATUS);
    });
});

describe('isPublishedTemplate', () => {
    it('returns true when row.status is published', () => {
        expect(isPublishedTemplate({ status: 'published' })).toBe(true);
    });

    it('returns false when row.status is draft', () => {
        expect(isPublishedTemplate({ status: 'draft' })).toBe(false);
    });

    it('returns true when row.status is undefined (legacy row)', () => {
        expect(isPublishedTemplate({ slug: 'legacy' })).toBe(true);
    });

    it('returns true when row.status is null (defensive)', () => {
        expect(isPublishedTemplate({ status: null })).toBe(true);
    });

    it('returns false for unknown status values (defensive)', () => {
        expect(isPublishedTemplate({ status: 'archived' })).toBe(false);
        expect(isPublishedTemplate({ status: '' })).toBe(false);
    });

    it('returns false for null / undefined / non-object input', () => {
        expect(isPublishedTemplate(null)).toBe(false);
        expect(isPublishedTemplate(undefined)).toBe(false);
        expect(isPublishedTemplate('published')).toBe(false);
        expect(isPublishedTemplate(123)).toBe(false);
    });
});

describe('isValidStatus', () => {
    it('returns true for exact published / draft', () => {
        expect(isValidStatus('published')).toBe(true);
        expect(isValidStatus('draft')).toBe(true);
    });

    it('returns false for casing or whitespace variations (strict)', () => {
        expect(isValidStatus('Published')).toBe(false);
        expect(isValidStatus('DRAFT')).toBe(false);
        expect(isValidStatus(' draft')).toBe(false);
        expect(isValidStatus('draft ')).toBe(false);
    });

    it('returns false for non-string input', () => {
        expect(isValidStatus(null)).toBe(false);
        expect(isValidStatus(undefined)).toBe(false);
        expect(isValidStatus(0)).toBe(false);
        expect(isValidStatus({})).toBe(false);
    });

    it('returns false for unknown enum values', () => {
        expect(isValidStatus('archived')).toBe(false);
        expect(isValidStatus('paused')).toBe(false);
        expect(isValidStatus('')).toBe(false);
    });
});

describe('normalizeStatus', () => {
    it('returns the canonical lowercase value for clean input', () => {
        expect(normalizeStatus('published')).toBe('published');
        expect(normalizeStatus('draft')).toBe('draft');
    });

    it('trims surrounding whitespace and lowercases', () => {
        expect(normalizeStatus('  Published  ')).toBe('published');
        expect(normalizeStatus('DRAFT')).toBe('draft');
        expect(normalizeStatus('\tDraft\n')).toBe('draft');
    });

    it('returns null for invalid values', () => {
        expect(normalizeStatus('archived')).toBeNull();
        expect(normalizeStatus('')).toBeNull();
        expect(normalizeStatus('   ')).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(normalizeStatus(null)).toBeNull();
        expect(normalizeStatus(undefined)).toBeNull();
        expect(normalizeStatus(123)).toBeNull();
        expect(normalizeStatus({})).toBeNull();
    });
});
