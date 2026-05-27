// M6 B9 — detachPaymentMethod lib helper.

import { describe, it, expect } from 'vitest';
import { detachPaymentMethod } from '../../../worker/lib/stripe.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';

describe('detachPaymentMethod', () => {
    it('throws when paymentMethodId missing', async () => {
        await expect(detachPaymentMethod('', 'sk_test')).rejects.toThrow(/paymentMethodId required/);
        await expect(detachPaymentMethod(null, 'sk_test')).rejects.toThrow(/paymentMethodId required/);
    });

    it('issues POST to /v1/payment_methods/:id/detach with Authorization header', async () => {
        mockStripeFetch({
            'POST /v1/payment_methods/pm_test_001/detach': {
                id: 'pm_test_001',
                customer: null,  // detached → customer becomes null
            },
        });
        const result = await detachPaymentMethod('pm_test_001', 'sk_test_mock');
        expect(result.id).toBe('pm_test_001');
        expect(result.customer).toBeNull();

        const call = globalThis.fetch.mock.calls.find(([u]) =>
            u === 'https://api.stripe.com/v1/payment_methods/pm_test_001/detach'
        );
        expect(call).toBeDefined();
        expect(call[1].method).toBe('POST');
        expect(call[1].headers.Authorization).toBe('Bearer sk_test_mock');
    });

    it('propagates Stripe errors (resource_missing)', async () => {
        mockStripeFetch({
            'POST /v1/payment_methods/pm_does_not_exist/detach': {
                __status: 404,
                error: {
                    code: 'resource_missing',
                    message: 'No such payment_method: pm_does_not_exist',
                },
            },
        });

        await expect(detachPaymentMethod('pm_does_not_exist', 'sk_test')).rejects.toMatchObject({
            status: 404,
            stripe: expect.objectContaining({
                error: expect.objectContaining({ code: 'resource_missing' }),
            }),
        });
    });
});
