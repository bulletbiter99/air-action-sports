// Customer email normalization — client-side mirror of
// worker/lib/customerEmail.js. Used by the admin UI to hint
// "this email looks like an existing customer — merge?" in B8.
//
// MUST stay behavior-identical to the worker copy. The dual-target
// test pair (tests/unit/lib/customerEmail.test.js +
// tests/unit/utils/customerEmail.test.js) proves byte-identical
// outputs across all decision register #32 scenarios.

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * @param {string|null|undefined} domain
 * @returns {boolean}
 */
export function isGmailLike(domain) {
    if (!domain || typeof domain !== 'string') return false;
    return GMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * @param {string|null|undefined} email
 * @returns {string|null}
 */
export function normalizeEmail(email) {
    return extractBaseEmail(email);
}

/**
 * @param {string|null|undefined} email
 * @returns {string|null}
 */
export function extractBaseEmail(email) {
    if (email == null || typeof email !== 'string') return null;

    const trimmed = email.trim();
    if (trimmed.length === 0) return null;

    const normalized = trimmed.normalize('NFC').toLowerCase();

    const atIndex = normalized.indexOf('@');
    if (atIndex === -1) return null;
    if (normalized.indexOf('@', atIndex + 1) !== -1) return null;

    let local = normalized.slice(0, atIndex);
    let domain = normalized.slice(atIndex + 1);

    if (local.length === 0 || domain.length === 0) return null;

    const plusIndex = local.indexOf('+');
    if (plusIndex !== -1) {
        local = local.slice(0, plusIndex);
    }

    if (GMAIL_DOMAINS.has(domain)) {
        local = local.replace(/\./g, '');
        domain = 'gmail.com';
    }

    if (local.length === 0) return null;

    return `${local}@${domain}`;
}

/**
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {boolean}
 */
export function emailsMatch(a, b) {
    const na = normalizeEmail(a);
    const nb = normalizeEmail(b);
    if (na == null || nb == null) return false;
    return na === nb;
}
