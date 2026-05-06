// audit Group B #20 — handleCheckoutCompleted creates one attendee row
// per pending_attendees_json entry.
//
// INSERT bind order (worker/routes/webhooks.js lines 143-161):
//   [0] attendee_id      (generated server-side via attendeeId())
//   [1] booking_id       (booking.id)
//   [2] ticket_type_id   (a.ticketTypeId)
//   [3] first_name       (firstName)
//   [4] last_name        (lastName, may be null)
//   [5] email            (email, may be null)
//   [6] phone            (a.phone, may be null)
//   [7] qr_token         (generated server-side via qrToken())
//   [8] created_at       (now)
//   [9] custom_answers_json (stringified or null)
//   [10] waiver_id        (linked waiver id or null)

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { signStripeWebhook } from '../../helpers/stripeSignature.js';
import {
    createWebhookFixture,
    bindWebhookFixture,
    createCapturedCtx,
} from '../../helpers/webhookFixture.js';

async function postWebhook(env, fixture, opts = {}) {
    bindWebhookFixture(env.DB, fixture, opts);
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
    return res;
}

describe('handleCheckoutCompleted — attendee creation', () => {
    it('inserts one attendee row per pending_attendees_json entry', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            pendingAttendees: [
                { firstName: 'Alice', lastName: 'Smith', email: 'a@x.com', phone: '111', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'Bob', lastName: 'Jones', email: 'b@x.com', phone: '222', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'Carol', lastName: 'Lee', email: 'c@x.com', phone: '333', ticketTypeId: 'tt_vip', customAnswers: { team: 'Red' } },
            ],
            lineItems: [
                { type: 'ticket', ticket_type_id: 'tt_std', qty: 2, unit_price_cents: 8000, line_total_cents: 16000 },
                { type: 'ticket', ticket_type_id: 'tt_vip', qty: 1, unit_price_cents: 15000, line_total_cents: 15000 },
            ],
        });
        await postWebhook(env, fixture);

        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO attendees')
        );
        expect(inserts).toHaveLength(3);

        // first_name (index 3) preserved in selection order
        expect(inserts.map(w => w.args[3])).toEqual(['Alice', 'Bob', 'Carol']);

        // ticket_type_id (index 2) preserved per attendee
        expect(inserts.map(w => w.args[2])).toEqual(['tt_std', 'tt_std', 'tt_vip']);

        // booking_id (index 1) consistent across all inserts
        for (const ins of inserts) {
            expect(ins.args[1]).toBe(fixture.bookingId);
        }
    });

    it('binds last_name + email + phone faithfully (with null handling)', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            pendingAttendees: [
                { firstName: 'Alice', lastName: 'Smith', email: 'a@x.com', phone: '5551111', ticketTypeId: 'tt_std', customAnswers: null },
                // Minimal entry — no last name, no email, no phone, no customAnswers
                { firstName: 'NoLastName', lastName: null, email: null, phone: null, ticketTypeId: 'tt_std', customAnswers: null },
            ],
        });
        await postWebhook(env, fixture);

        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO attendees')
        );
        expect(inserts).toHaveLength(2);

        // Alice — last_name='Smith', email='a@x.com', phone='5551111'
        expect(inserts[0].args[4]).toBe('Smith');
        expect(inserts[0].args[5]).toBe('a@x.com');
        expect(inserts[0].args[6]).toBe('5551111');

        // No-last-name attendee — null/null/null preserved
        expect(inserts[1].args[4]).toBeNull();
        expect(inserts[1].args[5]).toBeNull();
        expect(inserts[1].args[6]).toBeNull();
    });

    it('stringifies custom_answers when non-empty; stores null when empty/missing', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            pendingAttendees: [
                { firstName: 'A', lastName: 'A', email: 'a@x.com', phone: '1', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'B', lastName: 'B', email: 'b@x.com', phone: '2', ticketTypeId: 'tt_std', customAnswers: {} },  // empty object
                { firstName: 'C', lastName: 'C', email: 'c@x.com', phone: '3', ticketTypeId: 'tt_std', customAnswers: { team: 'Red', size: 'L' } },
            ],
        });
        await postWebhook(env, fixture);

        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO attendees')
        );
        // index 9 = custom_answers_json
        expect(inserts[0].args[9]).toBeNull();          // null → null
        expect(inserts[1].args[9]).toBeNull();          // empty {} → null (Object.keys.length === 0)
        expect(inserts[2].args[9]).toBe(JSON.stringify({ team: 'Red', size: 'L' }));
    });

    it('generates unique qr_token per attendee', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            pendingAttendees: [
                { firstName: 'A', lastName: 'A', email: 'a@x.com', phone: '1', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'B', lastName: 'B', email: 'b@x.com', phone: '2', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'C', lastName: 'C', email: 'c@x.com', phone: '3', ticketTypeId: 'tt_std', customAnswers: null },
            ],
        });
        await postWebhook(env, fixture);

        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO attendees')
        );
        const tokens = inserts.map(w => w.args[7]);
        // 24-char alphanumeric per worker/lib/ids.js qrToken()
        for (const t of tokens) {
            expect(t).toMatch(/^[0-9A-Za-z]{24}$/);
        }
        expect(new Set(tokens).size).toBe(3);  // all distinct
    });
});
