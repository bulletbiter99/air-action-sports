// Sprint 4 C1 — the sales-closed gate on public /quote + /checkout.
//
// The archive/bookability contract: an event that has ended (past=1) or whose
// sales cutoff (sales_close_at, epoch ms) has passed must refuse new quotes
// and checkouts with 409 { salesClosed: true }, even while it stays published
// (archived events remain visible on /games and their detail pages).
//
// This pins the ADDITIVE guard in worker/routes/bookings.js (salesClosedError):
// the pricing/booking flow below the gate is untouched — Groups A/B cover that.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';

const QUOTE_URL = 'https://airactionsport.com/api/bookings/quote';
const CHECKOUT_URL = 'https://airactionsport.com/api/bookings/checkout';

function eventRow(extra = {}) {
    return {
        id: 'evt_op_nightfall',
        slug: 'operation-nightfall',
        title: 'Operation Nightfall',
        location: 'Ghost Town',
        date_iso: '2026-05-09',
        display_date: '9 May 2026',
        published: 1,
        past: 0,
        sales_close_at: null,
        created_at: 1700000000000,
        custom_questions_json: null,
        ...extra,
    };
}

function ticketTypeRow() {
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
    };
}

function bindMocks(env, eventExtra = {}) {
    env.DB.__on(/SELECT custom_questions_json FROM events WHERE id/, { custom_questions_json: null }, 'first');
    env.DB.__on(/SELECT \* FROM events WHERE id = \? AND published = 1/, eventRow(eventExtra), 'first');
    env.DB.__on(/SELECT \* FROM ticket_types WHERE event_id = \? AND active = 1/, {
        results: [ticketTypeRow()],
    }, 'all');
    env.DB.__on(/FROM taxes_fees WHERE active = 1/, { results: [] }, 'all');
    env.DB.__on(/SELECT line_items_json FROM bookings WHERE event_id/, { results: [] }, 'all');
    env.DB.__on(/SELECT id, name, capacity FROM ticket_types WHERE event_id/, {
        results: [ticketTypeRow()],
    }, 'all');
}

function quoteReq() {
    return new Request(QUOTE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            eventId: 'evt_op_nightfall',
            ticketSelections: [{ ticketTypeId: 'tt_standard', qty: 1 }],
        }),
    });
}

function checkoutReq() {
    return new Request(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            eventId: 'evt_op_nightfall',
            buyer: { fullName: 'Jane Player', email: 'jane@example.com', phone: '+1 555 0199' },
            attendees: [{ firstName: 'Jane', lastName: 'Player', ticketTypeId: 'tt_standard' }],
        }),
    });
}

let env;
beforeEach(() => {
    env = createMockEnv();
});

describe('sales-closed gate — past events (archived)', () => {
    it('409s /quote for a past=1 event', async () => {
        bindMocks(env, { past: 1 });
        const res = await worker.fetch(quoteReq(), env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.salesClosed).toBe(true);
        expect(body.error).toMatch(/ended/i);
    });

    it('409s /checkout for a past=1 event and never touches Stripe or inserts a booking', async () => {
        bindMocks(env, { past: 1 });
        const res = await worker.fetch(checkoutReq(), env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.salesClosed).toBe(true);
        // No Stripe call was attempted (fetch mock would throw on unmocked).
        const stripeCalls = (globalThis.fetch.mock?.calls || []).filter(([url]) =>
            String(url).includes('api.stripe.com'));
        expect(stripeCalls.length).toBe(0);
        // No INSERT INTO bookings executed.
        const inserts = env.DB.__writes().filter((e) => /INSERT INTO bookings/.test(e.sql));
        expect(inserts.length).toBe(0);
    });
});

describe('sales-closed gate — sales_close_at cutoff', () => {
    it('409s /quote once the cutoff has passed', async () => {
        bindMocks(env, { sales_close_at: Date.now() - 60_000 });
        const res = await worker.fetch(quoteReq(), env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.salesClosed).toBe(true);
        expect(body.error).toMatch(/closed/i);
    });

    it('409s /checkout once the cutoff has passed', async () => {
        bindMocks(env, { sales_close_at: Date.now() - 60_000 });
        const res = await worker.fetch(checkoutReq(), env, {});
        expect(res.status).toBe(409);
        expect((await res.json()).salesClosed).toBe(true);
    });

    it('allows /quote while the cutoff is still in the future', async () => {
        bindMocks(env, { sales_close_at: Date.now() + 60 * 60 * 1000 });
        const res = await worker.fetch(quoteReq(), env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.salesClosed).toBeUndefined();
        expect(body.totalCents).toBeGreaterThan(0);
    });

    it('allows /checkout while the cutoff is still in the future', async () => {
        bindMocks(env, { sales_close_at: Date.now() + 60 * 60 * 1000 });
        mockStripeFetch({
            'POST /v1/checkout/sessions': {
                id: 'cs_test_gate',
                url: 'https://checkout.stripe.com/c/cs_test_gate',
            },
        });
        const res = await worker.fetch(checkoutReq(), env, {});
        expect(res.status).toBe(200);
    });

    it('treats a NULL sales_close_at as no cutoff (open)', async () => {
        bindMocks(env, { sales_close_at: null });
        const res = await worker.fetch(quoteReq(), env, {});
        expect(res.status).toBe(200);
    });
});
