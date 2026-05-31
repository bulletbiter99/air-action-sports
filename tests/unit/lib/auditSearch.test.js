// M7 Batch 6 — unit tests for the audit-log FTS5 query builder.

import { describe, it, expect } from 'vitest';
import { buildFtsMatchQuery } from '../../../worker/lib/auditSearch.js';

describe('buildFtsMatchQuery', () => {
    it('builds a quoted prefix query, one token per word (implicit AND)', () => {
        expect(buildFtsMatchQuery('refund booking')).toBe('"refund"* "booking"*');
        expect(buildFtsMatchQuery('refund')).toBe('"refund"*');
    });

    it('neutralizes FTS5 operators by quoting them as literal tokens', () => {
        // OR/AND/NOT become quoted literals, not query operators
        expect(buildFtsMatchQuery('foo OR bar')).toBe('"foo"* "OR"* "bar"*');
    });

    it('strips FTS5 special characters from within tokens', () => {
        expect(buildFtsMatchQuery('a*b(c)')).toBe('"abc"*');
        // no whitespace → one token; ^ and : are stripped, leaving "namevalue"
        expect(buildFtsMatchQuery('na^me:value')).toBe('"namevalue"*');
    });

    it('cannot inject the MATCH expression (quotes/semicolons removed)', () => {
        // '";  DROP TABLE' → the punctuation-only fragment is dropped; the bare
        // words survive as harmless quoted literals.
        expect(buildFtsMatchQuery('"; DROP TABLE')).toBe('"DROP"* "TABLE"*');
    });

    it('preserves ids and emails (word-ish chars kept)', () => {
        expect(buildFtsMatchQuery('cus_123')).toBe('"cus_123"*');
        expect(buildFtsMatchQuery('a@b.com')).toBe('"a@b.com"*');
    });

    it('returns null when nothing usable remains', () => {
        expect(buildFtsMatchQuery('')).toBeNull();
        expect(buildFtsMatchQuery('   ')).toBeNull();
        expect(buildFtsMatchQuery('!!! @@@')).toBeNull(); // @ alone has no alnum
        expect(buildFtsMatchQuery(null)).toBeNull();
        expect(buildFtsMatchQuery(undefined)).toBeNull();
    });
});
