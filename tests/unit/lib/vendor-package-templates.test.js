// M6 Batch 2 — Pure helper tests for worker/lib/vendorPackageTemplates.js.

import { describe, it, expect, vi } from 'vitest';
import {
    VALID_SECTION_KINDS,
    parseSections,
    normalizeSections,
    cloneTemplateSections,
} from '../../../worker/lib/vendorPackageTemplates.js';

describe('VALID_SECTION_KINDS', () => {
    it('matches the vendor_package_sections CHECK constraint (migration 0010)', () => {
        expect(VALID_SECTION_KINDS).toEqual(['overview', 'schedule', 'map', 'contact', 'custom']);
    });
});

describe('parseSections', () => {
    it('returns [] for null / undefined / empty string', () => {
        expect(parseSections(null)).toEqual([]);
        expect(parseSections(undefined)).toEqual([]);
        expect(parseSections('')).toEqual([]);
    });

    it('parses valid JSON arrays', () => {
        const json = JSON.stringify([{ kind: 'overview', title: 'X', body_html: '<p>x</p>', sort_order: 0 }]);
        expect(parseSections(json)).toHaveLength(1);
    });

    it('returns [] for invalid JSON', () => {
        expect(parseSections('{not json')).toEqual([]);
    });

    it('returns [] for non-array JSON', () => {
        expect(parseSections('{"foo":"bar"}')).toEqual([]);
        expect(parseSections('"a string"')).toEqual([]);
        expect(parseSections('null')).toEqual([]);
    });
});

describe('normalizeSections', () => {
    it('returns [] for non-array input', () => {
        expect(normalizeSections(null)).toEqual([]);
        expect(normalizeSections(undefined)).toEqual([]);
        expect(normalizeSections({})).toEqual([]);
        expect(normalizeSections('string')).toEqual([]);
    });

    it('filters out entries missing a string title', () => {
        const out = normalizeSections([
            { kind: 'overview', title: 'A' },
            { kind: 'overview' },           // no title → filtered
            { kind: 'overview', title: 42 }, // non-string title → filtered
            null,                            // not an object → filtered
            'string',                        // not an object → filtered
            { title: 'D' },                  // valid (kind defaults)
        ]);
        expect(out).toHaveLength(2);
        expect(out[0].title).toBe('A');
        expect(out[1].title).toBe('D');
    });

    it('coerces unknown kind values to "custom" (CHECK-constraint safety)', () => {
        const out = normalizeSections([
            { kind: 'text', title: 'X' },          // unknown → custom
            { kind: 'invalid_kind', title: 'Y' },  // unknown → custom
            { kind: 'overview', title: 'Z' },      // valid → preserved
        ]);
        expect(out[0].kind).toBe('custom');
        expect(out[1].kind).toBe('custom');
        expect(out[2].kind).toBe('overview');
    });

    it('defaults missing kind to "custom"', () => {
        const out = normalizeSections([{ title: 'X' }]);
        expect(out[0].kind).toBe('custom');
    });

    it('truncates title to 200 chars', () => {
        const longTitle = 'x'.repeat(300);
        const out = normalizeSections([{ kind: 'overview', title: longTitle }]);
        expect(out[0].title).toHaveLength(200);
    });

    it('defaults body_html to empty string when missing', () => {
        const out = normalizeSections([{ kind: 'overview', title: 'X' }]);
        expect(out[0].body_html).toBe('');
    });

    it('preserves provided sort_order; falls back to array index', () => {
        const out = normalizeSections([
            { kind: 'overview', title: 'A', sort_order: 10 },
            { kind: 'overview', title: 'B' },              // no sort_order → index 1
            { kind: 'overview', title: 'C', sort_order: 5 },
        ]);
        expect(out[0].sort_order).toBe(10);
        expect(out[1].sort_order).toBe(1);
        expect(out[2].sort_order).toBe(5);
    });

    it('produces output that is always cloneable (kinds match enum)', () => {
        const ugly = [
            { kind: 'banana', title: 'A' },
            { kind: undefined, title: 'B' },
            { kind: 123, title: 'C' },
            { title: 'D' },
        ];
        const out = normalizeSections(ugly);
        for (const s of out) {
            expect(VALID_SECTION_KINDS).toContain(s.kind);
        }
    });
});

describe('cloneTemplateSections', () => {
    function mockBatchEnv() {
        const captured = [];
        const env = {
            DB: {
                prepare(sql) {
                    return {
                        bind(...args) {
                            return { __sql: sql, __args: args };
                        },
                    };
                },
                async batch(stmts) {
                    for (const s of stmts) captured.push({ sql: s.__sql, args: s.__args });
                    return [];
                },
            },
        };
        return { env, captured };
    }

    it('returns { inserted: 0 } and skips DB when sections array is empty / null', async () => {
        const { env, captured } = mockBatchEnv();
        expect(await cloneTemplateSections(env, 'evnd_X', [], Date.now())).toEqual({ inserted: 0 });
        expect(await cloneTemplateSections(env, 'evnd_X', null, Date.now())).toEqual({ inserted: 0 });
        expect(captured).toHaveLength(0);
    });

    it('inserts one row per section with the correct bind shape', async () => {
        const { env, captured } = mockBatchEnv();
        const now = 1700000000000;
        const sections = [
            { kind: 'overview', title: 'A', body_html: '<p>a</p>', sort_order: 0 },
            { kind: 'schedule', title: 'B', body_html: '', sort_order: 1 },
        ];
        const result = await cloneTemplateSections(env, 'evnd_X', sections, now);
        expect(result).toEqual({ inserted: 2 });
        expect(captured).toHaveLength(2);

        // Bind shape: id, event_vendor_id, kind, title, body_html, sort_order, created_at, updated_at
        const row0 = captured[0].args;
        expect(row0[0]).toMatch(/^vps_/);
        expect(row0[1]).toBe('evnd_X');
        expect(row0[2]).toBe('overview');
        expect(row0[3]).toBe('A');
        expect(row0[4]).toBe('<p>a</p>');
        expect(row0[5]).toBe(0);
        expect(row0[6]).toBe(now);
        expect(row0[7]).toBe(now);

        const row1 = captured[1].args;
        expect(row1[2]).toBe('schedule');
        expect(row1[3]).toBe('B');
        expect(row1[4]).toBeNull(); // empty body_html → NULL
        expect(row1[5]).toBe(1);
    });

    it('falls back to array index when sort_order is missing', async () => {
        const { env, captured } = mockBatchEnv();
        const sections = [
            { kind: 'overview', title: 'A' },
            { kind: 'overview', title: 'B' },
        ];
        await cloneTemplateSections(env, 'evnd_X', sections, Date.now());
        expect(captured[0].args[5]).toBe(0);
        expect(captured[1].args[5]).toBe(1);
    });

    it('defaults now to Date.now() when not provided', async () => {
        const { env, captured } = mockBatchEnv();
        const before = Date.now();
        await cloneTemplateSections(env, 'evnd_X', [
            { kind: 'overview', title: 'A' },
        ]);
        const after = Date.now();
        expect(captured[0].args[6]).toBeGreaterThanOrEqual(before);
        expect(captured[0].args[6]).toBeLessThanOrEqual(after);
    });

    it('every generated id starts with vps_ and they are unique per call', async () => {
        const { env, captured } = mockBatchEnv();
        const sections = Array.from({ length: 5 }, (_, i) => ({ kind: 'overview', title: `S${i}` }));
        await cloneTemplateSections(env, 'evnd_X', sections, Date.now());
        const ids = captured.map((c) => c.args[0]);
        for (const id of ids) expect(id).toMatch(/^vps_/);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
