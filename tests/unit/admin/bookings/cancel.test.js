// POST /api/admin/bookings/:id/cancel — Sprint 4 C8.
//
// Cancels a never-completed booking (pending/abandoned only — no attendees,
// no inventory counted). Expires the Stripe Checkout session first so the
// old payment link can't resurrect the booking via webhook redelivery
// semantics (the idempotency guard only short-circuits on status='paid').
// Everything else 409s with a pointer at the right tool.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockStripeFetch } from '../../../helpers/mockStripe.js';

function bindBooking(env, extra = {}) {
    env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, {
        id: 'bk_1',
        event_id: 'evt_1',
        full_name: 'Glen', email: 'glen@example.com',
        status: 'pending',
        payment_method: 'card',
        stripe_session_id: 'cs_live_abc',
        total_cents: 6000,
        ...extra,
    }, 'first');
}

async function post(env, cookieHeader, id = 'bk_1') {
    return await worker.fetch(
        new Request(`https://airactionsport.com/api/admin/bookings/${id}/cancel`, {
            method: 'POST',
            headers: { cookie: cookieHeader },
        }),
        env, {},
    );
}

describe('POST /api/admin/bookings/:id/cancel — happy paths', () => {
    it('expires the Stripe session, flips status to cancelled, writes audit', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });
        bindBooking(env);
        mockStripeFetch({
            'POST /v1/checkout/sessions/cs_live_abc/expire': { id: 'cs_live_abc', status: 'expired' },
        });

        const res = await post(env, cookieHeader);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.status).toBe('cancelled');
        expect(json.sessionExpired).toBe(true);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE bookings SET status = 'cancelled'/.test(w.sql));
        expect(update).toBeDefined();
        expect(update.args[1]).toBe('bk_1');

        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && /booking\.cancelled/.test(w.sql));
        expect(audit).toBeDefined();
        const meta = JSON.parse(audit.args[2]);
        expect(meta.prior_status).toBe('pending');
        expect(meta.session_expired).toBe(true);
    });

    it('cancels an abandoned booking without a session (no Stripe call)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });
        bindBooking(env, { status: 'abandoned', stripe_session_id: null });

        const res = await post(env, cookieHeader);
        expect(res.status).toBe(200);
        expect((await res.json()).sessionExpired).toBe(false);
        const stripeCalls = (globalThis.fetch.mock?.calls || []).filter(([url]) =>
            String(url).includes('api.stripe.com'));
        expect(stripeCalls.length).toBe(0);
    });

    it('still cancels when the Stripe expire fails (session self-expires in 24h)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });
        bindBooking(env);
        // Session already expired → Stripe 400s; cancel proceeds, flag false.
        mockStripeFetch({
            'POST /v1/checkout/sessions/cs_live_abc/expire': {
                __status: 400, error: { message: 'Session is not open' },
            },
        });

        const res = await post(env, cookieHeader);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('cancelled');
        expect(json.sessionExpired).toBe(false);
        const audit = env.DB.__writes().find((w) => /booking\.cancelled/.test(w.sql));
        expect(JSON.parse(audit.args[2]).session_expired).toBe(false);
    });
});

describe('POST /api/admin/bookings/:id/cancel — rails', () => {
    it.each([
        ['paid', /refund/i],
        ['comp', /refund/i],
        ['unpaid', /record payment/i],
        ['refunded', /nothing to cancel/i],
        ['cancelled', /nothing to cancel/i],
    ])('409s a %s booking with a pointed hint', async (status, hintRe) => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });
        bindBooking(env, { status });
        const res = await post(env, cookieHeader);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(hintRe);
        // No status flip happened.
        const writes = env.DB.__writes();
        expect(writes.some((w) => /UPDATE bookings SET status = 'cancelled'/.test(w.sql))).toBe(false);
    });

    it('404 when the booking is missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, null, 'first');
        expect((await post(env, cookieHeader, 'bk_missing')).status).toBe(404);
    });

    it('403 when the caller is staff', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindBooking(env);
        expect((await post(env, cookieHeader)).status).toBe(403);
    });
});
