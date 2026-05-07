// Tests for email helpers (src/utils/email.js + worker/lib/email.js's
// isValidEmail / normalizeEmail exports — sendEmail is do-not-touch and
// is NOT tested or modified here).
//
// Both files are mirrors of the same logic. This test imports BOTH and
// runs the same suite against each, proving "same logic, same return
// shape" (per M2 prompt). Any drift between client and server fails
// immediately here.

import { describe, it, expect } from 'vitest';
import * as clientEmail from '../../../src/utils/email.js';
import * as workerEmail from '../../../worker/lib/email.js';

const targets = [
    { name: 'src/utils/email.js', mod: clientEmail },
    { name: 'worker/lib/email.js', mod: workerEmail },
];

for (const { name, mod } of targets) {
    const { isValidEmail, normalizeEmail } = mod;

    describe(`isValidEmail — happy paths (${name})`, () => {
        it('accepts a basic email', () => {
            expect(isValidEmail('alice@example.com')).toBe(true);
        });

        it('accepts subdomain emails', () => {
            expect(isValidEmail('alice@mail.subdomain.example.com')).toBe(true);
        });

        it('accepts hyphenated domains', () => {
            expect(isValidEmail('alice@some-domain.co')).toBe(true);
        });

        it('accepts numbers in local + domain', () => {
            expect(isValidEmail('alice123@example42.com')).toBe(true);
        });

        it('accepts plus-aliases (still valid email format)', () => {
            expect(isValidEmail('alice+work@example.com')).toBe(true);
        });

        it('accepts dots in local part', () => {
            expect(isValidEmail('alice.smith@example.com')).toBe(true);
        });

        it('trims surrounding whitespace before validating', () => {
            expect(isValidEmail('  alice@example.com  ')).toBe(true);
        });

        it('accepts uppercase variants', () => {
            expect(isValidEmail('Alice@Example.COM')).toBe(true);
        });
    });

    describe(`isValidEmail — failure modes (${name})`, () => {
        it('rejects empty string', () => {
            expect(isValidEmail('')).toBe(false);
        });

        it('rejects whitespace-only', () => {
            expect(isValidEmail('   ')).toBe(false);
        });

        it('rejects null', () => {
            expect(isValidEmail(null)).toBe(false);
        });

        it('rejects undefined', () => {
            expect(isValidEmail(undefined)).toBe(false);
        });

        it('rejects non-strings', () => {
            expect(isValidEmail(123)).toBe(false);
            expect(isValidEmail({})).toBe(false);
            expect(isValidEmail([])).toBe(false);
        });

        it('rejects strings without @', () => {
            expect(isValidEmail('alice')).toBe(false);
            expect(isValidEmail('alice.example.com')).toBe(false);
        });

        it('rejects strings without TLD', () => {
            expect(isValidEmail('alice@example')).toBe(false);
        });

        it('rejects strings with spaces in the local or domain', () => {
            expect(isValidEmail('alice smith@example.com')).toBe(false);
            expect(isValidEmail('alice@exa mple.com')).toBe(false);
        });

        it('rejects strings exceeding 254 chars (RFC 5321 max)', () => {
            // 250-char local + '@b.com' (6 chars) = 256 chars, > 254 cap.
            const longLocal = 'a'.repeat(250);
            expect(isValidEmail(longLocal + '@b.com')).toBe(false);
            // Sanity: same email at exactly the cap should pass.
            const atCap = 'a'.repeat(254 - 6) + '@b.com';
            expect(isValidEmail(atCap)).toBe(true);
        });

        it('rejects multiple @ signs', () => {
            expect(isValidEmail('a@b@c.com')).toBe(false);
        });
    });

    describe(`normalizeEmail — Gmail / Googlemail (loose: dots stripped)`, () => {
        it('strips dots from local part for @gmail.com', () => {
            expect(normalizeEmail('alice.smith@gmail.com')).toBe('alicesmith@gmail.com');
        });

        it('strips dots for @googlemail.com', () => {
            expect(normalizeEmail('alice.smith@googlemail.com')).toBe('alicesmith@googlemail.com');
        });

        it('strips plus-alias AND dots together (Gmail)', () => {
            expect(normalizeEmail('alice.smith+work@gmail.com')).toBe('alicesmith@gmail.com');
        });

        it('lowercases mixed-case Gmail', () => {
            expect(normalizeEmail('Alice.Smith@GMAIL.COM')).toBe('alicesmith@gmail.com');
        });

        it('preserves googlemail.com domain (NOT collapsed to gmail.com)', () => {
            // Conservative interpretation of the spec — domain not collapsed.
            // M3 customer dedup can decide whether to collapse.
            expect(normalizeEmail('alice@googlemail.com')).toBe('alice@googlemail.com');
        });

        it('handles many dots (Gmail-loose)', () => {
            expect(normalizeEmail('a.l.i.c.e@gmail.com')).toBe('alice@gmail.com');
        });

        it('returns null for degenerate Gmail (only dots in local)', () => {
            expect(normalizeEmail('....@gmail.com')).toBe(null);  // local empty after dot strip
        });

        it('handles trailing whitespace + uppercase combined', () => {
            expect(normalizeEmail('  Alice.Smith+work@Gmail.Com  ')).toBe('alicesmith@gmail.com');
        });
    });

    describe(`normalizeEmail — non-Gmail (strict: dots significant)`, () => {
        it('preserves dots in @yahoo.com local', () => {
            expect(normalizeEmail('alice.smith@yahoo.com')).toBe('alice.smith@yahoo.com');
        });

        it('preserves dots in custom-domain local', () => {
            expect(normalizeEmail('alice.smith@example.com')).toBe('alice.smith@example.com');
        });

        it('strips plus-alias (non-Gmail)', () => {
            expect(normalizeEmail('alice+work@yahoo.com')).toBe('alice@yahoo.com');
        });

        it('lowercases mixed-case (non-Gmail)', () => {
            expect(normalizeEmail('Alice.Smith@YAHOO.COM')).toBe('alice.smith@yahoo.com');
        });

        it('strips plus-alias but keeps dots (non-Gmail)', () => {
            expect(normalizeEmail('alice.smith+work@example.com')).toBe('alice.smith@example.com');
        });

        it('handles subdomain providers (dots significant)', () => {
            expect(normalizeEmail('alice@mail.example.com')).toBe('alice@mail.example.com');
        });

        it('returns null for degenerate non-Gmail (plus-alias only)', () => {
            expect(normalizeEmail('+work@example.com')).toBe(null);  // local empty after plus strip
        });

        it('handles NFC Unicode normalization (combining chars)', () => {
            // 'café' (precomposed) and 'café' (decomposed e + combining acute)
            // should normalize to the same form.
            const decomposed = 'café@example.com';
            const result = normalizeEmail(decomposed);
            // After NFC normalize + lowercase: should equal precomposed lowercase 'café@example.com'
            expect(result).toBe('café@example.com'.normalize('NFC'));
        });
    });

    describe(`normalizeEmail — invalid inputs return null (${name})`, () => {
        it('returns null for empty string', () => {
            expect(normalizeEmail('')).toBe(null);
        });

        it('returns null for null/undefined', () => {
            expect(normalizeEmail(null)).toBe(null);
            expect(normalizeEmail(undefined)).toBe(null);
        });

        it('returns null for non-string inputs', () => {
            expect(normalizeEmail(123)).toBe(null);
            expect(normalizeEmail({})).toBe(null);
        });

        it('returns null for invalid email shapes', () => {
            expect(normalizeEmail('alice')).toBe(null);
            expect(normalizeEmail('alice@')).toBe(null);
            expect(normalizeEmail('@example.com')).toBe(null);
            expect(normalizeEmail('alice@example')).toBe(null);
        });
    });
}
