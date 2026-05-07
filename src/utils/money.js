// Money formatting + parsing helpers for the SPA.
//
// Mirrored at worker/lib/money.js for server-side use (Workers runtime
// can't reach into src/, so the two files are duplicated by necessity).
// Both implementations are identical and tested together via
// tests/unit/utils/money.test.js — that test file imports BOTH and runs
// the same suite against each, proving "same logic, same return shape."
//
// API:
//   formatMoney(cents, opts?) → string
//     cents: integer | null | undefined | '' (treated as missing)
//     opts.currency: '$' (default) | '' | <other prefix>
//     opts.emptyFor: undefined (default — use currency + '0.00') | '' | <other>
//                    when cents is null/undefined/''/non-finite, return this
//     Examples:
//       formatMoney(8000)                                  → '$80.00'
//       formatMoney(null)                                  → '$0.00'
//       formatMoney(8000, { currency: '' })                → '80.00'
//       formatMoney(null, { currency: '', emptyFor: '' }) → ''
//       formatMoney(-2550)                                 → '-$25.50'
//
//   parseMoney(input) → integer cents | null
//     Accepts: '$80.00', '80.00', '80', '$1,234.56', '  $5 ' (with whitespace),
//              numbers (multiplies by 100 + rounds).
//     Returns null on: empty string, malformed input, non-finite numbers.

export function formatMoney(cents, opts = {}) {
    const { currency = '$', emptyFor } = opts;

    // Empty/missing handling
    if (cents === null || cents === undefined || cents === '') {
        return emptyFor !== undefined ? emptyFor : currency + '0.00';
    }

    const n = Number(cents);
    if (!Number.isFinite(n)) {
        return emptyFor !== undefined ? emptyFor : currency + '0.00';
    }

    const negative = n < 0;
    const abs = Math.abs(Math.trunc(n));
    const dollars = Math.floor(abs / 100);
    const remainder = abs % 100;
    const padded = String(remainder).padStart(2, '0');

    return (negative ? '-' : '') + currency + dollars + '.' + padded;
}

export function parseMoney(input) {
    if (input === null || input === undefined) return null;

    if (typeof input === 'number') {
        if (!Number.isFinite(input)) return null;
        return Math.round(input * 100);
    }

    const str = String(input).trim();
    if (!str) return null;

    // Strip $, commas, internal whitespace. Keep digits, optional leading -, optional .
    const cleaned = str.replace(/[$,\s]/g, '');
    if (!cleaned) return null;

    // Reject anything that isn't optional - + digits + optional .NN (1-2 decimals)
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;

    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;

    return Math.round(n * 100);
}
