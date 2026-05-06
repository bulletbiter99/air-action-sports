// (milestone-only behavior, not in audit Group B)
//
// After handleCheckoutCompleted resolves, the webhook handler queues
// sendBookingEmails via ctx.waitUntil. That helper calls
// sendBookingConfirmation which posts to Resend with the
// booking_confirmation template tagged appropriately.
//
// Source:
//   worker/routes/webhooks.js lines 60-63: ctx.waitUntil(sendBookingEmails)
//   worker/routes/webhooks.js sendBookingEmails: try { await sendBookingConfirmation }
//   worker/lib/emailSender.js sendBookingConfirmation: tags include
//     'type=booking_confirmation' and 'booking_id=<bookingId>'

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';
import { mockResendFetch } from '../../helpers/mockResend.js';
import {
    createWebhookFixture,
    bindWebhookFixture,
    createCapturedCtx,
} from '../../helpers/webhookFixture.js';

function findResendCalls(filter) {
    return globalThis.fetch.mock.calls
        .filter(c => {
            const url = typeof c[0] === 'string' ? c[0] : c[0].url;
            return url === 'https://api.resend.com/emails';
        })
        .filter(c => {
            try {
                const body = JSON.parse(c[1].body);
                return filter(body);
            } catch {
                return false;
            }
        });
}

describe('handleCheckoutCompleted — booking_confirmation email', () => {
    it('queues booking_confirmation send to the buyer email', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const fixture = createWebhookFixture();
        bindWebhookFixture(env.DB, fixture, { withEmailTemplates: true });

        const { signatureHeader, body } = await signStripeWebhook({
            payload: fixture.stripeEvent,
            secret: env.STRIPE_WEBHOOK_SECRET,
        });
        const { ctx, flush } = createCapturedCtx();
        const req = new Request('https://airactionsport.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'Stripe-Signature': signatureHeader },
            body,
        });
        const res = await worker.fetch(req, env, ctx);
        await flush();

        expect(res.status).toBe(200);

        const confirmationCalls = findResendCalls(body =>
            body.tags?.some(t => t.name === 'type' && t.value === 'booking_confirmation')
        );
        expect(confirmationCalls).toHaveLength(1);

        const sentBody = JSON.parse(confirmationCalls[0][1].body);
        expect(sentBody.to).toEqual([fixture.booking.email]);
    });

    it('tags the confirmation with booking_id', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const fixture = createWebhookFixture();
        bindWebhookFixture(env.DB, fixture, { withEmailTemplates: true });

        const { signatureHeader, body } = await signStripeWebhook({
            payload: fixture.stripeEvent,
            secret: env.STRIPE_WEBHOOK_SECRET,
        });
        const { ctx, flush } = createCapturedCtx();
        const req = new Request('https://airactionsport.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'Stripe-Signature': signatureHeader },
            body,
        });
        await worker.fetch(req, env, ctx);
        await flush();

        const calls = findResendCalls(b =>
            b.tags?.some(t => t.name === 'type' && t.value === 'booking_confirmation')
        );
        const sent = JSON.parse(calls[0][1].body);
        const bookingTag = sent.tags.find(t => t.name === 'booking_id');
        expect(bookingTag).toBeDefined();
        expect(bookingTag.value).toBe(fixture.bookingId);
    });

    it('does NOT send booking_confirmation when the template is missing', async () => {
        // No withEmailTemplates flag → loadTemplate returns null →
        // sendBookingConfirmation returns { skipped: 'template_missing' }
        // → no fetch.
        const env = createMockEnv();
        mockResendFetch();  // installed but should never be called
        const fixture = createWebhookFixture();
        bindWebhookFixture(env.DB, fixture);  // no email templates

        const { signatureHeader, body } = await signStripeWebhook({
            payload: fixture.stripeEvent,
            secret: env.STRIPE_WEBHOOK_SECRET,
        });
        const { ctx, flush } = createCapturedCtx();
        const req = new Request('https://airactionsport.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'Stripe-Signature': signatureHeader },
            body,
        });
        await worker.fetch(req, env, ctx);
        await flush();

        const confirmationCalls = findResendCalls(b =>
            b.tags?.some(t => t.name === 'type' && t.value === 'booking_confirmation')
        );
        expect(confirmationCalls).toHaveLength(0);
    });
});
