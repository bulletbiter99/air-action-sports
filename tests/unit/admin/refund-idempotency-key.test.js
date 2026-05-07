// audit Group E #52 — POST /api/admin/bookings/:id/refund passes
// Idempotency-Key to Stripe. Guards against double-refund on retry: if a
// manager double-clicks "Refund" or the browser retries the request,
// Stripe dedupes via the key and returns the same refund (no second money
// movement).
//
// Source: worker/routes/admin/bookings.js line 413 — idempotencyKey:
// `refund_${id}`. The Stripe wrapper sets Idempotency-Key header.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';
import { bindBookingRow } from '../../helpers/adminBookingFixture.js';

describe('POST /api/admin/bookings/:id/refund — Idempotency-Key (E52)', () => {
    it('issues Stripe /v1/refunds with Idempotency-Key: refund_<bookingId>', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingRow(env, {
            id: 'bk_pay_xyz',
            status: 'paid',
            stripePaymentIntent: 'pi_real_abc',
        });

        mockStripeFetch({
            'POST /v1/refunds': {
                id: 're_mock_abc',
                status: 'succeeded',
            },
        });

        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/bookings/bk_pay_xyz/refund', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'requested_by_customer' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);

        const stripeCalls = globalThis.fetch.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.startsWith('https://api.stripe.com'),
        );
        expect(stripeCalls).toHaveLength(1);

        const [url, init] = stripeCalls[0];
        expect(url).toBe('https://api.stripe.com/v1/refunds');
        expect(init.method).toBe('POST');

        // The critical assertion — Idempotency-Key shaped as refund_<bookingId>
        expect(init.headers['Idempotency-Key']).toBe('refund_bk_pay_xyz');

        // Sanity: the refund body carries payment_intent + reason
        expect(init.body).toContain('payment_intent=pi_real_abc');
        expect(init.body).toContain('reason=requested_by_customer');
    });
});
