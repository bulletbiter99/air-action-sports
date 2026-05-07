// Tests for money helpers (src/utils/money.js + worker/lib/money.js).
//
// Both files are mirrors of the same logic. This test imports BOTH and
// runs the same suite against each, proving "same logic, same return
// shape" (per M2 prompt). Any behavior drift between client and server
// formatters fails immediately here.

import { describe, it, expect } from 'vitest';
import * as clientMoney from '../../../src/utils/money.js';
import * as workerMoney from '../../../worker/lib/money.js';

const targets = [
    { name: 'src/utils/money.js', mod: clientMoney },
    { name: 'worker/lib/money.js', mod: workerMoney },
];

for (const { name, mod } of targets) {
    const { formatMoney, parseMoney } = mod;

    describe(`formatMoney — happy path (${name})`, () => {
        it('formats positive cents as $X.XX', () => {
            expect(formatMoney(8000)).toBe('$80.00');
        });

        it('pads single-cent remainder', () => {
            expect(formatMoney(8005)).toBe('$80.05');
        });

        it('handles zero cents', () => {
            expect(formatMoney(0)).toBe('$0.00');
        });

        it('formats negative cents with leading minus before currency', () => {
            expect(formatMoney(-2550)).toBe('-$25.50');
        });

        it('handles large values up to $999,999', () => {
            expect(formatMoney(99999900)).toBe('$999999.00');
            expect(formatMoney(99999999)).toBe('$999999.99');
        });

        it('handles single-digit cents (sub-dollar)', () => {
            expect(formatMoney(50)).toBe('$0.50');
            expect(formatMoney(5)).toBe('$0.05');
            expect(formatMoney(1)).toBe('$0.01');
        });

        it('opts.currency=\"\" omits the dollar sign', () => {
            expect(formatMoney(8000, { currency: '' })).toBe('80.00');
        });

        it('opts.currency=<other> uses that prefix', () => {
            expect(formatMoney(8000, { currency: 'USD ' })).toBe('USD 80.00');
        });
    });

    describe(`formatMoney — empty/missing handling (${name})`, () => {
        it('null defaults to $0.00', () => {
            expect(formatMoney(null)).toBe('$0.00');
        });

        it('undefined defaults to $0.00', () => {
            expect(formatMoney(undefined)).toBe('$0.00');
        });

        it("'' defaults to $0.00", () => {
            expect(formatMoney('')).toBe('$0.00');
        });

        it('null with opts.emptyFor=\"\" returns empty string (input-field round-trip)', () => {
            expect(formatMoney(null, { currency: '', emptyFor: '' })).toBe('');
        });

        it('undefined with opts.emptyFor=\"\" returns empty string', () => {
            expect(formatMoney(undefined, { currency: '', emptyFor: '' })).toBe('');
        });

        it("'' with opts.emptyFor=\"\" returns empty string", () => {
            expect(formatMoney('', { currency: '', emptyFor: '' })).toBe('');
        });

        it('NaN defaults to $0.00 (or emptyFor when set)', () => {
            expect(formatMoney(NaN)).toBe('$0.00');
            expect(formatMoney(NaN, { currency: '', emptyFor: '' })).toBe('');
        });

        it('Infinity defaults to $0.00 (or emptyFor when set)', () => {
            expect(formatMoney(Infinity)).toBe('$0.00');
            expect(formatMoney(Infinity, { currency: '', emptyFor: '' })).toBe('');
        });

        it('opts.emptyFor only fires for missing/non-finite — finite zero formats normally', () => {
            // 0 is a real value, not "missing"
            expect(formatMoney(0, { currency: '', emptyFor: '' })).toBe('0.00');
        });
    });

    describe(`parseMoney — happy path (${name})`, () => {
        it('parses $X.XX format', () => {
            expect(parseMoney('$80.00')).toBe(8000);
        });

        it('parses bare X.XX', () => {
            expect(parseMoney('80.00')).toBe(8000);
        });

        it('parses integer (no decimals)', () => {
            expect(parseMoney('80')).toBe(8000);
        });

        it('parses single decimal', () => {
            expect(parseMoney('80.5')).toBe(8050);
        });

        it('parses thousand separators', () => {
            expect(parseMoney('$1,234.56')).toBe(123456);
            expect(parseMoney('1,234.56')).toBe(123456);
        });

        it('parses negative values', () => {
            expect(parseMoney('-$25.50')).toBe(-2550);
            expect(parseMoney('-25.50')).toBe(-2550);
        });

        it('strips surrounding whitespace', () => {
            expect(parseMoney('  $80.00  ')).toBe(8000);
        });

        it('accepts a number directly (rounds to cents)', () => {
            expect(parseMoney(80)).toBe(8000);
            expect(parseMoney(80.5)).toBe(8050);
            expect(parseMoney(80.555)).toBe(8056);  // rounds half-up
        });
    });

    describe(`parseMoney — failure modes (${name})`, () => {
        it('returns null for empty input', () => {
            expect(parseMoney('')).toBeNull();
            expect(parseMoney('   ')).toBeNull();
        });

        it('returns null for null/undefined', () => {
            expect(parseMoney(null)).toBeNull();
            expect(parseMoney(undefined)).toBeNull();
        });

        it('returns null for non-numeric strings', () => {
            expect(parseMoney('abc')).toBeNull();
            expect(parseMoney('$abc')).toBeNull();
        });

        it('returns null for malformed numeric strings', () => {
            expect(parseMoney('80.5.5')).toBeNull();
            expect(parseMoney('--80')).toBeNull();
            expect(parseMoney('80.555')).toBeNull();  // 3-digit decimals not allowed
        });

        it('returns null for non-finite numbers', () => {
            expect(parseMoney(NaN)).toBeNull();
            expect(parseMoney(Infinity)).toBeNull();
            expect(parseMoney(-Infinity)).toBeNull();
        });

        it('returns null for input that is just punctuation', () => {
            expect(parseMoney('$')).toBeNull();
            expect(parseMoney(',')).toBeNull();
            expect(parseMoney('.')).toBeNull();
        });
    });

    describe(`formatMoney + parseMoney round-trip (${name})`, () => {
        it('round-trips integer-cent values', () => {
            const cases = [0, 1, 50, 100, 999, 8000, 12345, 99999900, -2550];
            for (const c of cases) {
                expect(parseMoney(formatMoney(c))).toBe(c);
            }
        });

        it('round-trips with currency=\"\"', () => {
            const cases = [0, 100, 8000, -2550];
            for (const c of cases) {
                expect(parseMoney(formatMoney(c, { currency: '' }))).toBe(c);
            }
        });
    });
}
