// M6 B9 — POST /api/admin/bookings/:id/detach-saved-pm tests.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockStripeFetch } from '../../../helpers/mockStripe.js';

const BOOKING_ID = 'bk_pm_detach_test';
const ORIGINAL_PI = 'pi_original_xyz';
const PM_ID = 'pm_to_detach';

function bookingRow(extra = {}) {
    return {
        id: BOOKING_ID,
        stripe_payment_intent: ORIGINAL_PI,
        email: 'x@e.com',
        full_name: 'Customer X',
        ...extra,
    };
}

let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

const URL = (id) => `https://airactionsport.com/api/admin/bookings/${id}/detach-saved-pm`;

describe('POST /:id/detach-saved-pm — happy path', () => {
    it('returns 200 + detaches the PM from Stripe', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI,
                customer: 'cus_x',
                payment_method: PM_ID,
            },
            [`POST /v1/payment_methods/${PM_ID}/detach`]: {
                id: PM_ID,
                customer: null,
            },
        });

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            ok: true,
            bookingId: BOOKING_ID,
            detachedPaymentMethodId: PM_ID,
        });

        // Stripe was called for both retrieve + detach
        const detachCall = globalThis.fetch.mock.calls.find(([u]) =>
            u === `https://api.stripe.com/v1/payment_methods/${PM_ID}/detach`
        );
        expect(detachCall).toBeDefined();
    });

    it('writes audit log row booking.saved_pm_detached', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI, customer: 'cus_x', payment_method: PM_ID,
            },
            [`POST /v1/payment_methods/${PM_ID}/detach`]: { id: PM_ID, customer: null },
        });

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        await worker.fetch(req, env, {});

        const audit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args?.some((a) => typeof a === 'string' && a.includes('saved_pm_detached'))
        );
        expect(audit).toBeDefined();
    });
});

describe('POST /:id/detach-saved-pm — error paths', () => {
    it('returns 404 when booking does not exist', async () => {
        // No handler → first() returns null
        const req = new Request(URL('bk_missing'), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('booking_not_found');
    });

    it('returns 422 when booking has no stripe_payment_intent (legacy pre-B5)', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow({ stripe_payment_intent: null }), 'first');

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(422);
        expect((await res.json()).detail).toBe('booking_has_no_payment_intent');
    });

    it('returns 422 when Stripe PI has no payment_method attached', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI, customer: 'cus_x', payment_method: null,
            },
        });

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(422);
        expect((await res.json()).detail).toBe('no_payment_method_attached');
    });

    it('returns 502 when Stripe retrieve PI fails', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                __status: 500,
                error: { message: 'Internal error' },
            },
        });

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(502);
        expect((await res.json()).error).toBe('stripe_request_failed');
    });

    it('returns 200 with noop=true when PM already detached (idempotent)', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI, customer: 'cus_x', payment_method: PM_ID,
            },
            [`POST /v1/payment_methods/${PM_ID}/detach`]: {
                __status: 400,
                error: { code: 'payment_method_not_attached', message: 'PM not attached' },
            },
        });

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.noop).toBe(true);

        // Audit row for idempotent no-op
        const audit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args?.some((a) => typeof a === 'string' && a.includes('saved_pm_detach_noop'))
        );
        expect(audit).toBeDefined();
    });

    it('returns 502 on generic Stripe detach failure', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        mockStripeFetch({
            [`GET /v1/payment_intents/${ORIGINAL_PI}`]: {
                id: ORIGINAL_PI, customer: 'cus_x', payment_method: PM_ID,
            },
            [`POST /v1/payment_methods/${PM_ID}/detach`]: {
                __status: 500,
                error: { code: 'api_error', message: 'Stripe down' },
            },
        });

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(502);
    });
});

describe('POST /:id/detach-saved-pm — access control', () => {
    it('returns 403 when caller is manager (owner-only endpoint)', async () => {
        const mgrEnv = createMockEnv();
        const mgr = await createAdminSession(mgrEnv, { id: 'u_mgr', role: 'manager' });
        mgrEnv.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: mgr.cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, mgrEnv, {});
        expect(res.status).toBe(403);
    });

    it('returns 403 when caller is staff', async () => {
        const staffEnv = createMockEnv();
        const staff = await createAdminSession(staffEnv, { id: 'u_staff', role: 'staff' });

        const req = new Request(URL(BOOKING_ID), {
            method: 'POST',
            headers: { cookie: staff.cookieHeader, 'content-type': 'application/json' },
            body: '{}',
        });
        const res = await worker.fetch(req, staffEnv, {});
        expect(res.status).toBe(403);
    });
});
