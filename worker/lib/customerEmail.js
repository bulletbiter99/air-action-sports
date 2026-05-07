// Customer email normalization — closes decision register #32.
//
// Drives B4's backfill dedup, B5's findOrCreateCustomerForBooking, and
// B8's "this email matches an existing customer" admin UI hints.
//
// Rule (loose Gmail / strict elsewhere):
//   - Gmail family (gmail.com, googlemail.com): dots in local-part are
//     ignored; plus-alias is stripped; both domain forms canonicalize
//     to gmail.com.
//   - Non-Gmail providers: dots are SIGNIFICANT (different addresses).
//     Plus-alias is still stripped (CAN-SPAM rationale: every major
//     provider forwards plus-aliases to the base address).
//   - All providers: case-insensitive, whitespace-stripped, NFC-normalized.
//
// This module is mirrored by src/utils/customerEmail.js — they MUST stay
// behavior-identical (proved by the dual-target test pair).

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
 * Returns the canonical normalized form of `email`, or null if the input
 * is empty, malformed, or normalizes to an empty local part.
 *
 * @param {string|null|undefined} email
 * @returns {string|null}
 */
export function normalizeEmail(email) {
    return extractBaseEmail(email);
}

/**
 * Lower-level alias for normalizeEmail. Exposed so the admin UI hint
 * code in B8 can call this name when the intent is "show me the
 * canonical form for matching" rather than "normalize for storage."
 * Same logic; same return.
 *
 * @param {string|null|undefined} email
 * @returns {string|null}
 */
export function extractBaseEmail(email) {
    if (email == null || typeof email !== 'string') return null;

    const trimmed = email.trim();
    if (trimmed.length === 0) return null;

    // NFC normalize so visually-identical Unicode (precomposed vs
    // decomposed) collapses to one form before structural parsing.
    const normalized = trimmed.normalize('NFC').toLowerCase();

    // Must contain exactly one @
    const atIndex = normalized.indexOf('@');
    if (atIndex === -1) return null;
    if (normalized.indexOf('@', atIndex + 1) !== -1) return null;

    let local = normalized.slice(0, atIndex);
    let domain = normalized.slice(atIndex + 1);

    if (local.length === 0 || domain.length === 0) return null;

    // Strip plus-alias from local-part (every major provider forwards).
    const plusIndex = local.indexOf('+');
    if (plusIndex !== -1) {
        local = local.slice(0, plusIndex);
    }

    // Gmail family: strip dots from local; canonicalize domain.
    if (GMAIL_DOMAINS.has(domain)) {
        local = local.replace(/\./g, '');
        domain = 'gmail.com';
    }

    // After plus-strip + dot-strip, local could be empty (e.g. `+test@gmail.com`).
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
