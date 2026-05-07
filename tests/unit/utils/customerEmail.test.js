// Tests for src/utils/customerEmail.js — client-side mirror of
// worker/lib/customerEmail.js. Identical test cases — proves the
// dual-target byte-identical behavior required by decision register #32.
//
// If the two test suites diverge, one of the libs has drifted from the
// other and B4/B5/B8's behavior depends on the matching pair. Keep in sync.

import { describe, it, expect } from 'vitest';
import {
    normalizeEmail,
    extractBaseEmail,
    isGmailLike,
    emailsMatch,
} from '../../../src/utils/customerEmail.js';

describe('normalizeEmail — Gmail family (client mirror)', () => {
    it('collapses Gmail dot-variants to a single canonical form', () => {
        const variants = [
            'sarahchen@gmail.com',
            'sarah.chen@gmail.com',
            'sar.ahchen@gmail.com',
            'sarah.c.hen@gmail.com',
            's.a.r.a.h.c.h.e.n@gmail.com',
        ];
        const canonical = normalizeEmail(variants[0]);
        expect(canonical).toBe('sarahchen@gmail.com');
        for (const v of variants) {
            expect(normalizeEmail(v)).toBe(canonical);
        }
    });

    it('collapses Gmail plus-aliases to base address', () => {
        const variants = [
            'mike@gmail.com',
            'mike+aas@gmail.com',
            'mike+anything@gmail.com',
            'mike+events.test@gmail.com',
        ];
        const canonical = normalizeEmail(variants[0]);
        expect(canonical).toBe('mike@gmail.com');
        for (const v of variants) {
            expect(normalizeEmail(v)).toBe(canonical);
        }
    });

    it('canonicalizes googlemail.com → gmail.com', () => {
        expect(normalizeEmail('user@googlemail.com')).toBe('user@gmail.com');
        expect(normalizeEmail('user@gmail.com')).toBe('user@gmail.com');
        expect(normalizeEmail('user.name+tag@googlemail.com')).toBe('username@gmail.com');
    });

    it('combines all Gmail rules: dots + plus + googlemail + case', () => {
        const allEightVariants = [
            'sarahchen@gmail.com',
            'sarah.chen@gmail.com',
            'sar.ahchen@gmail.com',
            'sarah.c.hen@gmail.com',
            's.a.r.a.h.c.h.e.n@gmail.com',
            'Sarah.Chen@gmail.com',
            'SARAHCHEN@gmail.com',
            'sarah.chen@googlemail.com',
        ];
        const expected = 'sarahchen@gmail.com';
        for (const v of allEightVariants) {
            expect(normalizeEmail(v)).toBe(expected);
        }
    });
});

describe('normalizeEmail — non-Gmail providers (client mirror)', () => {
    it('preserves dots (different addresses)', () => {
        expect(normalizeEmail('john.doe@yahoo.com')).toBe('john.doe@yahoo.com');
        expect(normalizeEmail('johndoe@yahoo.com')).toBe('johndoe@yahoo.com');
        expect(normalizeEmail('john.doe@yahoo.com')).not.toBe(
            normalizeEmail('johndoe@yahoo.com'),
        );
    });

    it('strips plus-aliases (CAN-SPAM rationale)', () => {
        expect(normalizeEmail('john@yahoo.com')).toBe('john@yahoo.com');
        expect(normalizeEmail('john+anything@yahoo.com')).toBe('john@yahoo.com');
        expect(normalizeEmail('user+aas@outlook.com')).toBe('user@outlook.com');
        expect(normalizeEmail('user+events@protonmail.com')).toBe('user@protonmail.com');
    });

    it('preserves subdomain emails as-is', () => {
        expect(normalizeEmail('user@mail.example.com')).toBe('user@mail.example.com');
        expect(normalizeEmail('admin@docs.company.io')).toBe('admin@docs.company.io');
    });
});

describe('normalizeEmail — case + whitespace + Unicode (client mirror)', () => {
    it('lowercases consistently', () => {
        expect(normalizeEmail('Sarah@Gmail.com')).toBe('sarah@gmail.com');
        expect(normalizeEmail('USER@YAHOO.COM')).toBe('user@yahoo.com');
        expect(normalizeEmail('John+Test@Yahoo.com')).toBe('john@yahoo.com');
    });

    it('strips leading/trailing whitespace', () => {
        expect(normalizeEmail('  sarah@gmail.com  ')).toBe('sarah@gmail.com');
        expect(normalizeEmail('\tsarah@gmail.com\n')).toBe('sarah@gmail.com');
    });

    it('NFC-normalizes Unicode (precomposed vs decomposed)', () => {
        const precomposed = 'café@example.com';
        const decomposed = 'café@example.com';
        expect(normalizeEmail(precomposed)).toBe(normalizeEmail(decomposed));
    });
});

describe('normalizeEmail — invalid inputs (client mirror)', () => {
    it('returns null for null / undefined', () => {
        expect(normalizeEmail(null)).toBe(null);
        expect(normalizeEmail(undefined)).toBe(null);
    });

    it('returns null for empty string / whitespace-only', () => {
        expect(normalizeEmail('')).toBe(null);
        expect(normalizeEmail('   ')).toBe(null);
        expect(normalizeEmail('\t\n')).toBe(null);
    });

    it('returns null when no @ present', () => {
        expect(normalizeEmail('noatsign')).toBe(null);
        expect(normalizeEmail('nohost')).toBe(null);
    });

    it('returns null when multiple @ present', () => {
        expect(normalizeEmail('weird@@example.com')).toBe(null);
        expect(normalizeEmail('a@b@c.com')).toBe(null);
        expect(normalizeEmail('user@@gmail.com')).toBe(null);
    });

    it('returns null for empty local part', () => {
        expect(normalizeEmail('@gmail.com')).toBe(null);
    });

    it('returns null for empty domain', () => {
        expect(normalizeEmail('user@')).toBe(null);
    });

    it('returns null when entire local part is plus-alias', () => {
        expect(normalizeEmail('+test@gmail.com')).toBe(null);
        expect(normalizeEmail('+anything@yahoo.com')).toBe(null);
    });

    it('returns null for non-string types', () => {
        expect(normalizeEmail(42)).toBe(null);
        expect(normalizeEmail({})).toBe(null);
        expect(normalizeEmail([])).toBe(null);
        expect(normalizeEmail(true)).toBe(null);
    });
});

describe('isGmailLike (client mirror)', () => {
    it('returns true for gmail.com', () => {
        expect(isGmailLike('gmail.com')).toBe(true);
    });

    it('returns true for googlemail.com', () => {
        expect(isGmailLike('googlemail.com')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isGmailLike('Gmail.com')).toBe(true);
        expect(isGmailLike('GMAIL.COM')).toBe(true);
        expect(isGmailLike('GoogleMail.com')).toBe(true);
    });

    it('strips whitespace', () => {
        expect(isGmailLike('  gmail.com  ')).toBe(true);
    });

    it('returns false for non-Gmail providers', () => {
        expect(isGmailLike('yahoo.com')).toBe(false);
        expect(isGmailLike('outlook.com')).toBe(false);
        expect(isGmailLike('protonmail.com')).toBe(false);
        expect(isGmailLike('example.com')).toBe(false);
    });

    it('returns false for Gmail subdomains', () => {
        expect(isGmailLike('mail.gmail.com')).toBe(false);
        expect(isGmailLike('gmail.com.example.com')).toBe(false);
    });

    it('returns false for empty / null / non-string', () => {
        expect(isGmailLike('')).toBe(false);
        expect(isGmailLike(null)).toBe(false);
        expect(isGmailLike(undefined)).toBe(false);
        expect(isGmailLike(42)).toBe(false);
    });
});

describe('extractBaseEmail (client mirror)', () => {
    it('returns the canonical normalized form (alias for normalizeEmail)', () => {
        expect(extractBaseEmail('Sarah.Chen+aas@Gmail.com')).toBe('sarahchen@gmail.com');
        expect(extractBaseEmail('john.doe@yahoo.com')).toBe('john.doe@yahoo.com');
        expect(extractBaseEmail('weird@@example.com')).toBe(null);
        expect(extractBaseEmail(null)).toBe(null);
    });
});

describe('emailsMatch (client mirror)', () => {
    it('returns true for two equivalent Gmail dot-variants', () => {
        expect(emailsMatch('sarahchen@gmail.com', 'sarah.chen@gmail.com')).toBe(true);
        expect(emailsMatch('Sarah.Chen+aas@gmail.com', 'sarahchen@googlemail.com')).toBe(true);
    });

    it('returns true for two equivalent non-Gmail plus-aliases', () => {
        expect(emailsMatch('john@yahoo.com', 'john+test@yahoo.com')).toBe(true);
    });

    it('returns false for non-equivalent emails', () => {
        expect(emailsMatch('john.doe@yahoo.com', 'johndoe@yahoo.com')).toBe(false);
        expect(emailsMatch('user@gmail.com', 'user@yahoo.com')).toBe(false);
        expect(emailsMatch('alice@gmail.com', 'bob@gmail.com')).toBe(false);
    });

    it('returns false when either side normalizes to null', () => {
        expect(emailsMatch(null, 'sarah@gmail.com')).toBe(false);
        expect(emailsMatch('sarah@gmail.com', null)).toBe(false);
        expect(emailsMatch(null, null)).toBe(false);
        expect(emailsMatch('weird@@example.com', 'sarah@gmail.com')).toBe(false);
        expect(emailsMatch('sarah@gmail.com', 'noatsign')).toBe(false);
    });

    it('is symmetric (a,b) === (b,a)', () => {
        const a = 'sarah.chen@gmail.com';
        const b = 'sarahchen@googlemail.com';
        expect(emailsMatch(a, b)).toBe(emailsMatch(b, a));
        expect(emailsMatch(a, b)).toBe(true);
    });
});
