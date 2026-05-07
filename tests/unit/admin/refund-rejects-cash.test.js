// audit Group E #53 — POST /api/admin/bookings/:id/refund refuses cash
// bookings. Manual cash bookings carry a synthetic stripe_payment_intent
// of 'cash_<bookingId>'. The refund route detects the cash_ prefix and
// returns 400 without round-tripping to Stripe — cash refunds happen
// out-of-band (the manager hands the money back).
//
// Source: worker/routes/admin/bookings.js lines 401-403.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindBookingRow } from '../../helpers/adminBookingFixture.js';

describe('POST /api/admin/bookings/:id/refund — rejects cash (E53)', () => {
    it('returns 400 with explanatory error and issues no Stripe fetch', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingRow(env, {
            id: 'bk_cash_xyz',
            status: 'paid',
            stripePaymentIntent: 'cash_bk_cash_xyz',
        });

        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/bookings/bk_cash_xyz/refund', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'requested_by_customer' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/[Cc]ash/);
        expect(json.error).toMatch(/out of band|out-of-band/i);

        // No Stripe fetch attempted
        const stripeCalls = (globalThis.fetch.mock?.calls || []).filter(
            ([url]) => typeof url === 'string' && url.startsWith('https://api.stripe.com'),
        );
        expect(stripeCalls).toHaveLength(0);

        // No bookings UPDATE (status stays 'paid')
        const writes = env.DB.__writes();
        const refundUpdate = writes.find(
            (w) => w.kind === 'run' && /UPDATE bookings SET status = 'refunded'/.test(w.sql),
        );
        expect(refundUpdate).toBeUndefined();
    });
});
