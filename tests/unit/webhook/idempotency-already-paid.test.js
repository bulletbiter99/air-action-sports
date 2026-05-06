// audit Group B #19 — handleCheckoutCompleted is idempotent on duplicate
// delivery. When the booking already has status='paid', the handler
// returns early with no DB writes, no email queue, no audit emission.
//
// Source: worker/routes/webhooks.js handleCheckoutCompleted lines 115-116:
//   if (bookingRow.status === 'paid') return;

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';
import {
    createWebhookFixture,
    bindWebhookFixture,
    createCapturedCtx,
} from '../../helpers/webhookFixture.js';

describe('handleCheckoutCompleted — idempotency on already-paid bookings', () => {
    it('returns early when booking.status === "paid": no DB writes, no email queue', async () => {
        const env = createMockEnv();

        const fixture = createWebhookFixture({ bookingStatus: 'paid' });
        bindWebhookFixture(env.DB, fixture);

        const { signatureHeader, body } = await signStripeWebhook({
            payload: fixture.stripeEvent,
            secret: env.STRIPE_WEBHOOK_SECRET,
        });
        const { ctx, captured, flush } = createCapturedCtx();
        const req = new Request('https://airactionsport.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signatureHeader },
            body,
        });
        const res = await worker.fetch(req, env, ctx);
        await flush();

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.received).toBe(true);

        // No write operations. The only D1 call is the SELECT for the
        // booking lookup; no attendee inserts, no audit_log inserts, no
        // ticket_types updates, no promo_codes updates.
        const writes = env.DB.__writes();
        const runs = writes.filter(w => w.kind === 'run');
        expect(runs).toHaveLength(0);

        // No outbound HTTP — no Resend calls, no Stripe calls.
        expect(globalThis.fetch).not.toHaveBeenCalled();

        // ctx.waitUntil not invoked — handleCheckoutCompleted returns
        // undefined (no emailContext), so the webhook handler's
        // `if (result?.emailContext && c.executionCtx?.waitUntil)` short-circuits.
        expect(captured).toHaveLength(0);
    });

    it('still returns 200 {received:true} on already-paid (Stripe retry-friendly)', async () => {
        // Stripe retries failed deliveries with exponential backoff. A 4xx
        // would cause Stripe to retry indefinitely. Idempotency MUST be
        // achieved with a 200, not a 409 / 422.
        const env = createMockEnv();
        const fixture = createWebhookFixture({ bookingStatus: 'paid' });
        bindWebhookFixture(env.DB, fixture);

        const { signatureHeader, body } = await signStripeWebhook({
            payload: fixture.stripeEvent,
            secret: env.STRIPE_WEBHOOK_SECRET,
        });
        const { ctx } = createCapturedCtx();
        const req = new Request('https://airactionsport.com/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'Stripe-Signature': signatureHeader },
            body,
        });
        const res = await worker.fetch(req, env, ctx);
        expect(res.status).toBe(200);
    });
});
