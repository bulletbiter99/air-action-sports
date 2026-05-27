// Marketing B1 — tests for worker/lib/segments.js
//
// Covers: validateFilterSpec, buildSegmentSql, previewSegmentCount,
// resolveSegmentToCustomerList.

import { describe, it, expect } from 'vitest';
import {
    validateFilterSpec,
    buildSegmentSql,
    previewSegmentCount,
    resolveSegmentToCustomerList,
} from '../../../worker/lib/segments.js';
import { createMockD1 } from '../../helpers/mockD1.js';

// ────────────────────────────────────────────────────────────────────
// validateFilterSpec
// ────────────────────────────────────────────────────────────────────

describe('validateFilterSpec', () => {
    it('accepts minimal valid spec {v:1}', () => {
        const r = validateFilterSpec({ v: 1 });
        expect(r.valid).toBe(true);
        expect(r.normalized.tags).toEqual({ any: [], all: [], none: [] });
    });

    it('accepts JSON-string input', () => {
        const r = validateFilterSpec('{"v":1,"tags":{"any":["vip"]}}');
        expect(r.valid).toBe(true);
        expect(r.normalized.tags.any).toEqual(['vip']);
    });

    it('rejects when v is missing', () => {
        const r = validateFilterSpec({});
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/version/i);
    });

    it('rejects unknown version', () => {
        const r = validateFilterSpec({ v: 2 });
        expect(r.valid).toBe(false);
    });

    it('rejects non-object input', () => {
        expect(validateFilterSpec(null).valid).toBe(false);
        expect(validateFilterSpec(123).valid).toBe(false);
        expect(validateFilterSpec([]).valid).toBe(false);
    });

    it('rejects malformed JSON string', () => {
        const r = validateFilterSpec('{not json');
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/JSON/i);
    });

    it('rejects tags as non-object', () => {
        expect(validateFilterSpec({ v: 1, tags: 'oops' }).valid).toBe(false);
    });

    it('rejects tags.any with non-string entries', () => {
        expect(validateFilterSpec({ v: 1, tags: { any: [123] } }).valid).toBe(false);
        expect(validateFilterSpec({ v: 1, tags: { any: [''] } }).valid).toBe(false);
    });

    it('rejects ltvCents.min > ltvCents.max', () => {
        const r = validateFilterSpec({ v: 1, ltvCents: { min: 1000, max: 100 } });
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/exceed/);
    });

    it('rejects negative ltvCents', () => {
        expect(validateFilterSpec({ v: 1, ltvCents: { min: -5 } }).valid).toBe(false);
    });

    it('rejects non-numeric ltvCents', () => {
        expect(validateFilterSpec({ v: 1, ltvCents: { min: 'fifty' } }).valid).toBe(false);
    });

    it('ignores unknown top-level keys (forward-compat)', () => {
        const r = validateFilterSpec({ v: 1, futureFeature: 'whatever' });
        expect(r.valid).toBe(true);
        expect(r.normalized.futureFeature).toBeUndefined();
    });

    it('trims tag whitespace', () => {
        const r = validateFilterSpec({ v: 1, tags: { any: ['  vip  ', 'frequent'] } });
        expect(r.normalized.tags.any).toEqual(['vip', 'frequent']);
    });
});

// ────────────────────────────────────────────────────────────────────
// buildSegmentSql — enforced clauses + each criterion
// ────────────────────────────────────────────────────────────────────

describe('buildSegmentSql', () => {
    it('always includes email_marketing = 1 AND archived_at IS NULL', () => {
        const { sql, binds } = buildSegmentSql({ v: 1, tags: { any: [], all: [], none: [] } });
        expect(sql).toMatch(/customers\.email_marketing = 1/);
        expect(sql).toMatch(/customers\.archived_at IS NULL/);
        expect(binds).toEqual([]);
    });

    it('uses default selectClause = COUNT(*)', () => {
        const { sql } = buildSegmentSql({ v: 1 });
        expect(sql).toMatch(/SELECT COUNT\(\*\) AS n/);
    });

    it('accepts custom selectClause', () => {
        const { sql } = buildSegmentSql({ v: 1 }, { selectClause: 'customers.id, customers.email' });
        expect(sql).toMatch(/SELECT customers\.id, customers\.email/);
    });

    it('tags.any: appends one EXISTS with IN list', () => {
        const { sql, binds } = buildSegmentSql({ v: 1, tags: { any: ['vip', 'frequent'] } });
        expect(sql).toMatch(/EXISTS \(SELECT 1 FROM customer_tags/);
        expect(sql).toMatch(/ct\.tag IN \(\?,\?\)/);
        expect(binds).toEqual(['vip', 'frequent']);
    });

    it('tags.all: appends one EXISTS per tag', () => {
        const { sql, binds } = buildSegmentSql({ v: 1, tags: { all: ['vip', 'frequent'] } });
        const existsCount = (sql.match(/EXISTS \(SELECT 1 FROM customer_tags/g) || []).length;
        expect(existsCount).toBe(2);
        expect(binds).toEqual(['vip', 'frequent']);
    });

    it('tags.none: appends NOT EXISTS with IN list', () => {
        const { sql, binds } = buildSegmentSql({ v: 1, tags: { none: ['lapsed'] } });
        expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM customer_tags/);
        expect(binds).toEqual(['lapsed']);
    });

    it('ltvCents.min: appends >= clause', () => {
        const { sql, binds } = buildSegmentSql({ v: 1, ltvCents: { min: 50000 } });
        expect(sql).toMatch(/customers\.lifetime_value_cents >= \?/);
        expect(binds).toContain(50000);
    });

    it('ltvCents.max: appends <= clause', () => {
        const { sql, binds } = buildSegmentSql({ v: 1, ltvCents: { max: 100000 } });
        expect(sql).toMatch(/customers\.lifetime_value_cents <= \?/);
        expect(binds).toContain(100000);
    });

    it('totalBookings: independent min + max clauses', () => {
        const { sql, binds } = buildSegmentSql({ v: 1, totalBookings: { min: 1, max: 10 } });
        expect(sql).toMatch(/customers\.total_bookings >= \?/);
        expect(sql).toMatch(/customers\.total_bookings <= \?/);
        expect(binds).toEqual([1, 10]);
    });

    it('combined: stable bind order (tags first, then ranges)', () => {
        const { binds } = buildSegmentSql({
            v: 1,
            tags: { any: ['vip'] },
            ltvCents: { min: 1000 },
            totalBookings: { min: 1 },
        });
        expect(binds).toEqual(['vip', 1000, 1]);
    });

    it('empty tag arrays are NOT serialized into SQL', () => {
        const { sql, binds } = buildSegmentSql({
            v: 1, tags: { any: [], all: [], none: [] },
        });
        expect(sql).not.toMatch(/customer_tags/);
        expect(binds).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────
// I/O wrappers
// ────────────────────────────────────────────────────────────────────

describe('previewSegmentCount', () => {
    it('returns the n column from the COUNT row', async () => {
        const db = createMockD1();
        db.__on(/COUNT\(\*\) AS n FROM customers/, { n: 47 }, 'first');
        const count = await previewSegmentCount(db, { v: 1 });
        expect(count).toBe(47);
    });

    it('returns 0 when no row matched', async () => {
        const db = createMockD1();
        const count = await previewSegmentCount(db, { v: 1 });
        expect(count).toBe(0);
    });
});

describe('resolveSegmentToCustomerList', () => {
    it('returns mapped customers with default pagination', async () => {
        const db = createMockD1();
        db.__on(/customers\.id, customers\.email/, {
            results: [
                { id: 'cus_a', email: 'a@x.com', name: 'Alice', lifetime_value_cents: 50000, total_bookings: 3 },
            ],
        }, 'all');
        const { customers } = await resolveSegmentToCustomerList(db, { v: 1 });
        expect(customers).toHaveLength(1);
        expect(customers[0].id).toBe('cus_a');
        expect(customers[0].lifetimeValueCents).toBe(50000);
    });

    it('clamps limit to [1, 500]', async () => {
        const db = createMockD1();
        let capturedBinds = null;
        db.__on(/customers\.id, customers\.email/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');
        await resolveSegmentToCustomerList(db, { v: 1 }, { limit: 9999, offset: -5 });
        // Limit clamped to 500, offset clamped to 0.
        expect(capturedBinds[capturedBinds.length - 2]).toBe(500);
        expect(capturedBinds[capturedBinds.length - 1]).toBe(0);
    });

    it('returns empty array when D1 result has no rows', async () => {
        const db = createMockD1();
        const { customers } = await resolveSegmentToCustomerList(db, { v: 1 });
        expect(customers).toEqual([]);
    });
});
