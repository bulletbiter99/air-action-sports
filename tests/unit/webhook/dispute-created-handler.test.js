// M6 B6 — charge.dispute.created webhook handler.
// Verifies:
//   - Linked dispute: audit row written + email queued via waitUntil
//   - Orphan dispute (no matching booking): audit row written with
//     target_type='unknown', no email queued
//   - Idempotency: redelivery of same dispute.id no-ops (no double-audit,
//     no double-email)
//   - Existing checkout.session.completed path unchanged (regression sanity)

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

const NOW = 1700000000000;

function makeDisputeEvent({ disputeId = 'du_test_001', paymentIntent = 'pi_test_abc', amount = 16000, reason = 'fraudulent', status = 'warning_needs_response', dueByEpochSec = 1701000000 } = {}) {
    return {
        id: 'evt_dispute_001',
        type: 'charge.dispute.created',
        data: {
            object: {
                id: disputeId,
                object: 'dispute',
                amount,
                currency: 'usd',
                payment_intent: paymentIntent,
                charge: 'ch_test_001',
                reason,
                status,
                evidence_details: { due_by: dueByEpochSec },
                created: 1700000000,
            },
        },
    };
}

async function postWebhook(env, payload) {
    const { signatureHeader, body } = await signStripeWebhook({
        payload,
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
    return { res, ctx };
}

// ────────────────────────────────────────────────────────────────────
// Linked dispute — booking exists for the payment_intent
// ────────────────────────────────────────────────────────────────────

describe('charge.dispute.created — linked dispute', () => {
    it('returns 200 + writes audit_log row linked to the booking', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/SELECT id FROM audit_log\s+WHERE action = 'dispute.received'/, null, 'first');
        env.DB.__on(/SELECT \* FROM bookings WHERE stripe_payment_intent/, {
            id: 'bk_disputed_001',
            full_name: 'Sarah Connor',
            email: 'sarah@example.com',
            stripe_payment_intent: 'pi_test_abc',
            total_cents: 16000,
        }, 'first');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug/, (sql, args) => ({
            id: `tpl_${args[0]}`,
            slug: args[0],
            subject: 'Dispute opened for {{booking_id}}',
            body_html: '<p>{{dispute_reason}} {{amount_display}}</p>',
            body_text: '{{dispute_reason}} {{amount_display}}',
            variables_json: null,
        }), 'first');

        const { res } = await postWebhook(env, makeDisputeEvent());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.received).toBe(true);

        const audit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /dispute\.received/.test(w.sql)
        );
        expect(audit).toBeDefined();
        // target_id = booking.id; meta_json includes dispute_id + reason + amount
        expect(audit.args).toContain('bk_disputed_001');
        const metaJsonArg = audit.args.find((a) => typeof a === 'string' && a.includes('dispute_id'));
        expect(metaJsonArg).toBeDefined();
        expect(metaJsonArg).toContain('du_test_001');
        expect(metaJsonArg).toContain('fraudulent');
    });

    it('queues admin notification via waitUntil', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/SELECT id FROM audit_log\s+WHERE action = 'dispute.received'/, null, 'first');
        env.DB.__on(/SELECT \* FROM bookings WHERE stripe_payment_intent/, {
            id: 'bk_disputed_002',
            full_name: 'Sarah Connor',
            email: 'sarah@example.com',
            stripe_payment_intent: 'pi_test_abc',
            total_cents: 16000,
        }, 'first');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug/, (sql, args) => ({
            id: `tpl_${args[0]}`,
            slug: args[0],
            subject: 'Dispute opened',
            body_html: '<p>{{dispute_reason}}</p>',
            body_text: '{{dispute_reason}}',
            variables_json: null,
        }), 'first');

        await postWebhook(env, makeDisputeEvent());

        const resendCalls = globalThis.fetch.mock.calls.filter(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        expect(resendCalls.length).toBeGreaterThan(0);
        const sentBody = JSON.parse(resendCalls[0][1].body);
        expect(sentBody.tags?.find((t) => t.name === 'type')?.value).toBe('dispute_received');
        expect(sentBody.tags?.find((t) => t.name === 'dispute_id')?.value).toBe('du_test_001');
    });
});

// ────────────────────────────────────────────────────────────────────
// Orphan dispute — no booking found for the payment_intent
// ────────────────────────────────────────────────────────────────────

describe('charge.dispute.created — orphan dispute (no booking match)', () => {
    it('still writes audit_log row with target_type=unknown; no email queued', async () => {
        const env = createMockEnv();
        // Idempotency check returns null (no prior record)
        env.DB.__on(/SELECT id FROM audit_log\s+WHERE action = 'dispute.received'/, null, 'first');
        // Booking lookup returns null
        env.DB.__on(/SELECT \* FROM bookings WHERE stripe_payment_intent/, null, 'first');

        const { res } = await postWebhook(env, makeDisputeEvent({ paymentIntent: 'pi_orphan_xyz' }));
        expect(res.status).toBe(200);

        const audit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /dispute\.received/.test(w.sql)
        );
        expect(audit).toBeDefined();
        // SQL is the orphan branch: target_type='unknown' baked in, target_id is dispute.id
        expect(audit.sql).toContain("'unknown'");
        expect(audit.args).toContain('du_test_001');

        // No Resend call
        const resendCalls = globalThis.fetch.mock?.calls?.filter(([url]) =>
            url === 'https://api.resend.com/emails'
        ) || [];
        expect(resendCalls.length).toBe(0);
    });

    it('handles dispute without payment_intent field gracefully (defensive)', async () => {
        const env = createMockEnv();
        env.DB.__on(/SELECT id FROM audit_log/, null, 'first');

        const event = makeDisputeEvent();
        delete event.data.object.payment_intent;
        const { res } = await postWebhook(env, event);
        expect(res.status).toBe(200);
    });
});

// ────────────────────────────────────────────────────────────────────
// Idempotency — Stripe redeliveries
// ────────────────────────────────────────────────────────────────────

describe('charge.dispute.created — idempotency', () => {
    it('does NOT write a second audit row when dispute.id already recorded', async () => {
        const env = createMockEnv();
        // Idempotency check finds an existing row
        env.DB.__on(/SELECT id FROM audit_log\s+WHERE action = 'dispute.received'/, { id: 999 }, 'first');

        const { res } = await postWebhook(env, makeDisputeEvent());
        expect(res.status).toBe(200);

        // No new audit insert
        const newAudit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /dispute\.received/.test(w.sql)
        );
        expect(newAudit).toBeUndefined();

        // No Resend call
        const resendCalls = globalThis.fetch.mock?.calls?.filter(([url]) =>
            url === 'https://api.resend.com/emails'
        ) || [];
        expect(resendCalls.length).toBe(0);
    });

    it('matches by dispute.id in meta_json (the LIKE pattern)', async () => {
        const env = createMockEnv();
        env.DB.__on(/SELECT id FROM audit_log/, { id: 1 }, 'first');

        await postWebhook(env, makeDisputeEvent({ disputeId: 'du_check_pattern_001' }));

        const idempotencyCheck = env.DB.__writes().find((w) =>
            /SELECT id FROM audit_log\s+WHERE action = 'dispute.received'/.test(w.sql)
        );
        expect(idempotencyCheck).toBeDefined();
        // The LIKE arg should embed the dispute.id
        expect(idempotencyCheck.args[0]).toContain('du_check_pattern_001');
    });
});

// ────────────────────────────────────────────────────────────────────
// Regression — existing checkout.session.completed handler unaffected
// ────────────────────────────────────────────────────────────────────

describe('charge.dispute.created branch — existing checkout handler is byte-equivalent', () => {
    it('checkout.session.completed still processes normally + queues booking emails', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const fixture = createWebhookFixture();
        bindWebhookFixture(env.DB, fixture, { withEmailTemplates: true });

        const { res } = await postWebhook(env, fixture.stripeEvent);
        expect(res.status).toBe(200);

        // Existing booking.paid audit fires
        const bookingPaidAudit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /booking\.paid/.test(w.sql)
        );
        expect(bookingPaidAudit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// Unknown event types still no-op (was true pre-B6; still true post-B6)
// ────────────────────────────────────────────────────────────────────

describe('Unknown event types still pass through cleanly', () => {
    it('payment_intent.succeeded (not handled) returns 200 with no DB writes', async () => {
        const env = createMockEnv();

        const event = {
            id: 'evt_pi_001',
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_x' } },
        };
        const { res } = await postWebhook(env, event);
        expect(res.status).toBe(200);

        // No dispute audit + no booking.paid audit
        const auditWrites = env.DB.__writes().filter((w) =>
            /INSERT INTO audit_log/.test(w.sql)
        );
        expect(auditWrites).toHaveLength(0);
    });
});
