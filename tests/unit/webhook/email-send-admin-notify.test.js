// (milestone-only behavior, not in audit Group B)
//
// sendBookingEmails also fires sendAdminNotify in parallel with the
// confirmation. The admin email goes to env.ADMIN_NOTIFY_EMAIL (not the
// buyer's address) and is tagged 'type=admin_notify'.
//
// Source: worker/lib/emailSender.js sendAdminNotify (lines 65-96).

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

function findResendCallsByType(typeValue) {
    return globalThis.fetch.mock.calls
        .filter(c => {
            const url = typeof c[0] === 'string' ? c[0] : c[0].url;
            return url === 'https://api.resend.com/emails';
        })
        .filter(c => {
            try {
                const body = JSON.parse(c[1].body);
                return body.tags?.some(t => t.name === 'type' && t.value === typeValue);
            } catch {
                return false;
            }
        });
}

describe('handleCheckoutCompleted — admin_notify email', () => {
    it('queues admin_notify send to env.ADMIN_NOTIFY_EMAIL', async () => {
        const env = createMockEnv({
            ADMIN_NOTIFY_EMAIL: 'ops@airactionsport-test.com',
        });
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

        const adminCalls = findResendCallsByType('admin_notify');
        expect(adminCalls).toHaveLength(1);

        const sent = JSON.parse(adminCalls[0][1].body);
        expect(sent.to).toEqual(['ops@airactionsport-test.com']);
    });

    it('does NOT send admin_notify when ADMIN_NOTIFY_EMAIL is unset', async () => {
        // sendAdminNotify short-circuits with { skipped: 'no_admin_email' }
        // when env.ADMIN_NOTIFY_EMAIL is falsy.
        const env = createMockEnv({ ADMIN_NOTIFY_EMAIL: '' });
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

        const adminCalls = findResendCallsByType('admin_notify');
        expect(adminCalls).toHaveLength(0);
    });

    it('admin_notify and booking_confirmation are sent in parallel (both fire)', async () => {
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

        expect(findResendCallsByType('booking_confirmation')).toHaveLength(1);
        expect(findResendCallsByType('admin_notify')).toHaveLength(1);
    });
});
