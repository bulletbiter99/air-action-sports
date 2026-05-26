// (milestone-only behavior, not in audit Group B)
//
// The webhook handler acts on `checkout.session.completed` (M1+) and
// `charge.dispute.created` (M6 B6). All other event types are accepted
// (signature still validated → 200 {received:true}) but trigger NO handler
// logic, NO DB activity, NO email queue. This test pins the "unhandled"
// list — when a new event handler lands (e.g. B6 added dispute handling),
// remove that event type from NON_COMPLETION_EVENTS below.
//
// Source: worker/routes/webhooks.js webhooks.post('/stripe', ...).

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';
import {
    createWebhookFixture,
    bindWebhookFixture,
    createCapturedCtx,
} from '../../helpers/webhookFixture.js';

const NON_COMPLETION_EVENTS = [
    'charge.refunded',
    // 'charge.dispute.created' was here pre-M6 B6; now handled — see
    // tests/unit/webhook/dispute-created-handler.test.js.
    'charge.dispute.closed',
    'charge.dispute.updated',
    'charge.dispute.funds_withdrawn',
    'charge.dispute.funds_reinstated',
    'payment_intent.payment_failed',
    'invoice.paid',
    'customer.subscription.created',
    'radar.early_fraud_warning.created',
];

describe('webhook handler — non-checkout.session.completed events', () => {
    for (const eventType of NON_COMPLETION_EVENTS) {
        it(`accepts ${eventType} with {received:true} but does no DB work`, async () => {
            const env = createMockEnv();
            const fixture = createWebhookFixture({ eventType });
            bindWebhookFixture(env.DB, fixture);

            const { signatureHeader, body } = await signStripeWebhook({
                payload: fixture.stripeEvent,
                secret: env.STRIPE_WEBHOOK_SECRET,
            });
            const { ctx, captured } = createCapturedCtx();
            const req = new Request('https://airactionsport.com/api/webhooks/stripe', {
                method: 'POST',
                headers: { 'Stripe-Signature': signatureHeader },
                body,
            });
            const res = await worker.fetch(req, env, ctx);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.received).toBe(true);

            // For non-completion events, handleCheckoutCompleted is not called,
            // so NO D1 queries are issued at all (not even the booking lookup).
            expect(env.DB.__writes()).toHaveLength(0);
            expect(captured).toHaveLength(0);
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });
    }
});
