// audit Group F #62-#64 — worker/lib/vendorToken.js
//
// HMAC-SHA256-signed magic-link tokens for vendor packages. Payload embeds
// (event_vendor_id, token_version, exp). The lib's verifyVendorToken
// validates signature + expiry + shape and returns the payload; the caller
// is responsible for comparing the embedded `tv` against the current
// event_vendors.token_version (per the vendorToken.js header comment).
//
// F62: verifyVendorToken accepts a fresh token (returns the embedded payload)
// F63: verifyVendorToken refuses an expired token (returns null)
// F64: verifyVendorToken preserves the embedded `tv` so the caller can detect
//      a token from a previous token_version (post-revoke check)

import { describe, it, expect } from 'vitest';
import { createVendorToken, verifyVendorToken } from '../../../worker/lib/vendorToken.js';

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';

describe('verifyVendorToken (Group F characterization)', () => {
    it('F62: accepts a fresh (non-expired, valid signature) token', async () => {
        const futureMs = Date.now() + 60 * 60 * 1000;
        const token = await createVendorToken('ev_abc', 1, futureMs, SECRET);
        const payload = await verifyVendorToken(token, SECRET);
        expect(payload).toBeTruthy();
        expect(payload.evid).toBe('ev_abc');
        expect(payload.tv).toBe(1);
        expect(typeof payload.exp).toBe('number');
    });

    it('F63: refuses an expired token (returns null)', async () => {
        const pastMs = Date.now() - 60 * 1000;
        const token = await createVendorToken('ev_old', 1, pastMs, SECRET);
        const payload = await verifyVendorToken(token, SECRET);
        expect(payload).toBeNull();
    });

    it('F64: preserves embedded tv so caller can compare against current token_version (post-revoke)', async () => {
        const futureMs = Date.now() + 60 * 60 * 1000;

        // Issued at tv=1
        const oldToken = await createVendorToken('ev_revoked', 1, futureMs, SECRET);

        // Verify still works on signature/expiry — the lib does NOT check
        // tv against any DB; that's the caller's job.
        const payload = await verifyVendorToken(oldToken, SECRET);
        expect(payload).toBeTruthy();
        expect(payload.tv).toBe(1);

        // Caller's responsibility: compare embedded tv against current row's
        // token_version. Simulating the post-revoke check:
        const currentTokenVersionFromDb = 2;  // admin called /revoke, bumped to 2
        const isRevoked = payload.tv < currentTokenVersionFromDb;
        expect(isRevoked).toBe(true);

        // A freshly-minted token at tv=2 would pass this check.
        const newToken = await createVendorToken('ev_revoked', 2, futureMs, SECRET);
        const newPayload = await verifyVendorToken(newToken, SECRET);
        expect(newPayload.tv).toBe(2);
        expect(newPayload.tv < currentTokenVersionFromDb).toBe(false);
    });

    it('F64 (also): refuses a token signed with a different secret (signature mismatch → null)', async () => {
        const token = await createVendorToken('ev_x', 1, Date.now() + 60_000, SECRET);
        const payload = await verifyVendorToken(token, 'different_secret_padded_to_32_bytes_or_more!');
        expect(payload).toBeNull();
    });

    it('F64 (also): refuses malformed input (no dot, empty, non-string)', async () => {
        expect(await verifyVendorToken(null, SECRET)).toBeNull();
        expect(await verifyVendorToken('', SECRET)).toBeNull();
        expect(await verifyVendorToken('no-dot-token', SECRET)).toBeNull();
        expect(await verifyVendorToken(12345, SECRET)).toBeNull();
        expect(await verifyVendorToken('a.b.c', SECRET)).toBeNull();  // 3 parts, not 2
    });
});
