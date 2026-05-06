// audit Group B #15 — verifyWebhookSignature accepts during rotation
// (multiple v1 values; only the second matches).
//
// Stripe sends two v1= values during webhook secret rotation: the new key's
// signature and the old key's signature. The receiver accepts if ANY v1
// matches the computed value with the configured secret.
//
// Source: worker/lib/stripe.js verifyWebhookSignature (lines 122-128):
//   for (const v1 of v1Values) {
//     if (timingSafeEqual(expected, v1)) { matched = true; break; }
//   }

import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../../worker/lib/stripe.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';

const BOGUS_V1 = 'a'.repeat(64);
const BOGUS_V1_2 = 'b'.repeat(64);

describe('verifyWebhookSignature — multiple v1 values (rotation support)', () => {
    it('accepts a header with a bogus v1 followed by the correct v1', async () => {
        const secret = 'whsec_test';
        // multiV1.appendCorrect=true (default) → header becomes:
        //   t=<ts>,v1=<bogus>,v1=<correct>
        const { signatureHeader, body } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
            multiV1: { values: [BOGUS_V1] },
        });
        const event = await verifyWebhookSignature({ body, signatureHeader, secret });
        expect(event.type).toBe('foo');
    });

    it('accepts a header where the correct v1 appears FIRST', async () => {
        // Manually build header so the correct v1 is first, bogus second.
        const secret = 'whsec_test';
        const ts = Math.floor(Date.now() / 1000);
        const { sigHex } = await signStripeWebhook({
            payload: { type: 'x' },
            secret,
            timestamp: ts,
        });
        const header = `t=${ts},v1=${sigHex},v1=${BOGUS_V1}`;
        const event = await verifyWebhookSignature({
            body: JSON.stringify({ type: 'x' }),
            signatureHeader: header,
            secret,
        });
        expect(event.type).toBe('x');
    });

    it('accepts a header with three v1 values where only the middle matches', async () => {
        const secret = 'whsec_test';
        const ts = Math.floor(Date.now() / 1000);
        const { sigHex } = await signStripeWebhook({
            payload: { type: 'mid' },
            secret,
            timestamp: ts,
        });
        const header = `t=${ts},v1=${BOGUS_V1},v1=${sigHex},v1=${BOGUS_V1_2}`;
        const event = await verifyWebhookSignature({
            body: JSON.stringify({ type: 'mid' }),
            signatureHeader: header,
            secret,
        });
        expect(event.type).toBe('mid');
    });

    it('rejects when ALL v1 values are wrong', async () => {
        const secret = 'whsec_test';
        const ts = Math.floor(Date.now() / 1000);
        const header = `t=${ts},v1=${BOGUS_V1},v1=${BOGUS_V1_2}`;
        await expect(verifyWebhookSignature({
            body: JSON.stringify({ type: 'x' }),
            signatureHeader: header,
            secret,
        })).rejects.toThrow('Webhook signature mismatch');
    });

    it('rejects multi-v1 with bogus values and an expired timestamp before checking signatures', async () => {
        // Order of checks: timestamp tolerance is checked before signature
        // match. A stale timestamp rejects regardless of how many v1s are
        // present.
        const secret = 'whsec_test';
        const oldTs = Math.floor(Date.now() / 1000) - 600;  // 10 min ago
        const { signatureHeader } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
            timestamp: oldTs,
            multiV1: { values: [BOGUS_V1, BOGUS_V1_2] },
        });
        await expect(verifyWebhookSignature({
            body: JSON.stringify({ type: 'foo' }),
            signatureHeader,
            secret,
        })).rejects.toThrow('Webhook timestamp outside tolerance');
    });
});
