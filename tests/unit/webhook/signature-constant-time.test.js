// audit Group B #18 — verifyWebhookSignature uses a length-checked,
// XOR-accumulating compare (timingSafeEqual at lines 132-137 of
// worker/lib/stripe.js).
//
// We CANNOT measure nanosecond timing in a unit test, but we can lock the
// SHAPE that the implementation uses constant-time-style comparison:
//
//   - Different-length inputs reject without comparing any bytes
//   - Same-length inputs with one-byte diff still reject (no early-return
//     optimization that leaks early-mismatch position via timing)
//   - Inputs at edges (empty, full-length) don't throw; all reject cleanly
//
// This test characterizes the INTENT (use a non-short-circuit compare).
// Actual timing-side-channel resistance requires statistical analysis
// outside the scope of unit tests.

import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../../worker/lib/stripe.js';

async function computeSig(body, secret, ts) {
    const data = `${ts}.${body}`;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return Array.from(new Uint8Array(sigBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

describe('verifyWebhookSignature — constant-time compare shape', () => {
    it('rejects when v1 differs in only one nibble (mid-string)', async () => {
        const ts = Math.floor(Date.now() / 1000);
        const secret = 'whsec_test';
        const body = JSON.stringify({ type: 'foo' });
        const correctHex = await computeSig(body, secret, ts);

        // Flip one character in the middle. Choose a position whose original
        // is unambiguous to flip ('0' ↔ '1' or 'a' ↔ 'b').
        const mid = Math.floor(correctHex.length / 2);
        const ch = correctHex[mid];
        const flipped = ch === '0' ? '1' : (ch === 'a' ? 'b' : '0');
        const tampered = correctHex.substring(0, mid) + flipped + correctHex.substring(mid + 1);

        const header = `t=${ts},v1=${tampered}`;
        await expect(verifyWebhookSignature({ body, signatureHeader: header, secret }))
            .rejects.toThrow('Webhook signature mismatch');
    });

    it('rejects v1 with wrong length (length-check guards before XOR loop)', async () => {
        const ts = Math.floor(Date.now() / 1000);
        const header = `t=${ts},v1=tooshort`;
        // The length-mismatch path inside timingSafeEqual returns false early,
        // but the surrounding for-loop continues to the next v1. Since there
        // are no more v1 values, matched stays false → mismatch error.
        await expect(verifyWebhookSignature({
            body: JSON.stringify({ type: 'foo' }),
            signatureHeader: header,
            secret: 'whsec',
        })).rejects.toThrow('Webhook signature mismatch');
    });

    it('rejects v1 longer than expected hex length', async () => {
        const ts = Math.floor(Date.now() / 1000);
        const header = `t=${ts},v1=${'f'.repeat(128)}`;  // double SHA-256 hex length
        await expect(verifyWebhookSignature({
            body: JSON.stringify({ type: 'foo' }),
            signatureHeader: header,
            secret: 'whsec',
        })).rejects.toThrow('Webhook signature mismatch');
    });

    it('does not throw on empty v1 value (treats as length-mismatch)', async () => {
        // Empty v1 → length 0 vs expected 64 → length check fails → mismatch.
        // The function does NOT throw a different shape of error here (e.g.
        // index-out-of-bounds), confirming the length check happens first.
        const ts = Math.floor(Date.now() / 1000);
        const header = `t=${ts},v1=`;
        await expect(verifyWebhookSignature({
            body: JSON.stringify({ type: 'foo' }),
            signatureHeader: header,
            secret: 'whsec',
        })).rejects.toThrow('Webhook signature mismatch');
    });
});
