// Tests for the attendee-review ID/token generators in worker/lib/ids.js
// (migration 0077) plus the shared randomId primitive they build on.
//
// worker/lib/ids.js is a do-not-touch "ID format contract" file (every printed
// ticket + stored row depends on the exact prefixes/lengths). These lock the
// review helpers added for the reviews feature:
//   * reviewToken() is 40 base62 chars — this length is the SECURITY contract
//     (a bearer of the token can write a PUBLIC review feeding aggregateRating),
//     and it is mirrored by REVIEW_TOKEN_LEN=40 + TOKEN_RE (^[0-9A-Za-z]{40}$)
//     in worker/routes/reviews.js. If someone changes the length here, the API
//     token-shape guard silently rejects every real link — this test catches it.
//   * reviewId() is `rv_` + a 14-char base62 body (matching bk_/at_/cus_).

import { describe, it, expect } from 'vitest';
import { randomId, reviewId, reviewToken } from '../../../worker/lib/ids.js';

// Mirror of worker/routes/reviews.js TOKEN_RE — keep in sync.
const TOKEN_RE = /^[0-9A-Za-z]{40}$/;
const REVIEW_ID_RE = /^rv_[0-9A-Za-z]{14}$/;
const BASE62_RE = /^[0-9A-Za-z]*$/;

describe('randomId — shared primitive', () => {
    it('returns exactly the requested length', () => {
        for (const n of [1, 6, 12, 14, 24, 40]) {
            expect(randomId(n)).toHaveLength(n);
        }
    });

    it('uses only the base62 alphabet (URL-safe, no padding/symbols)', () => {
        for (let i = 0; i < 50; i++) {
            expect(randomId(40)).toMatch(BASE62_RE);
        }
    });

    it('is random — 1000 length-40 ids are all distinct', () => {
        const seen = new Set();
        for (let i = 0; i < 1000; i++) seen.add(randomId(40));
        expect(seen.size).toBe(1000);
    });
});

describe('reviewToken — per-booking review link token', () => {
    it('is exactly 40 base62 chars and satisfies the API TOKEN_RE contract', () => {
        const t = reviewToken();
        expect(t).toHaveLength(40);
        expect(t).toMatch(TOKEN_RE);
    });

    it('is unguessably unique across many generations', () => {
        const seen = new Set();
        for (let i = 0; i < 1000; i++) seen.add(reviewToken());
        expect(seen.size).toBe(1000);
    });
});

describe('reviewId — review row id', () => {
    it('is `rv_` + a 14-char base62 body', () => {
        const id = reviewId();
        expect(id).toMatch(REVIEW_ID_RE);
        expect(id.startsWith('rv_')).toBe(true);
        expect(id.slice(3)).toHaveLength(14);
    });

    it('is unique across many generations', () => {
        const seen = new Set();
        for (let i = 0; i < 1000; i++) seen.add(reviewId());
        expect(seen.size).toBe(1000);
    });
});
