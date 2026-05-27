// M6 B7 — POST /api/admin/booking-charges/:id/charge-card
// Tests the new off-session capture endpoint:
//   - Happy path → 200 with paid + paymentIntentId
//   - Already finalized → 409
//   - Charge not found → 404
//   - No saved PM (legacy booking pre-B5) → 422 with fallback hint
//   - Stripe declined (402) → 402 with fallback hint
//   - Stripe non-succeeded status → 402

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockStripeFetch } from '../../../helpers/mockStripe.js';
import { mockResendFetch } from '../../../helpers/mockResend.js';

const CHARGE_ID = 'bc_offsession_test';
const BOOKING_ID = 'b_test_001';
const ORIGINAL_PI = 'pi_original_001';
const CUSTOMER_ID = 'cus_test_001';
const PM_ID = 'pm_test_001';

function chargeRow(extra = {}) {
    return {
        id: CHARGE_ID,
        booking_id: BOOKING_ID,
        attendee_id: 'att_1',
        rental_assignment_id: 'ra_1',
        reason_kind: 'damage',
        description: 'broken marker',
        amount_cents: 5000,
        status: 'sent',
        approval_required: 0,
        approved_at: null,
        approved_by_user_id: null,
        payment_link: 'https://airactionsport.com/admin/booking-charges/pay/tok',
        payment_link_expires_at: Date.now() + 86400000,
        paid_at: null,
        payment_method: null,
        payment_reference: null,
        waived_at: null,
        waived_by_user_id: null,
        waived_reason: null,
        created_by_person_id: 'prs_1',
        created_by_user_id: null,
        created_at: 1700000000000,
        buyer_name: 'Customer X',
        buyer_email: 'x@e.com',
        event_id: 'evt_1',
        item_name: 'Marker',
        item_sku: 'MK-001',
        ...extra,
    };
}

function bindCommonMocks(env, opts = {}) {
    env.DB.__on(/FROM booking_charges bc\s+INNER JOIN bookings/, opts.chargeRow ?? chargeRow(), 'first');
    env.DB.__on(/FROM bookings WHERE id = \?/, opts.bookingRow ?? {
        id: BOOKING_ID,
        stripe_payment_intent: ORIGINAL_PI,
        stripe_session_id: 'cs_test_001',
        email: 'x@e.com',
        full_name: 'Customer X',
    }, 'first');
    // Email template lookup for sendPaidEmail
    env.DB.__on(/FROM email_templates WHERE slug/, (sql, args) => ({
        id: `tpl_${args[0]}`,
        slug: args[0],
        subject: 'Receipt — additional charge paid',
        body_html: '<p>{{amountDisplay}}</p>',
        body_text: '{{amountDisplay}}',
        variables_json: null,
        status: 'published',
    }), 'first');
}

let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

const URL = (id) => `https://airactionsport.com/api/admin/booking-charges/${id}/charge-card`;

// ────────────────────────────────────────────────────────────────────
// Happy path
// ────────────────────────────────────────────────────────────────────

describe('POST /:id/charge-card — happy path', () => {
    it('returns 200 with paid status + payment intent ID', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI,
                customer: CUSTOMER_ID,
                payment_method: PM_ID,
                status: 'succeeded',
            },
            'POST /v1/payment_intents': {
                id: 'pi_new_offsession',
                status: 'succeeded',
                amount_received: 5000,
            },
        });
        // Resend mock for the receipt email
        const origFetch = globalThis.fetch.getMockImplementation();
        globalThis.fetch.mockImplementation(async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.startsWith('https://api.resend.com/')) {
                return new Response(JSON.stringify({ id: 'mock-receipt' }), { status: 200 });
            }
            return origFetch(input, init);
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            ok: true,
            chargeId: CHARGE_ID,
            status: 'paid',
            paymentIntentId: 'pi_new_offsession',
            amountCents: 5000,
        });
    });

    it('updates the charge row with status=paid, payment_method=stripe_off_session, payment_reference=new PI', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: PM_ID,
            },
            'POST /v1/payment_intents': { id: 'pi_new_001', status: 'succeeded' },
        });
        const origFetch = globalThis.fetch.getMockImplementation();
        globalThis.fetch.mockImplementation(async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.startsWith('https://api.resend.com/')) return new Response('{}', { status: 200 });
            return origFetch(input, init);
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        await worker.fetch(req, env, {});

        const update = env.DB.__writes().find((w) =>
            /UPDATE booking_charges/.test(w.sql) && /status = 'paid'/.test(w.sql)
        );
        expect(update).toBeDefined();
        expect(update.args).toContain('stripe_off_session');
        expect(update.args).toContain('pi_new_001');
    });

    it('audits charge.off_session_succeeded', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: { id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: PM_ID },
            'POST /v1/payment_intents': { id: 'pi_new_002', status: 'succeeded' },
        });
        const origFetch = globalThis.fetch.getMockImplementation();
        globalThis.fetch.mockImplementation(async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.startsWith('https://api.resend.com/')) return new Response('{}', { status: 200 });
            return origFetch(input, init);
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        await worker.fetch(req, env, {});

        const audit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args?.some((a) => typeof a === 'string' && a.includes('off_session_succeeded'))
        );
        expect(audit).toBeDefined();
    });

    it('passes idempotency key charge_<chargeId>_offsession to Stripe', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: { id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: PM_ID },
            'POST /v1/payment_intents': { id: 'pi_new_idem', status: 'succeeded' },
        });
        const origFetch = globalThis.fetch.getMockImplementation();
        globalThis.fetch.mockImplementation(async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.startsWith('https://api.resend.com/')) return new Response('{}', { status: 200 });
            return origFetch(input, init);
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        await worker.fetch(req, env, {});

        const stripeCall = globalThis.fetch.mock.calls.find(([u]) =>
            u === 'https://api.stripe.com/v1/payment_intents'
        );
        expect(stripeCall[1].headers['Idempotency-Key']).toBe(`charge_${CHARGE_ID}_offsession`);
    });
});

// ────────────────────────────────────────────────────────────────────
// 404 — charge / booking not found
// ────────────────────────────────────────────────────────────────────

describe('POST /:id/charge-card — 404 paths', () => {
    it('returns 404 when charge does not exist', async () => {
        // No charge handler → returns null
        const req = new Request(URL('bc_does_not_exist'), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('charge_not_found');
    });

    it('returns 404 when booking does not exist for the charge', async () => {
        env.DB.__on(/FROM booking_charges bc/, chargeRow(), 'first');
        env.DB.__on(/FROM bookings WHERE id = \?/, null, 'first');

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('booking_not_found');
    });
});

// ────────────────────────────────────────────────────────────────────
// 409 — already finalized
// ────────────────────────────────────────────────────────────────────

describe('POST /:id/charge-card — 409 conflict', () => {
    it.each(['paid', 'waived', 'refunded'])('returns 409 when charge status is %s', async (status) => {
        bindCommonMocks(env, { chargeRow: chargeRow({ status }) });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('already_finalized');
        expect(body.currentStatus).toBe(status);
    });
});

// ────────────────────────────────────────────────────────────────────
// 422 — no saved PM (legacy booking pre-B5)
// ────────────────────────────────────────────────────────────────────

describe('POST /:id/charge-card — 422 no saved payment method', () => {
    it('returns 422 + fallback hint when booking has no stripe_payment_intent (legacy)', async () => {
        env.DB.__on(/FROM booking_charges bc/, chargeRow(), 'first');
        env.DB.__on(/FROM bookings WHERE id = \?/, {
            id: BOOKING_ID, stripe_payment_intent: null,
            stripe_session_id: 'cs_legacy', email: 'x@e.com', full_name: 'X',
        }, 'first');

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe('no_saved_payment_method');
        expect(body.fallback).toBe('use_email_link_or_mark_paid');
    });

    it('returns 422 when Stripe PI has no customer attached (booking pre-B5)', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI, customer: null, payment_method: PM_ID,
            },
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.detail).toBe('no_customer');
    });

    it('returns 422 when Stripe PI has customer but no payment_method', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: null,
            },
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.detail).toBe('no_payment_method');
    });
});

// ────────────────────────────────────────────────────────────────────
// 402 — Stripe declined
// ────────────────────────────────────────────────────────────────────

describe('POST /:id/charge-card — 402 Stripe declined', () => {
    it('returns 402 + fallback hint when card declined', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: { id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: PM_ID },
            'POST /v1/payment_intents': {
                __status: 402,
                error: {
                    code: 'card_declined',
                    message: 'Your card was declined.',
                    payment_intent: { id: 'pi_declined_001' },
                },
            },
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(402);
        const body = await res.json();
        expect(body.error).toBe('stripe_declined');
        expect(body.code).toBe('card_declined');
        expect(body.fallback).toBe('use_email_link_or_mark_paid');
        expect(body.paymentIntentId).toBe('pi_declined_001');

        // Charge row was NOT marked paid
        const update = env.DB.__writes().find((w) =>
            /UPDATE booking_charges/.test(w.sql) && /status = 'paid'/.test(w.sql)
        );
        expect(update).toBeUndefined();
    });

    it('returns 402 when 3DS required (authentication_required code)', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: { id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: PM_ID },
            'POST /v1/payment_intents': {
                __status: 402,
                error: {
                    code: 'authentication_required',
                    message: 'Authentication required',
                    payment_intent: { id: 'pi_3ds_001' },
                },
            },
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(402);
        expect((await res.json()).code).toBe('authentication_required');
    });

    it('returns 402 when Stripe accepts but PI status is requires_action (defensive)', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: { id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: PM_ID },
            'POST /v1/payment_intents': {
                id: 'pi_requires_action',
                status: 'requires_action',
            },
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(402);
        const body = await res.json();
        expect(body.code).toBe('non_succeeded_status');
    });

    it('audits charge.off_session_failed when Stripe declines', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: { id: ORIGINAL_PI, customer: CUSTOMER_ID, payment_method: PM_ID },
            'POST /v1/payment_intents': {
                __status: 402,
                error: { code: 'card_declined', message: 'declined' },
            },
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        await worker.fetch(req, env, {});

        const failAudit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args?.some((a) => typeof a === 'string' && a.includes('off_session_failed'))
        );
        expect(failAudit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// 502 — Stripe network/request failure
// ────────────────────────────────────────────────────────────────────

describe('POST /:id/charge-card — 502 retrieve failure', () => {
    it('returns 502 when retrievePaymentIntent throws (Stripe 500)', async () => {
        bindCommonMocks(env);
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                __status: 500,
                error: { message: 'Internal error' },
            },
        });

        const req = new Request(URL(CHARGE_ID), {
            method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(502);
        expect((await res.json()).error).toBe('stripe_request_failed');
    });
});

// ────────────────────────────────────────────────────────────────────
// Access control
// ────────────────────────────────────────────────────────────────────

describe('POST /:id/charge-card — access', () => {
    it('returns 403 when caller is staff (not manager+)', async () => {
        const staffEnv = createMockEnv();
        const staff = await createAdminSession(staffEnv, { id: 'u_staff', role: 'staff' });
        const req = new Request(URL(CHARGE_ID), {
            method: 'POST',
            headers: { cookie: staff.cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, staffEnv, {});
        expect(res.status).toBe(403);
    });
});
