// audit Group B #17 (split) — verifyWebhookSignature rejects malformed
// Stripe-Signature header. Plus the wrong-secret + tampered-body cases
// that fall under "invalid signature" generally.
//
// Error messages locked here:
//   "Missing Stripe-Signature header"  — null/undefined/empty header
//   "Malformed Stripe-Signature"        — no t= or no v1= present
//   "Webhook signature mismatch"        — t+v1 present but no v1 matches
//
// Source: worker/lib/stripe.js verifyWebhookSignature (lines 89, 103, 128).

import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../../worker/lib/stripe.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';

describe('verifyWebhookSignature — invalid', () => {
    it('throws when the secret is wrong', async () => {
        const { signatureHeader, body } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret: 'whsec_correct',
        });
        await expect(verifyWebhookSignature({
            body, signatureHeader, secret: 'whsec_WRONG',
        })).rejects.toThrow('Webhook signature mismatch');
    });

    it('throws when the body has been tampered with after signing', async () => {
        const secret = 'whsec_test';
        const { signatureHeader } = await signStripeWebhook({
            payload: { type: 'foo' },
            secret,
        });
        // Body tampered post-signing — same shape, different content.
        const tamperedBody = JSON.stringify({ type: 'foo', injected: 'evil' });
        await expect(verifyWebhookSignature({
            body: tamperedBody, signatureHeader, secret,
        })).rejects.toThrow('Webhook signature mismatch');
    });

    it('throws "Missing Stripe-Signature header" on null header', async () => {
        await expect(verifyWebhookSignature({
            body: '{}', signatureHeader: null, secret: 'whsec',
        })).rejects.toThrow('Missing Stripe-Signature header');
    });

    it('throws "Missing Stripe-Signature header" on undefined header', async () => {
        await expect(verifyWebhookSignature({
            body: '{}', signatureHeader: undefined, secret: 'whsec',
        })).rejects.toThrow('Missing Stripe-Signature header');
    });

    it('throws "Missing Stripe-Signature header" on empty-string header', async () => {
        await expect(verifyWebhookSignature({
            body: '{}', signatureHeader: '', secret: 'whsec',
        })).rejects.toThrow('Missing Stripe-Signature header');
    });

    it('throws "Malformed Stripe-Signature" when no v1= is present', async () => {
        const ts = Math.floor(Date.now() / 1000);
        await expect(verifyWebhookSignature({
            body: '{}', signatureHeader: `t=${ts}`, secret: 'whsec',
        })).rejects.toThrow('Malformed Stripe-Signature');
    });

    it('throws "Malformed Stripe-Signature" when no t= is present', async () => {
        await expect(verifyWebhookSignature({
            body: '{}', signatureHeader: 'v1=abc123', secret: 'whsec',
        })).rejects.toThrow('Malformed Stripe-Signature');
    });

    it('throws "Webhook signature mismatch" on empty v1= value', async () => {
        // `v1=` parses as a v1 entry (len=1), so passes the malformed check,
        // but timingSafeEqual length check fails → mismatch.
        const ts = Math.floor(Date.now() / 1000);
        await expect(verifyWebhookSignature({
            body: '{}', signatureHeader: `t=${ts},v1=`, secret: 'whsec',
        })).rejects.toThrow('Webhook signature mismatch');
    });
});
