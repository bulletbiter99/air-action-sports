// audit Group B #23 — handleCheckoutCompleted writes a "booking.paid"
// audit_log row with target_type='booking', target_id=booking.id, and
// meta_json containing { stripe_session_id, total_cents }.
//
// Source: worker/routes/webhooks.js lines 200-207:
//   INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
//   VALUES (NULL, 'booking.paid', 'booking', ?, ?, ?)
//   .bind(bookingRow.id, JSON.stringify({ stripe_session_id, total_cents }), now)
//
// Bind order: [target_id, meta_json_string, created_at_ms]. Note that
// 'booking.paid', 'booking', and NULL user_id are SQL literals, not binds.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';
import {
    createWebhookFixture,
    bindWebhookFixture,
    createCapturedCtx,
} from '../../helpers/webhookFixture.js';

async function postWebhook(env, fixture) {
    bindWebhookFixture(env.DB, fixture);
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
}

describe('handleCheckoutCompleted — booking.paid audit row', () => {
    it('writes a booking.paid audit row', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture();
        await postWebhook(env, fixture);

        const auditWrites = env.DB.__writes().filter(w =>
            w.kind === 'run' &&
            w.sql.includes('INSERT INTO audit_log') &&
            w.sql.includes("'booking.paid'")
        );
        expect(auditWrites).toHaveLength(1);
    });

    it('binds target_id = bookings.id, meta_json with stripe_session_id + total_cents, and created_at', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture();
        await postWebhook(env, fixture);

        const auditWrite = env.DB.__writes().find(w =>
            w.kind === 'run' &&
            w.sql.includes('INSERT INTO audit_log') &&
            w.sql.includes("'booking.paid'")
        );
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args[0]).toBe(fixture.bookingId);

        const meta = JSON.parse(auditWrite.args[1]);
        expect(meta.stripe_session_id).toBe(fixture.sessionId);
        expect(meta.total_cents).toBe(fixture.booking.total_cents);

        // created_at is ms epoch — recent.
        const ts = auditWrite.args[2];
        expect(typeof ts).toBe('number');
        expect(ts).toBeGreaterThan(Date.now() - 60_000);
        expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('uses literal target_type="booking" in the SQL (not a bound arg)', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture();
        await postWebhook(env, fixture);

        const auditWrite = env.DB.__writes().find(w =>
            w.kind === 'run' &&
            w.sql.includes('INSERT INTO audit_log') &&
            w.sql.includes("'booking.paid'")
        );
        // 'booking' is in the SQL VALUES clause as a literal, not in args.
        expect(auditWrite.sql).toContain("'booking'");
        expect(auditWrite.args).toHaveLength(3);
    });

    it('does NOT write booking.paid audit when handler returns early (idempotent path)', async () => {
        // Sanity reinforcement of the idempotency-already-paid characterization
        // from a separate file — booking.paid audit is gated on actual flip.
        const env = createMockEnv();
        const fixture = createWebhookFixture({ bookingStatus: 'paid' });
        await postWebhook(env, fixture);

        const auditWrites = env.DB.__writes().filter(w =>
            w.kind === 'run' &&
            w.sql.includes('INSERT INTO audit_log') &&
            w.sql.includes("'booking.paid'")
        );
        expect(auditWrites).toHaveLength(0);
    });
});
