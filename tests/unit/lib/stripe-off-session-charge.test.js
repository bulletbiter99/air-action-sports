// M6 B7 — Stripe lib additions: retrievePaymentIntent + chargeOffSession.
// Verifies form body shape, validation, idempotency-key wiring.

import { describe, it, expect } from 'vitest';
import { retrievePaymentIntent, chargeOffSession } from '../../../worker/lib/stripe.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';

function decodeForm(bodyStr) {
    const out = {};
    for (const pair of bodyStr.split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
    return out;
}

describe('retrievePaymentIntent', () => {
    it('issues GET /v1/payment_intents/:id with apiKey in Authorization header', async () => {
        mockStripeFetch({
            'GET /v1/payment_intents/pi_test_abc': {
                id: 'pi_test_abc',
                customer: 'cus_xxx',
                payment_method: 'pm_xxx',
                status: 'succeeded',
            },
        });
        const result = await retrievePaymentIntent('pi_test_abc', 'sk_test_mock');
        expect(result.id).toBe('pi_test_abc');
        expect(result.customer).toBe('cus_xxx');
        expect(result.payment_method).toBe('pm_xxx');

        const call = globalThis.fetch.mock.calls.find(([u]) =>
            u === 'https://api.stripe.com/v1/payment_intents/pi_test_abc'
        );
        expect(call).toBeDefined();
        expect(call[1].method).toBe('GET');
        expect(call[1].headers.Authorization).toBe('Bearer sk_test_mock');
    });
});

describe('chargeOffSession — input validation', () => {
    it('throws when customer missing', async () => {
        await expect(chargeOffSession({
            apiKey: 'sk_test', paymentMethod: 'pm_x', amount: 5000, idempotencyKey: 'k',
        })).rejects.toThrow(/customer required/);
    });

    it('throws when paymentMethod missing', async () => {
        await expect(chargeOffSession({
            apiKey: 'sk_test', customer: 'cus_x', amount: 5000, idempotencyKey: 'k',
        })).rejects.toThrow(/paymentMethod required/);
    });

    it('throws when amount not a positive integer', async () => {
        for (const bad of [0, -1, 1.5, NaN, '5000', null, undefined]) {
            await expect(chargeOffSession({
                apiKey: 'sk_test', customer: 'cus_x', paymentMethod: 'pm_x',
                amount: bad, idempotencyKey: 'k',
            })).rejects.toThrow(/positive integer/);
        }
    });

    it('throws when idempotencyKey missing', async () => {
        await expect(chargeOffSession({
            apiKey: 'sk_test', customer: 'cus_x', paymentMethod: 'pm_x', amount: 5000,
        })).rejects.toThrow(/idempotencyKey required/);
    });
});

describe('chargeOffSession — form body shape', () => {
    it('posts to /v1/payment_intents with off_session=true + confirm=true + customer + payment_method + amount', async () => {
        mockStripeFetch({
            'POST /v1/payment_intents': {
                id: 'pi_new_001',
                status: 'succeeded',
                amount_received: 5000,
            },
        });

        const result = await chargeOffSession({
            apiKey: 'sk_test',
            customer: 'cus_test_001',
            paymentMethod: 'pm_test_001',
            amount: 5000,
            idempotencyKey: 'charge_bc_001_offsession',
            metadata: { booking_id: 'bk_X', charge_id: 'bc_001', reason_kind: 'damage' },
        });
        expect(result.id).toBe('pi_new_001');
        expect(result.status).toBe('succeeded');

        const call = globalThis.fetch.mock.calls.find(([u]) =>
            u === 'https://api.stripe.com/v1/payment_intents'
        );
        expect(call).toBeDefined();
        expect(call[1].method).toBe('POST');
        expect(call[1].headers['Idempotency-Key']).toBe('charge_bc_001_offsession');

        const form = decodeForm(call[1].body);
        expect(form.amount).toBe('5000');
        expect(form.currency).toBe('usd');
        expect(form.customer).toBe('cus_test_001');
        expect(form.payment_method).toBe('pm_test_001');
        expect(form.off_session).toBe('true');
        expect(form.confirm).toBe('true');
        expect(form['metadata[booking_id]']).toBe('bk_X');
        expect(form['metadata[charge_id]']).toBe('bc_001');
        expect(form['metadata[reason_kind]']).toBe('damage');
    });

    it('defaults currency to usd', async () => {
        mockStripeFetch({ 'POST /v1/payment_intents': { id: 'pi', status: 'succeeded' } });
        await chargeOffSession({
            apiKey: 'sk_test', customer: 'cus_x', paymentMethod: 'pm_x',
            amount: 100, idempotencyKey: 'k',
        });
        const call = globalThis.fetch.mock.calls.find(([u]) => u.includes('/payment_intents'));
        expect(decodeForm(call[1].body).currency).toBe('usd');
    });

    it('accepts custom currency override', async () => {
        mockStripeFetch({ 'POST /v1/payment_intents': { id: 'pi', status: 'succeeded' } });
        await chargeOffSession({
            apiKey: 'sk_test', customer: 'cus_x', paymentMethod: 'pm_x',
            amount: 100, currency: 'eur', idempotencyKey: 'k',
        });
        const call = globalThis.fetch.mock.calls.find(([u]) => u.includes('/payment_intents'));
        expect(decodeForm(call[1].body).currency).toBe('eur');
    });
});

describe('chargeOffSession — error propagation', () => {
    it('throws when Stripe returns 402 (card_declined)', async () => {
        mockStripeFetch({
            'POST /v1/payment_intents': {
                __status: 402,
                error: {
                    code: 'card_declined',
                    message: 'Your card was declined.',
                    type: 'card_error',
                    payment_intent: { id: 'pi_failed_001' },
                },
            },
        });

        await expect(chargeOffSession({
            apiKey: 'sk_test', customer: 'cus_x', paymentMethod: 'pm_x',
            amount: 5000, idempotencyKey: 'k',
        })).rejects.toMatchObject({
            message: 'Your card was declined.',
            status: 402,
            stripe: expect.objectContaining({
                error: expect.objectContaining({ code: 'card_declined' }),
            }),
        });
    });

    it('throws when Stripe returns 402 (authentication_required / 3DS)', async () => {
        mockStripeFetch({
            'POST /v1/payment_intents': {
                __status: 402,
                error: {
                    code: 'authentication_required',
                    message: 'Authentication required',
                    payment_intent: { id: 'pi_3ds_001' },
                },
            },
        });

        await expect(chargeOffSession({
            apiKey: 'sk_test', customer: 'cus_x', paymentMethod: 'pm_x',
            amount: 5000, idempotencyKey: 'k',
        })).rejects.toMatchObject({
            stripe: expect.objectContaining({
                error: expect.objectContaining({ code: 'authentication_required' }),
            }),
        });
    });
});
