// Email helpers for the SPA.
//
// Mirrored at worker/lib/email.js for server-side use (Workers runtime
// can't reach into src/, so the two implementations are duplicated by
// necessity). Both are tested together via tests/unit/utils/email.test.js
// — that test file imports BOTH and runs the same suite against each,
// proving "same logic, same return shape."
//
// API:
//
//   isValidEmail(input) → boolean
//     Trims input. Returns false for non-strings, empty strings, strings
//     longer than 254 chars (RFC 5321 max), or strings that fail the
//     standard `local@domain.tld` shape.
//
//   normalizeEmail(input) → string | null
//     Returns null if isValidEmail(input) is false. Otherwise produces a
//     canonical form for dedup / comparison:
//       - Trim, NFC Unicode normalize, lowercase (everyone)
//       - Strip plus-alias from local part (everyone — CAN-SPAM compliant;
//         major providers forward plus-aliases)
//       - For @gmail.com and @googlemail.com: ALSO strip dots from local
//         part (Gmail-loose). gmail.com and googlemail.com domains are
//         kept distinct (conservative; M3 dedup can collapse if needed).
//       - For all other providers: dots in the local part are
//         significant (strict-elsewhere).
//
// The loose-Gmail / strict-elsewhere rule comes from the M2 prompt's
// decision register #32 specification.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;  // RFC 5321 §4.5.3.1.3

export function isValidEmail(input) {
    if (typeof input !== 'string') return false;
    const s = input.trim();
    if (!s || s.length > MAX_EMAIL_LEN) return false;
    return EMAIL_RE.test(s);
}

export function normalizeEmail(input) {
    if (!isValidEmail(input)) return null;

    // Trim, NFC normalize, lowercase
    const s = input.trim().normalize('NFC').toLowerCase();

    // Split at the LAST @ to be safe (technically the regex above only
    // allows one @, but defensive against future regex relaxation).
    const atIdx = s.lastIndexOf('@');
    if (atIdx === -1) return null;

    let local = s.slice(0, atIdx);
    const domain = s.slice(atIdx + 1);

    // Strip plus-alias from local (applies to all providers)
    const plusIdx = local.indexOf('+');
    if (plusIdx !== -1) {
        local = local.slice(0, plusIdx);
        if (!local) return null;  // '+work@example.com' — degenerate
    }

    // For Gmail / Googlemail: ALSO strip dots from local
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
        local = local.replace(/\./g, '');
        if (!local) return null;  // '....@gmail.com' — degenerate
    }

    return local + '@' + domain;
}
