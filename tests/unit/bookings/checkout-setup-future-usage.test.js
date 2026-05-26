// M6 B5 — public POST /api/bookings/checkout passes setupFutureUsage to Stripe.
// Verifies the Critical-DNT change to worker/routes/bookings.js stays surgical:
//   1. The route still creates the booking row + line items + tax/fee logic
//      exactly as before (Group A pricing pinned in tests/unit/pricing/*).
//   2. The Stripe Checkout Session request body includes
//      payment_intent_data[setup_future_usage]=off_session.
//   3. The booking gets its stripe_session_id persisted post-Session-create.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';

const NOW = 1700000000000;

function eventRow(extra = {}) {
    return {
        id: 'evt_op_nightfall',
        slug: 'operation-nightfall',
        title: 'Operation Nightfall',
        description: 'Night ops',
        location: 'Ghost Town',
        date_iso: '2026-05-09',
        display_date: '9 May 2026',
        published: 1,
        created_at: NOW,
        custom_questions_json: null,
        ...extra,
    };
}

function ticketTypeRow(extra = {}) {
    return {
        id: 'tt_standard',
        event_id: 'evt_op_nightfall',
        name: 'Standard',
        description: null,
        price_cents: 8000,
        capacity: 50,
        sold: 0,
        active: 1,
        sort_order: 0,
        min_per_order: 0,
        max_per_order: 50,
        ...extra,
    };
}

function bindCheckoutMocks(env) {
    // Server-side custom-questions guard runs first (look up custom_questions_json
    // for the event id).
    env.DB.__on(/SELECT custom_questions_json FROM events WHERE id/, { custom_questions_json: null }, 'first');

    // loadEventAndTypes
    env.DB.__on(/SELECT \* FROM events WHERE id = \? AND published = 1/, eventRow(), 'first');
    env.DB.__on(/SELECT \* FROM ticket_types WHERE event_id = \? AND active = 1/, {
        results: [ticketTypeRow()],
    }, 'all');

    // loadActiveTaxesFees
    env.DB.__on(/FROM taxes_fees WHERE active = 1/, { results: [] }, 'all');

    // checkTicketInventory — no existing reservations
    env.DB.__on(/SELECT line_items_json FROM bookings WHERE event_id/, { results: [] }, 'all');
}

const CHECKOUT_URL = 'https://airactionsport.com/api/bookings/checkout';

function buildPayload(overrides = {}) {
    return {
        eventId: 'evt_op_nightfall',
        buyer: {
            fullName: 'Jane Player',
            email: 'jane@example.com',
            phone: '+1 555 0199',
        },
        attendees: [
            { firstName: 'Jane', lastName: 'Player', ticketTypeId: 'tt_standard' },
        ],
        ...overrides,
    };
}

let env;

beforeEach(() => {
    env = createMockEnv();
    bindCheckoutMocks(env);
});

// ────────────────────────────────────────────────────────────────────
// setup_future_usage is in the Stripe Checkout Session body
// ────────────────────────────────────────────────────────────────────

describe('POST /api/bookings/checkout — setup_future_usage', () => {
    it('passes setupFutureUsage=off_session to Stripe Checkout Session creation', async () => {
        mockStripeFetch({
            'POST /v1/checkout/sessions': {
                id: 'cs_test_001',
                url: 'https://checkout.stripe.com/c/cs_test_001',
                payment_intent: 'pi_test_001',
            },
        });

        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        // Find the Stripe Checkout Sessions request
        const stripeCall = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.stripe.com/v1/checkout/sessions'
        );
        expect(stripeCall).toBeDefined();
        const formBody = stripeCall[1].body;
        // payment_intent_data[setup_future_usage]=off_session — URL-encoded
        expect(formBody).toMatch(/payment_intent_data%5Bsetup_future_usage%5D=off_session/);
    });

    it('returns the Stripe checkout URL in the response (under stripeUrl field)', async () => {
        mockStripeFetch({
            'POST /v1/checkout/sessions': {
                id: 'cs_test_002',
                url: 'https://checkout.stripe.com/c/cs_test_002',
            },
        });

        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.stripeUrl).toBe('https://checkout.stripe.com/c/cs_test_002');
        expect(body.bookingId).toMatch(/^bk_/);
    });

    it('persists stripe_session_id on the booking row post-session-create', async () => {
        mockStripeFetch({
            'POST /v1/checkout/sessions': { id: 'cs_persist_test', url: 'https://stripe.test/x' },
        });

        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload()),
        });
        await worker.fetch(req, env, {});

        const updateCall = env.DB.__writes().find((w) =>
            /UPDATE bookings SET stripe_session_id/.test(w.sql)
        );
        expect(updateCall).toBeDefined();
        expect(updateCall.args[0]).toBe('cs_persist_test');
    });
});

// ────────────────────────────────────────────────────────────────────
// Pricing + booking-creation posture preserved (Group A regression guard)
// ────────────────────────────────────────────────────────────────────

describe('POST /api/bookings/checkout — existing posture preserved', () => {
    it('still INSERTs a pending booking row before invoking Stripe', async () => {
        mockStripeFetch({
            'POST /v1/checkout/sessions': { id: 'cs_X', url: 'https://stripe.test/cs_X' },
        });

        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload()),
        });
        await worker.fetch(req, env, {});

        const insert = env.DB.__writes().find((w) => /INSERT INTO bookings/.test(w.sql));
        expect(insert).toBeDefined();
        // The 11th positional arg in the prepared INSERT is `total_cents` per
        // the route's binding order (id, event_id, full_name, email, phone,
        // player_count, line_items_json, subtotal_cents, discount_cents,
        // tax_cents, fee_cents, total_cents, ...). Standard 1 ticket * 8000c = 8000c.
        expect(insert.args).toContain(8000);
    });

    it('does NOT crash when no taxes/fees are configured (covers default path)', async () => {
        mockStripeFetch({
            'POST /v1/checkout/sessions': { id: 'cs_X', url: 'https://stripe.test/cs_X' },
        });

        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
    });

    it('still rejects buyer missing name/email/phone with 400', async () => {
        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload({ buyer: { fullName: '', email: '', phone: '' } })),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        // Stripe should not have been called.
        const stripeCall = globalThis.fetch.mock?.calls?.find(([url]) =>
            url === 'https://api.stripe.com/v1/checkout/sessions'
        );
        expect(stripeCall).toBeUndefined();
    });

    it('rate-limit blocks at RL_CHECKOUT before Stripe is called', async () => {
        env.RL_CHECKOUT.limit.mockResolvedValueOnce({ success: false });

        // rateLimit middleware uses CF-Connecting-IP as the key; without it,
        // the middleware no-ops. Set the header so the limit() call fires.
        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'CF-Connecting-IP': '10.0.0.1',
            },
            body: JSON.stringify(buildPayload()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(429);
        const stripeCall = globalThis.fetch.mock?.calls?.find(([url]) =>
            url === 'https://api.stripe.com/v1/checkout/sessions'
        );
        expect(stripeCall).toBeUndefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// Stripe failure path — booking marked cancelled + setup_future_usage still
// sent (so the failure is in Stripe's response, not our request shape)
// ────────────────────────────────────────────────────────────────────

describe('POST /api/bookings/checkout — Stripe failure handling', () => {
    it('returns 502 + cancels the pending booking when Stripe rejects the request', async () => {
        mockStripeFetch({
            'POST /v1/checkout/sessions': {
                __status: 400,
                error: { message: 'Invalid setup_future_usage value' },
            },
        });

        const req = new Request(CHECKOUT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(502);

        // The pending booking should have been cancelled.
        const cancelWrite = env.DB.__writes().find((w) =>
            /UPDATE bookings SET status = 'cancelled'/.test(w.sql)
        );
        expect(cancelWrite).toBeDefined();
    });
});
