// audit Group B #14 — verifyWebhookSignature accepts a fresh signature
// (single v1, current timestamp).
//
// Source: worker/lib/stripe.js verifyWebhookSignature (lines 88-130).

import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../../worker/lib/stripe.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';

describe('verifyWebhookSignature — valid', () => {
    it('accepts a fresh signature with current timestamp + correct secret', async () => {
        const secret = 'whsec_test_secret';
        const payload = {
            id: 'evt_test',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_test_123', payment_intent: 'pi_test_123' } },
        };
        const { signatureHeader, body } = await signStripeWebhook({ payload, secret });

        const event = await verifyWebhookSignature({ body, signatureHeader, secret });
        expect(event.type).toBe('checkout.session.completed');
        expect(event.data.object.id).toBe('cs_test_123');
    });

    it('returns the parsed JSON body verbatim on success', async () => {
        const secret = 'whsec_test';
        const payload = { type: 'foo', extra: 'bar', nested: { k: 1 } };
        const { signatureHeader, body } = await signStripeWebhook({ payload, secret });

        const event = await verifyWebhookSignature({ body, signatureHeader, secret });
        expect(event).toEqual(payload);
    });

    it('handles a payload with strings containing JSON-special characters', async () => {
        // The body is signed VERBATIM — escape characters in strings need
        // to round-trip through JSON.stringify identically on both sides.
        const secret = 'whsec_test';
        const payload = { type: 'foo', text: 'Line 1\nLine 2 "quoted" \\backslash' };
        const { signatureHeader, body } = await signStripeWebhook({ payload, secret });

        const event = await verifyWebhookSignature({ body, signatureHeader, secret });
        expect(event.text).toBe('Line 1\nLine 2 "quoted" \\backslash');
    });
});
