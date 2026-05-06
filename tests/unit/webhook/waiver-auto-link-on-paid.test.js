// audit Group B #24 — handleCheckoutCompleted writes a "waiver.auto_linked"
// audit row for each pre-linked attendee, AND attendees rows have
// waiver_id pre-populated, AND the waiver-request email is NOT sent for
// auto-linked attendees.
//
// Source: worker/routes/webhooks.js lines 134-177 (handleCheckoutCompleted)
//         worker/routes/webhooks.js sendBookingEmails lines 87-91:
//             if (attendee.waiver_id || attendee.waiverId) {
//                 out.waivers.push({ attendee_id: attendee.id, skipped: 'already_on_file' });
//                 continue;
//             }

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

describe('handleCheckoutCompleted — waiver auto-link', () => {
    it('attendee insert binds waiver_id when findExistingValidWaiver hits', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture();
        // waiverMatch makes the SELECT id FROM waivers handler return { id: 'wv_x' }
        // so findExistingValidWaiver returns 'wv_existing'.
        bindWebhookFixture(env.DB, fixture, { waiverMatch: 'wv_existing' });

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

        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO attendees')
        );
        expect(inserts).toHaveLength(1);
        // waiver_id is bind index 10 per the INSERT statement.
        expect(inserts[0].args[10]).toBe('wv_existing');
    });

    it('writes waiver.auto_linked audit row per linked attendee', async () => {
        const env = createMockEnv();
        const fixture = createWebhookFixture({
            pendingAttendees: [
                { firstName: 'Alice', lastName: 'Smith', email: 'alice@x.com', phone: '1', ticketTypeId: 'tt_std', customAnswers: null },
                { firstName: 'Bob', lastName: 'Jones', email: 'bob@x.com', phone: '2', ticketTypeId: 'tt_std', customAnswers: null },
            ],
        });
        bindWebhookFixture(env.DB, fixture, { waiverMatch: 'wv_match_for_all' });

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

        const autoLinkAudits = env.DB.__writes().filter(w =>
            w.kind === 'run' &&
            w.sql.includes('INSERT INTO audit_log') &&
            w.sql.includes("'waiver.auto_linked'")
        );
        expect(autoLinkAudits).toHaveLength(2);

        // Each audit row's meta_json contains waiver_id + booking_id.
        for (const audit of autoLinkAudits) {
            const meta = JSON.parse(audit.args[1]);
            expect(meta.waiver_id).toBe('wv_match_for_all');
            expect(meta.booking_id).toBe(fixture.bookingId);
        }
    });

    it('attendee with waiver_id set does NOT receive a waiver_request email', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const fixture = createWebhookFixture();
        bindWebhookFixture(env.DB, fixture, {
            waiverMatch: 'wv_existing',
            withEmailTemplates: true,
            // After insert, the SELECT * FROM attendees query returns rows with waiver_id set.
            attendeesAfter: [
                { id: 'at_1', booking_id: fixture.bookingId, first_name: 'Alice', last_name: 'Smith',
                  email: 'alice@x.com', qr_token: 'qr1', waiver_id: 'wv_existing' },
            ],
        });

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

        // booking_confirmation + admin_notify still fire
        expect(findResendCallsByType('booking_confirmation').length).toBeGreaterThanOrEqual(1);
        // BUT no waiver_request — the attendee was auto-linked.
        expect(findResendCallsByType('waiver_request')).toHaveLength(0);
    });

    it('attendee WITHOUT waiver_id DOES receive a waiver_request email', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const fixture = createWebhookFixture();
        bindWebhookFixture(env.DB, fixture, {
            // No waiverMatch → no auto-link.
            withEmailTemplates: true,
            attendeesAfter: [
                { id: 'at_1', booking_id: fixture.bookingId, first_name: 'Alice', last_name: 'Smith',
                  email: 'alice@x.com', qr_token: 'qr1', waiver_id: null },
            ],
        });

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

        // No auto-link audit
        const autoLinkAudits = env.DB.__writes().filter(w =>
            w.kind === 'run' &&
            w.sql.includes('INSERT INTO audit_log') &&
            w.sql.includes("'waiver.auto_linked'")
        );
        expect(autoLinkAudits).toHaveLength(0);

        // Waiver request DOES fire
        expect(findResendCallsByType('waiver_request')).toHaveLength(1);
    });
});
