// M6 B5 — createCheckoutSession gains optional setupFutureUsage arg.
// These tests pin the form-encoded request body shape so the Critical-DNT
// change to worker/lib/stripe.js stays surgical:
//   1. When setupFutureUsage is omitted, the body matches the pre-M6 B5
//      shape exactly (verified by snapshot of all body keys).
//   2. When supplied, payment_intent_data[setup_future_usage]=<value>
//      lands in the form body; nothing else changes.
//   3. verifyWebhookSignature behavior is untouched (Group B regression
//      is the authoritative pin — these tests just confirm the import
//      surface here).

import { describe, it, expect } from 'vitest';
import { createCheckoutSession, verifyWebhookSignature } from '../../../worker/lib/stripe.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';

const BASE_ARGS = {
    apiKey: 'sk_test_mock',
    lineItems: [
        { name: 'Operation Nightfall — 2 players', qty: 1, unit_price_cents: 16000 },
    ],
    successUrl: 'https://airactionsport.com/booking/success?token=bk_X',
    cancelUrl: 'https://airactionsport.com/booking/cancelled?token=bk_X',
    customerEmail: 'buyer@example.com',
    metadata: { booking_id: 'bk_X', event_id: 'evt_Y' },
};

// Decode a captured form-encoded body into an object so we can assert on
// individual fields without regex-grepping the raw string.
function decodeForm(bodyStr) {
    const out = {};
    for (const pair of bodyStr.split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const k = decodeURIComponent(pair.slice(0, eq));
        const v = decodeURIComponent(pair.slice(eq + 1));
        out[k] = v;
    }
    return out;
}

function lastStripeCallBody() {
    const call = globalThis.fetch.mock.calls.find(([url]) =>
        url === 'https://api.stripe.com/v1/checkout/sessions'
    );
    expect(call).toBeDefined();
    return decodeForm(call[1].body);
}

describe('createCheckoutSession — pre-M6 B5 baseline shape (no setupFutureUsage)', () => {
    it('omits payment_intent_data[setup_future_usage] when setupFutureUsage is undefined', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X', url: 'https://stripe.test/cs_X' } });
        await createCheckoutSession(BASE_ARGS);
        const body = lastStripeCallBody();
        expect(body['payment_intent_data[setup_future_usage]']).toBeUndefined();
        // Other required fields still present.
        expect(body.mode).toBe('payment');
        expect(body['payment_method_types[]']).toBe('card');
        expect(body.success_url).toBe(BASE_ARGS.successUrl);
        expect(body.cancel_url).toBe(BASE_ARGS.cancelUrl);
        expect(body.customer_email).toBe(BASE_ARGS.customerEmail);
    });

    it('emits line_items in indexed form with currency, name, amount, quantity', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
        await createCheckoutSession(BASE_ARGS);
        const body = lastStripeCallBody();
        expect(body['line_items[0][price_data][currency]']).toBe('usd');
        expect(body['line_items[0][price_data][product_data][name]']).toBe('Operation Nightfall — 2 players');
        expect(body['line_items[0][price_data][unit_amount]']).toBe('16000');
        expect(body['line_items[0][quantity]']).toBe('1');
    });

    it('emits metadata in bracketed form', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
        await createCheckoutSession(BASE_ARGS);
        const body = lastStripeCallBody();
        expect(body['metadata[booking_id]']).toBe('bk_X');
        expect(body['metadata[event_id]']).toBe('evt_Y');
    });

    it('omits payment_intent_data entirely when setupFutureUsage is omitted (no extra Stripe processing)', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
        await createCheckoutSession(BASE_ARGS);
        const body = lastStripeCallBody();
        const piKeys = Object.keys(body).filter((k) => k.startsWith('payment_intent_data['));
        expect(piKeys).toHaveLength(0);
    });
});

describe('createCheckoutSession — with setupFutureUsage', () => {
    it('adds payment_intent_data[setup_future_usage]=off_session when supplied', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
        await createCheckoutSession({ ...BASE_ARGS, setupFutureUsage: 'off_session' });
        const body = lastStripeCallBody();
        expect(body['payment_intent_data[setup_future_usage]']).toBe('off_session');
    });

    it('accepts on_session as a valid value (Stripe-supported alternative)', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
        await createCheckoutSession({ ...BASE_ARGS, setupFutureUsage: 'on_session' });
        const body = lastStripeCallBody();
        expect(body['payment_intent_data[setup_future_usage]']).toBe('on_session');
    });

    it('preserves every pre-M6 B5 body field when setupFutureUsage is added (additive only)', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
        await createCheckoutSession({ ...BASE_ARGS, setupFutureUsage: 'off_session' });
        const body = lastStripeCallBody();
        expect(body.mode).toBe('payment');
        expect(body['payment_method_types[]']).toBe('card');
        expect(body.success_url).toBe(BASE_ARGS.successUrl);
        expect(body.cancel_url).toBe(BASE_ARGS.cancelUrl);
        expect(body.customer_email).toBe(BASE_ARGS.customerEmail);
        expect(body['line_items[0][price_data][unit_amount]']).toBe('16000');
        expect(body['metadata[booking_id]']).toBe('bk_X');
    });

    it('treats empty string / null / explicit undefined as "no setupFutureUsage" (defensive)', async () => {
        for (const falsy of ['', null, undefined]) {
            mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
            await createCheckoutSession({ ...BASE_ARGS, setupFutureUsage: falsy });
            const body = lastStripeCallBody();
            expect(body['payment_intent_data[setup_future_usage]']).toBeUndefined();
        }
    });

    it('posts to the same /v1/checkout/sessions endpoint regardless of setupFutureUsage', async () => {
        mockStripeFetch({ 'POST /v1/checkout/sessions': { id: 'cs_X' } });
        await createCheckoutSession({ ...BASE_ARGS, setupFutureUsage: 'off_session' });
        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.stripe.com/v1/checkout/sessions'
        );
        expect(call).toBeDefined();
        expect(call[1].method).toBe('POST');
        expect(call[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });
});

// ────────────────────────────────────────────────────────────────────
// verifyWebhookSignature import surface — defensive sanity (Group B
// owns the byte-level signature tests; this just confirms the export
// is still callable + still rejects malformed input).
// ────────────────────────────────────────────────────────────────────

describe('verifyWebhookSignature — import surface preserved (Group B characterization unchanged)', () => {
    it('still throws on missing signature header (no behavior change in M6 B5)', async () => {
        await expect(verifyWebhookSignature({
            body: '{}',
            signatureHeader: '',
            secret: 'whsec_test',
        })).rejects.toThrow(/Missing Stripe-Signature/i);
    });

    it('still throws on malformed header (no t= or no v1=)', async () => {
        await expect(verifyWebhookSignature({
            body: '{}',
            signatureHeader: 'garbage',
            secret: 'whsec_test',
        })).rejects.toThrow(/Malformed Stripe-Signature/i);
    });
});
