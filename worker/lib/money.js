// Money formatting + parsing helpers for the Worker.
//
// Mirror of src/utils/money.js. The Workers runtime can't reach into
// src/ (Vite bundles src/ for the SPA only; the Worker is a separate
// compilation target), so the helpers are duplicated by necessity.
// Both implementations are kept identical and verified by
// tests/unit/utils/money.test.js, which imports BOTH and runs the same
// suite against each.
//
// See src/utils/money.js for full API documentation.

export function formatMoney(cents, opts = {}) {
    const { currency = '$', emptyFor } = opts;

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

    const cleaned = str.replace(/[$,\s]/g, '');
    if (!cleaned) return null;

    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;

    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;

    return Math.round(n * 100);
}
