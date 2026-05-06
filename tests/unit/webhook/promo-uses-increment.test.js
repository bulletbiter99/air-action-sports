// audit Group B #22 — handleCheckoutCompleted increments promo_codes.uses_count
// by 1 when bookings.promo_code_id is set; no increment otherwise.
//
// Source: worker/routes/webhooks.js lines 192-197:
//   if (bookingRow.promo_code_id) {
//       UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ?
//       .bind(bookingRow.promo_code_id)
//   }

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

describe('handleCheckoutCompleted — promo_codes.uses_count increment', () => {
    it('issues UPDATE promo_codes when promo_code_id is set', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({ promoCodeId: 'pc_summer25' });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE promo_codes SET uses_count')
        );
        expect(updates).toHaveLength(1);
        expect(updates[0].args[0]).toBe('pc_summer25');
    });

    it('does NOT issue UPDATE promo_codes when promo_code_id is null', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({ promoCodeId: null });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE promo_codes SET uses_count')
        );
        expect(updates).toHaveLength(0);
    });

    it('does NOT issue UPDATE promo_codes when promo_code_id is empty string (falsy)', async () => {
        // The `if (bookingRow.promo_code_id)` truthy check skips empty strings.
        const env = createMockEnv();
        const fixture = createWebhookFixture({ promoCodeId: '' });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE promo_codes SET uses_count')
        );
        expect(updates).toHaveLength(0);
    });

    it('binds the EXACT promo_code_id from the booking row (no transformation)', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({ promoCodeId: 'pc_with_special_chars_abc123' });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE promo_codes SET uses_count')
        );
        expect(updates[0].args[0]).toBe('pc_with_special_chars_abc123');
    });
});
