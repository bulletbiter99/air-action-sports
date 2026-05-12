// Post-M5.5 — pure helpers for the AdminPromoCodes Batch Create modal.
// Parsing email lists into chips with X-to-remove, plus discount display
// formatting for the confirmation modal.

// Permissive RFC-5322-ish email regex. Same shape as worker/lib/email.js
// isValidEmail (frontend is intentionally permissive; the backend
// re-validates on POST).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse a free-form text blob into deduped, validated email entries.
 *
 * Splits on newlines, commas, semicolons, and surrounding whitespace.
 * Lowercases + trims each token. Returns three buckets:
 *   - valid:      unique well-formed emails (insertion order preserved)
 *   - invalid:    tokens that didn't parse (with the original text)
 *   - duplicates: emails that appeared more than once (kept once in valid;
 *                 the extras returned here so the UI can flag them)
 *
 * Pure — no side effects, no I/O.
 *
 * @param {string} text
 * @returns {{ valid: string[], invalid: string[], duplicates: string[] }}
 */
export function parseEmailList(text) {
    const result = { valid: [], invalid: [], duplicates: [] };
    if (typeof text !== 'string' || !text.trim()) return result;

    const tokens = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
    const seen = new Set();
    for (const tok of tokens) {
        const lower = tok.toLowerCase();
        if (!EMAIL_RE.test(lower)) {
            result.invalid.push(tok);
            continue;
        }
        if (seen.has(lower)) {
            result.duplicates.push(lower);
            continue;
        }
        seen.add(lower);
        result.valid.push(lower);
    }
    return result;
}

/**
 * Format a discount for the confirmation modal preview.
 *   formatDiscountDisplay('percent', 25) → '25% off'
 *   formatDiscountDisplay('fixed', 1000) → '$10.00 off'  (cents → dollars)
 *
 * Returns the empty string for unknown discount types or non-finite values.
 *
 * @param {'percent'|'fixed'} discountType
 * @param {number} discountValue  percent: 0-100; fixed: cents
 * @returns {string}
 */
export function formatDiscountDisplay(discountType, discountValue) {
    if (discountValue == null) return '';
    const n = Number(discountValue);
    if (!Number.isFinite(n)) return '';
    if (discountType === 'percent') return `${n}% off`;
    if (discountType === 'fixed') return `$${(n / 100).toFixed(2)} off`;
    return '';
}
