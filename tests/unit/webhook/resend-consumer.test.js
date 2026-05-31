// M7 B8 — Resend bounce/complaint webhook consumer (POST /api/webhooks/resend).
// Exercises the real route through worker.fetch, mirroring the M6 dispute test.
// Verifies:
//   - 500 when RESEND_WEBHOOK_SECRET is unset; 400 on a bad signature
//   - hard bounce / complaint → email_events INSERT + customers suppression UPDATE + audit row
//   - soft bounce → INSERT, NO suppression
//   - orphan recipient (no customer) → records with target_type='unknown', no suppression
//   - idempotent redelivery (same svix-id) → no inserts
//   - unhandled Resend event type (email.delivered) → 200, no writes

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { signSvixWebhook } from '../../helpers/svixSignature.js';
import { createCapturedCtx } from '../../helpers/webhookFixture.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

// Valid base64 after the whsec_ prefix.
const SECRET = 'whsec_c3ZpeF90ZXN0X3NlY3JldF8wMQ==';

function makeEnv(overrides = {}) {
    return createMockEnv({ RESEND_WEBHOOK_SECRET: SECRET, ...overrides });
}

function bounceEvent({ email = 'bouncer@example.com', bounceType = 'hard', emailId = 'em_b1' } = {}) {
    return { type: 'email.bounced', created_at: '2026-05-31T00:00:00Z', data: { email_id: emailId, email, bounce_type: bounceType } };
}
function complaintEvent({ email = 'angry@example.com', emailId = 'em_c1' } = {}) {
    return { type: 'email.complained', created_at: '2026-05-31T00:00:00Z', data: { email_id: emailId, email } };
}

async function postResend(env, payload, signOpts = {}) {
    const signed = await signSvixWebhook({ payload, secret: SECRET, ...signOpts });
    const { ctx, flush } = createCapturedCtx();
    const req = new Request('https://airactionsport.com/api/webhooks/resend', {
        method: 'POST',
        headers: signed.headers,
        body: signed.body,
    });
    const res = await worker.fetch(req, env, ctx);
    await flush();
    return { res };
}

const find = (env, re) => env.DB.__writes().find((w) => re.test(w.sql));

// ── auth / signature ────────────────────────────────────────────────────────

describe('POST /api/webhooks/resend — signature gating', () => {
    it('returns 500 when RESEND_WEBHOOK_SECRET is not configured', async () => {
        const env = createMockEnv(); // no resend secret
        const { res } = await postResend(env, bounceEvent());
        expect(res.status).toBe(500);
        expect(find(env, /INSERT INTO email_events/)).toBeUndefined();
    });

    it('returns 400 on a bad signature', async () => {
        const env = makeEnv();
        const { res } = await postResend(env, bounceEvent(), { badSig: true });
        expect(res.status).toBe(400);
        expect(find(env, /INSERT INTO email_events/)).toBeUndefined();
    });
});

// ── hard bounce ───────────────────────────────────────────────────────────

describe('email.bounced (hard) — matching customer', () => {
    it('records the event, suppresses marketing, and writes an audit row', async () => {
        const env = makeEnv();
        env.DB.__on(/SELECT id FROM email_events WHERE svix_message_id/, null, 'first');
        env.DB.__on(/SELECT id, email_marketing FROM customers/, { id: 'cus_1', email_marketing: 1 }, 'first');

        const { res } = await postResend(env, bounceEvent({ bounceType: 'hard', email: 'bouncer@example.com' }));
        expect(res.status).toBe(200);

        const insert = find(env, /INSERT INTO email_events/);
        expect(insert).toBeDefined();
        expect(insert.args).toContain('cus_1');             // customer_id
        expect(insert.args).toContain('bouncer@example.com'); // recipient_email

        const upd = find(env, /UPDATE customers SET email_marketing = 0/);
        expect(upd).toBeDefined();
        expect(upd.args).toContain('cus_1');

        const audit = find(env, /INSERT INTO audit_log/);
        expect(audit).toBeDefined();
        expect(audit.args).toContain('email.bounced'); // action
        expect(audit.args).toContain('customer');      // target_type
        const meta = audit.args.find((a) => typeof a === 'string' && a.includes('suppressed_marketing'));
        expect(meta).toContain('"suppressed_marketing":true');
    });
});

// ── soft bounce ───────────────────────────────────────────────────────────

describe('email.bounced (soft) — matching customer', () => {
    it('records the event but does NOT suppress marketing', async () => {
        const env = makeEnv();
        env.DB.__on(/SELECT id FROM email_events WHERE svix_message_id/, null, 'first');
        env.DB.__on(/SELECT id, email_marketing FROM customers/, { id: 'cus_2', email_marketing: 1 }, 'first');

        const { res } = await postResend(env, bounceEvent({ bounceType: 'soft' }));
        expect(res.status).toBe(200);

        expect(find(env, /INSERT INTO email_events/)).toBeDefined();
        expect(find(env, /UPDATE customers SET email_marketing = 0/)).toBeUndefined();

        const audit = find(env, /INSERT INTO audit_log/);
        const meta = audit.args.find((a) => typeof a === 'string' && a.includes('suppressed_marketing'));
        expect(meta).toContain('"suppressed_marketing":false');
    });
});

// ── complaint ─────────────────────────────────────────────────────────────

describe('email.complained — matching customer', () => {
    it('records the event, suppresses marketing, and writes an email.complained audit row', async () => {
        const env = makeEnv();
        env.DB.__on(/SELECT id FROM email_events WHERE svix_message_id/, null, 'first');
        env.DB.__on(/SELECT id, email_marketing FROM customers/, { id: 'cus_3', email_marketing: 1 }, 'first');

        const { res } = await postResend(env, complaintEvent({ email: 'angry@example.com' }));
        expect(res.status).toBe(200);

        expect(find(env, /INSERT INTO email_events/)).toBeDefined();
        expect(find(env, /UPDATE customers SET email_marketing = 0/)).toBeDefined();

        const audit = find(env, /INSERT INTO audit_log/);
        expect(audit.args).toContain('email.complained');
    });
});

// ── orphan recipient (no customer) ──────────────────────────────────────────

describe('email.bounced — orphan recipient (no customer match)', () => {
    it('still records the event with target_type=unknown; no suppression', async () => {
        const env = makeEnv();
        env.DB.__on(/SELECT id FROM email_events WHERE svix_message_id/, null, 'first');
        env.DB.__on(/SELECT id, email_marketing FROM customers/, null, 'first'); // no match

        const { res } = await postResend(env, bounceEvent({ bounceType: 'hard', email: 'ghost@example.com' }));
        expect(res.status).toBe(200);

        expect(find(env, /INSERT INTO email_events/)).toBeDefined();
        expect(find(env, /UPDATE customers SET email_marketing = 0/)).toBeUndefined();

        const audit = find(env, /INSERT INTO audit_log/);
        expect(audit.args).toContain('unknown');             // target_type
        expect(audit.args).toContain('ghost@example.com');   // target_id = recipient
    });
});

// ── idempotency ─────────────────────────────────────────────────────────────

describe('email.bounced — idempotent redelivery', () => {
    it('no-ops when an email_events row already carries this svix-id', async () => {
        const env = makeEnv();
        env.DB.__on(/SELECT id FROM email_events WHERE svix_message_id/, { id: 'eev_existing' }, 'first');

        const { res } = await postResend(env, bounceEvent());
        expect(res.status).toBe(200);

        expect(find(env, /INSERT INTO email_events/)).toBeUndefined();
        expect(find(env, /INSERT INTO audit_log/)).toBeUndefined();

        // The idempotency check bound the svix-id from the header.
        const check = find(env, /SELECT id FROM email_events WHERE svix_message_id/);
        expect(check.args[0]).toBe('msg_test_0001');
    });
});

// ── unhandled event types ───────────────────────────────────────────────────

describe('Resend events we do not act on', () => {
    it('email.delivered → 200 with no writes', async () => {
        const env = makeEnv();
        const { res } = await postResend(env, { type: 'email.delivered', data: { email_id: 'em_d1', email: 'ok@example.com' } });
        expect(res.status).toBe(200);
        expect(find(env, /INSERT INTO email_events/)).toBeUndefined();
        expect(find(env, /INSERT INTO audit_log/)).toBeUndefined();
    });
});

// ── M7 B10 — admin alert emails (fire on hard bounce + complaint only) ──────

const ALERT_TEMPLATE = {
    id: 'tpl_x', slug: 'x',
    subject: '{{recipient}}',
    body_html: '<p>{{recipient}} {{customer}} {{admin_link}}</p>',
    body_text: '{{recipient}}',
    variables_json: null, status: 'published',
};
const resendCalls = () => (globalThis.fetch.mock?.calls || []).filter(([u]) => u === 'https://api.resend.com/emails');

describe('email alerts (M7 B10)', () => {
    function seed(env, { customer = { id: 'cus_1', email_marketing: 1 } } = {}) {
        env.DB.__on(/SELECT id FROM email_events WHERE svix_message_id/, null, 'first');
        env.DB.__on(/SELECT id, email_marketing FROM customers/, customer, 'first');
        env.DB.__on(/FROM email_templates WHERE slug/, ALERT_TEMPLATE, 'first');
    }

    it('hard bounce → queues a bounce_alert email to admin', async () => {
        const env = makeEnv();
        seed(env);
        mockResendFetch();
        await postResend(env, bounceEvent({ bounceType: 'hard' }));
        const calls = resendCalls();
        expect(calls.length).toBe(1);
        const body = JSON.parse(calls[0][1].body);
        expect(body.to).toEqual(['test@example.com']);
        expect(body.tags?.find((t) => t.name === 'type')?.value).toBe('bounce_alert');
    });

    it('complaint → queues a complaint_alert email to admin', async () => {
        const env = makeEnv();
        seed(env);
        mockResendFetch();
        await postResend(env, complaintEvent());
        const calls = resendCalls();
        expect(calls.length).toBe(1);
        expect(JSON.parse(calls[0][1].body).tags?.find((t) => t.name === 'type')?.value).toBe('complaint_alert');
    });

    it('soft bounce → records but does NOT queue an alert', async () => {
        const env = makeEnv();
        seed(env);
        mockResendFetch();
        await postResend(env, bounceEvent({ bounceType: 'soft' }));
        expect(resendCalls().length).toBe(0);
    });

    it('orphan hard bounce (no customer) → still alerts', async () => {
        const env = makeEnv();
        seed(env, { customer: null });
        mockResendFetch();
        await postResend(env, bounceEvent({ bounceType: 'hard', email: 'ghost@example.com' }));
        expect(resendCalls().length).toBe(1);
    });

    it('self-alert guard: recipient == ADMIN_NOTIFY_EMAIL → no alert (loop prevention)', async () => {
        const env = makeEnv(); // ADMIN_NOTIFY_EMAIL = test@example.com
        seed(env, { customer: null });
        mockResendFetch();
        await postResend(env, bounceEvent({ bounceType: 'hard', email: 'test@example.com' }));
        expect(resendCalls().length).toBe(0);
    });
});
