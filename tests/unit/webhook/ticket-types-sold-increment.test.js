// audit Group B #21 — handleCheckoutCompleted increments ticket_types.sold
// by ticket qty per ticket type.
//
// Iteration logic (worker/routes/webhooks.js lines 180-190):
//   const soldByType = new Map();
//   for (const item of lineItems) {
//       if (item.type === 'ticket') {
//           soldByType.set(item.ticket_type_id,
//               (soldByType.get(item.ticket_type_id) || 0) + item.qty);
//       }
//   }
//   for (const [ttId, qty] of soldByType.entries()) {
//       UPDATE ticket_types SET sold = sold + ?, updated_at = ? WHERE id = ?
//       .bind(qty, now, ttId)
//   }
//
// Bind args: [qty, now, ticket_type_id]. Addons (`type === 'addon'`) ignored.

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

describe('handleCheckoutCompleted — ticket_types.sold increment', () => {
    it('issues one UPDATE per distinct ticket_type_id', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            pendingAttendees: [
                { firstName: 'A', lastName: 'A', email: 'a@x.com', phone: '1', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'B', lastName: 'B', email: 'b@x.com', phone: '2', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'C', lastName: 'C', email: 'c@x.com', phone: '3', ticketTypeId: 'tt_vip', customAnswers: null },
            ],
            lineItems: [
                { type: 'ticket', ticket_type_id: 'tt_std', qty: 2, unit_price_cents: 8000, line_total_cents: 16000 },
                { type: 'ticket', ticket_type_id: 'tt_vip', qty: 1, unit_price_cents: 15000, line_total_cents: 15000 },
            ],
        });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE ticket_types SET sold')
        );
        expect(updates).toHaveLength(2);

        // bind: [qty, now, ticket_type_id]
        const std = updates.find(w => w.args[2] === 'tt_std');
        const vip = updates.find(w => w.args[2] === 'tt_vip');
        expect(std).toBeDefined();
        expect(vip).toBeDefined();
        expect(std.args[0]).toBe(2);
        expect(vip.args[0]).toBe(1);
    });

    it('aggregates qty when same ticket_type_id appears multiple times in line_items', async () => {
        // The Map.set accumulator handles split-line scenarios.
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            pendingAttendees: [
                { firstName: 'A', lastName: 'A', email: 'a@x.com', phone: '1', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'B', lastName: 'B', email: 'b@x.com', phone: '2', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'C', lastName: 'C', email: 'c@x.com', phone: '3', ticketTypeId: 'tt_std', customAnswers: null },
            ],
            lineItems: [
                { type: 'ticket', ticket_type_id: 'tt_std', qty: 2, unit_price_cents: 8000, line_total_cents: 16000 },
                { type: 'ticket', ticket_type_id: 'tt_std', qty: 1, unit_price_cents: 8000, line_total_cents: 8000 },
            ],
        });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE ticket_types SET sold')
        );
        expect(updates).toHaveLength(1);
        expect(updates[0].args[0]).toBe(3);  // 2 + 1 aggregated
    });

    it('ignores addon line items (only type==="ticket" counts)', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            lineItems: [
                { type: 'ticket', ticket_type_id: 'tt_std', qty: 1, unit_price_cents: 8000, line_total_cents: 8000 },
                { type: 'addon', sku: 'rifle', qty: 5, unit_price_cents: 3500, line_total_cents: 17500 },
                { type: 'tax', tax_fee_id: 'tf_x', line_total_cents: 100 },
                { type: 'fee', tax_fee_id: 'tf_y', line_total_cents: 50 },
            ],
        });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE ticket_types SET sold')
        );
        expect(updates).toHaveLength(1);
        expect(updates[0].args[2]).toBe('tt_std');
        expect(updates[0].args[0]).toBe(1);
    });

    it('skips the update entirely when line_items has no ticket rows', async () => {
        // Defensive: degenerate case (shouldn't happen in production but lock the behavior).
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            lineItems: [
                { type: 'addon', sku: 'rifle', qty: 1, unit_price_cents: 3500, line_total_cents: 3500 },
            ],
        });
        await postWebhook(env, fixture);

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE ticket_types SET sold')
        );
        expect(updates).toHaveLength(0);
    });
});
