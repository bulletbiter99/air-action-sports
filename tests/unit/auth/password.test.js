// audit Group F #54-#56 — worker/lib/password.js
//
// PBKDF2-SHA256 password hashing. Stored format:
//   pbkdf2$<iterations>$<salt-b64>$<hash-b64>
//
// F54: verifyPassword returns true for matching hash
// F55: verifyPassword returns false for non-matching hash
// F56: hashPassword is non-deterministic (different salt each call)

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../worker/lib/password.js';

describe('password (Group F characterization)', () => {
    it('F54: verifyPassword returns true for matching hash', async () => {
        const pwd = 'correct horse battery staple';
        const stored = await hashPassword(pwd);
        const ok = await verifyPassword(pwd, stored);
        expect(ok).toBe(true);
    });

    it('F55: verifyPassword returns false for non-matching hash', async () => {
        const stored = await hashPassword('correct horse battery staple');
        expect(await verifyPassword('wrong password', stored)).toBe(false);
        // Empty / nullish / wrong-format inputs all return false (defensive guard)
        expect(await verifyPassword('', stored)).toBe(false);
        expect(await verifyPassword('any', null)).toBe(false);
        expect(await verifyPassword('any', '')).toBe(false);
        expect(await verifyPassword('any', 'not$pbkdf2$format')).toBe(false);
        expect(await verifyPassword('any', 'pbkdf2$only-three-parts')).toBe(false);
        // Iterations below the floor (1000) rejected even on a valid-shape stored value
        expect(await verifyPassword('any', 'pbkdf2$500$AAAA$BBBB')).toBe(false);
    });

    it('F56: hashPassword is non-deterministic (random salt each call)', async () => {
        const pwd = 'same input';
        const a = await hashPassword(pwd);
        const b = await hashPassword(pwd);
        expect(a).not.toBe(b);
        // Format sanity: pbkdf2$<iters>$<salt-b64>$<hash-b64>, 4 segments
        const partsA = a.split('$');
        const partsB = b.split('$');
        expect(partsA).toHaveLength(4);
        expect(partsB).toHaveLength(4);
        expect(partsA[0]).toBe('pbkdf2');
        expect(partsA[1]).toBe('100000');
        // Different salts → different hash bytes too
        expect(partsA[2]).not.toBe(partsB[2]);
        expect(partsA[3]).not.toBe(partsB[3]);
        // Yet both verify as the same password
        expect(await verifyPassword(pwd, a)).toBe(true);
        expect(await verifyPassword(pwd, b)).toBe(true);
    });
});
