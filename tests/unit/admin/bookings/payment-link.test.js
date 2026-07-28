// Sprint 4 C8 — pending-card payment-link recovery on GET /api/admin/bookings/:id.
//
// The Stripe Checkout URL used to be shown exactly once (on the create screen)
// and was unrecoverable afterwards. The detail response now carries an
// additive `payment` object for status='pending' + payment_method='card' +
// stripe_session_id: { sessionStatus, url } — url only while the session is
// still 'open'. Everything else gets payment: null, and a Stripe failure
// degrades to { sessionStatus: 'unavailable' } rather than breaking the page.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockStripeFetch } from '../../../helpers/mockStripe.js';

function bindFixture(env, overrides = {}) {
    env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, {
        id: 'bk_1', event_id: 'ev_1',
        full_name: 'Alice', email: 'alice@example.com', phone: null,
        player_count: 1, line_items_json: '[]',
        subtotal_cents: 6000, total_cents: 6000,
        status: 'pending', payment_method: 'card',
        stripe_session_id: 'cs_live_xyz',
        pending_attendees_json: '[]',
        created_at: 1000, customer_id: null,
        ...overrides,
    }, 'first');
    env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
        id: 'ev_1', title: 'Op', date_iso: '2099-05-09T08:30:00',
        addons_json: '[]', game_modes_json: '[]', custom_questions_json: '[]',
    }, 'first');
    env.DB.__on(/FROM attendees a\s+LEFT JOIN waivers/, { results: [] }, 'all');
    env.DB.__on(/FROM audit_log\s+WHERE target_id = \? AND target_type = 'booking'/, { results: [] }, 'all');
}

async function getDetail(env, cookieHeader) {
    return await worker.fetch(
        new Request('https://airactionsport.com/api/admin/bookings/bk_1', {
            headers: { cookie: cookieHeader },
        }),
        env, {},
    );
}

describe('GET /api/admin/bookings/:id — payment-link recovery (C8)', () => {
    it('returns the live checkout URL while the session is open', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env);
        mockStripeFetch({
            'GET /v1/checkout/sessions/cs_live_xyz': {
                id: 'cs_live_xyz', status: 'open',
                url: 'https://checkout.stripe.com/c/pay/cs_live_xyz',
            },
        });

        const res = await getDetail(env, cookieHeader);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.payment).toEqual({
            sessionStatus: 'open',
            url: 'https://checkout.stripe.com/c/pay/cs_live_xyz',
        });
    });

    it('returns url: null once the session has expired', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env);
        mockStripeFetch({
            'GET /v1/checkout/sessions/cs_live_xyz': { id: 'cs_live_xyz', status: 'expired', url: null },
        });

        const json = await (await getDetail(env, cookieHeader)).json();
        expect(json.payment.sessionStatus).toBe('expired');
        expect(json.payment.url).toBeNull();
    });

    it('degrades to sessionStatus unavailable when Stripe errors (page still loads)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env);
        mockStripeFetch({
            'GET /v1/checkout/sessions/cs_live_xyz': { __status: 500, error: { message: 'boom' } },
        });

        const res = await getDetail(env, cookieHeader);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.payment).toEqual({ sessionStatus: 'unavailable', url: null });
    });

    it('payment is null for a paid booking (no Stripe call made)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env, { status: 'paid', paid_at: 2000 });

        const json = await (await getDetail(env, cookieHeader)).json();
        expect(json.payment).toBeNull();
        const stripeCalls = (globalThis.fetch.mock?.calls || []).filter(([url]) =>
            String(url).includes('api.stripe.com'));
        expect(stripeCalls.length).toBe(0);
    });

    it('payment is null for a pending CASH-path booking with no session id', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env, { stripe_session_id: null });

        const json = await (await getDetail(env, cookieHeader)).json();
        expect(json.payment).toBeNull();
    });
});
