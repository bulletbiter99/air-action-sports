// audit Group B #16 — verifyWebhookSignature rejects timestamps outside
// the tolerance window (default 300 seconds, ±5 minutes).
//
// Locks the tolerance behavior:
//   - Default tolerance = 300 seconds
//   - Symmetric: rejects both stale-past and stale-future timestamps
//   - Tolerance is configurable via the `tolerance` arg
//
// Source: worker/lib/stripe.js verifyWebhookSignature (lines 105-108).

import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../../worker/lib/stripe.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';

describe('verifyWebhookSignature — timestamp tolerance', () => {
    it('rejects a timestamp older than 5 minutes (default tolerance=300)', async () => {
        const secret = 'whsec_test';
        const sixMinAgo = Math.floor(Date.now() / 1000) - 6 * 60;
        const { signatureHeader, body } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
            timestamp: sixMinAgo,
        });
        await expect(verifyWebhookSignature({ body, signatureHeader, secret }))
            .rejects.toThrow('Webhook timestamp outside tolerance');
    });

    it('rejects a timestamp from the far future (>5 minutes ahead)', async () => {
        // Symmetric tolerance: replay-from-future is also rejected.
        const secret = 'whsec_test';
        const tenMinAhead = Math.floor(Date.now() / 1000) + 10 * 60;
        const { signatureHeader, body } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
            timestamp: tenMinAhead,
        });
        await expect(verifyWebhookSignature({ body, signatureHeader, secret }))
            .rejects.toThrow('Webhook timestamp outside tolerance');
    });

    it('accepts a timestamp 4 minutes ago (within tolerance)', async () => {
        const secret = 'whsec_test';
        const fourMinAgo = Math.floor(Date.now() / 1000) - 4 * 60;
        const { signatureHeader, body } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
            timestamp: fourMinAgo,
        });
        const event = await verifyWebhookSignature({ body, signatureHeader, secret });
        expect(event.type).toBe('foo');
    });

    it('respects a custom tolerance argument (wider window)', async () => {
        const secret = 'whsec_test';
        const tenMinAgo = Math.floor(Date.now() / 1000) - 10 * 60;
        const { signatureHeader, body } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
            timestamp: tenMinAgo,
        });
        // Default tolerance=300 would reject. tolerance=900 (15 min) accepts.
        const event = await verifyWebhookSignature({ body, signatureHeader, secret, tolerance: 900 });
        expect(event.type).toBe('foo');
    });

    it('respects a custom tolerance argument (narrower window)', async () => {
        const secret = 'whsec_test';
        const twoMinAgo = Math.floor(Date.now() / 1000) - 2 * 60;
        const { signatureHeader, body } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
            timestamp: twoMinAgo,
        });
        // tolerance=60 (1 min) rejects a 2-min-old timestamp.
        await expect(verifyWebhookSignature({ body, signatureHeader, secret, tolerance: 60 }))
            .rejects.toThrow('Webhook timestamp outside tolerance');
    });
});
