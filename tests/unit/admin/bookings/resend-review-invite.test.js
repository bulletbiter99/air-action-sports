// POST /api/admin/bookings/:id/resend-review-invite tests (2026-07).
// Manual (re)send of the post-event review invite — sibling of
// /resend-waiver-confirmation, sentinel-disciplined like the nightly sweep
// (worker/lib/reviewInvites.js): stamp + token first, restore on a declined
// or failed send. Also pins the GET /:id detail additions (reviewInvite +
// review fields).
//
// Event dates are DERIVED from now (never hardcoded — the 2026-06-11
// sales-series calendar-time-bomb lesson): the endpoint compares UTC date
// portions, so "ended" = yesterday, "not ended" = tomorrow.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockResendFetch } from '../../../helpers/mockResend.js';

const BOOKING_ID = 'bk_rvi_test';

const dayOffsetIso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const YESTERDAY = dayOffsetIso(-1);
const TOMORROW = dayOffsetIso(1);

const BOOKING_ROW = {
    id: BOOKING_ID, event_id: 'evt_1', email: 'buyer@example.com',
    full_name: 'Buyer X', status: 'paid',
    review_invite_sent_at: null, review_token: null,
};
const ENDED_EVENT = {
    id: 'evt_1', title: 'Operation Last Light', display_date: '25 July 2026',
    date_iso: `${YESTERDAY}T08:30:00`, end_date_iso: null,
};
const TEMPLATE_ROW = {
    id: 'tpl_review_invite',
    slug: 'review_invite',
    subject: 'How was {{event_name}}?',
    body_html: '<p>{{player_name}} — <a href="{{review_link}}">rate your game</a></p>',
    body_text: '{{player_name}} {{review_link}}',
    status: 'published',
};

let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    ({ cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' }));
});

const url = (id) => `https://airactionsport.com/api/admin/bookings/${id}/resend-review-invite`;
const post = (id) => worker.fetch(
    new Request(url(id), { method: 'POST', headers: { cookie: cookieHeader } }),
    env,
    {},
);

function bindHappy({ booking = BOOKING_ROW, event = ENDED_EVENT, review = null, template = TEMPLATE_ROW } = {}) {
    env.DB.__on(/FROM bookings WHERE id = \?/, booking, 'first');
    env.DB.__on(/FROM events WHERE id = \?/, event, 'first');
    env.DB.__on(/FROM reviews WHERE booking_id = \?/, review, 'first');
    env.DB.__on(/FROM email_templates WHERE slug/, template, 'first');
}

function captureUpdates() {
    const updates = [];
    env.DB.__on(/UPDATE bookings SET review_invite_sent_at = \?, review_token = \? WHERE id = \?/,
        (sql, args) => { updates.push(args); return {}; }, 'run');
    return updates;
}

describe('POST /:id/resend-review-invite', () => {
    it('mints a token, stamps the sentinel, emails the review link, and audits', async () => {
        bindHappy();
        const updates = captureUpdates();
        const audits = [];
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => { audits.push({ sql, args }); return {}; }, 'run');
        mockResendFetch();

        const res = await post(BOOKING_ID);
        expect(res.status).toBe(200);
        const j = await res.json();
        expect(j.success).toBe(true);
        expect(j.sentTo).toBe('buyer@example.com');

        // One stamp UPDATE (no restore): [sentAt, token, id]
        expect(updates).toHaveLength(1);
        const [sentAt, token, id] = updates[0];
        expect(typeof sentAt).toBe('number');
        // reviewToken() mints a long unprefixed token (worker/lib/ids.js).
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThanOrEqual(20);
        expect(id).toBe(BOOKING_ID);

        const calls = globalThis.fetch.mock.calls;
        expect(calls).toHaveLength(1);
        const body = JSON.parse(calls[0][1].body);
        expect([].concat(body.to)).toContain('buyer@example.com');
        expect(body.html).toContain(`/review?token=${token}`);
        expect(body.tags).toContainEqual({ name: 'type', value: 'review_invite' });

        expect(audits).toHaveLength(1);
        expect(audits[0].sql).toContain('booking.review_invite_resent');
        expect(audits[0].args).toContain(BOOKING_ID);
    });

    it('reuses the existing review_token so a previously-emailed link stays alive', async () => {
        bindHappy({ booking: { ...BOOKING_ROW, review_invite_sent_at: 1753500000000, review_token: 'rvt_existing123' } });
        const updates = captureUpdates();
        mockResendFetch();

        const res = await post(BOOKING_ID);
        expect(res.status).toBe(200);
        expect(updates[0][1]).toBe('rvt_existing123');
        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.html).toContain('/review?token=rvt_existing123');
    });

    it('404 for an unknown booking', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, null, 'first');
        const res = await post('bk_nope');
        expect(res.status).toBe(404);
    });

    it('409 for a pending (unpaid) booking', async () => {
        bindHappy({ booking: { ...BOOKING_ROW, status: 'pending' } });
        const res = await post(BOOKING_ID);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/paid or comp/);
    });

    it('409 while the event has not ended yet', async () => {
        bindHappy({ event: { ...ENDED_EVENT, date_iso: `${TOMORROW}T08:30:00` } });
        const res = await post(BOOKING_ID);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/has not ended/);
    });

    // Two tests, not one: mockD1 keeps the FIRST handler registered for a
    // pattern, so re-binding the events row mid-test never takes effect.
    it('multi-day event still running (end_date_iso in the future) → 409', async () => {
        bindHappy({ event: { ...ENDED_EVENT, date_iso: `${dayOffsetIso(-2)}T19:45:00`, end_date_iso: `${TOMORROW}T12:00:00` } });
        expect((await post(BOOKING_ID)).status).toBe(409);
    });

    it('multi-day event whose span has ended → 200', async () => {
        bindHappy({ event: { ...ENDED_EVENT, date_iso: `${dayOffsetIso(-3)}T19:45:00`, end_date_iso: `${YESTERDAY}T12:00:00` } });
        captureUpdates();
        mockResendFetch();
        expect((await post(BOOKING_ID)).status).toBe(200);
    });

    it('409 when a review was already submitted', async () => {
        bindHappy({ review: { id: 'rev_1' } });
        const res = await post(BOOKING_ID);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/already submitted/);
    });

    it('400 when the booking has no buyer email', async () => {
        bindHappy({ booking: { ...BOOKING_ROW, email: null } });
        const res = await post(BOOKING_ID);
        expect(res.status).toBe(400);
    });

    it('403 for staff role (write stays gated under the open-reads model)', async () => {
        const staffEnv = createMockEnv();
        const staff = await createAdminSession(staffEnv, { id: 'u_staff', role: 'staff' });
        const res = await worker.fetch(
            new Request(url(BOOKING_ID), { method: 'POST', headers: { cookie: staff.cookieHeader } }),
            staffEnv,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('template missing → 500 and the sentinel is restored (stamp then restore)', async () => {
        bindHappy({ template: null });
        const updates = captureUpdates();
        mockResendFetch();

        const res = await post(BOOKING_ID);
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/template_missing/);
        // Stamp, then restore to the prior (null, null) state.
        expect(updates).toHaveLength(2);
        expect(updates[1][0]).toBe(null);
        expect(updates[1][1]).toBe(null);
        expect(globalThis.fetch.mock.calls).toHaveLength(0);
    });
});

describe('GET /:id — reviewInvite + review response fields (2026-07)', () => {
    const detailUrl = `https://airactionsport.com/api/admin/bookings/${BOOKING_ID}`;
    const get = () => worker.fetch(
        new Request(detailUrl, { headers: { cookie: cookieHeader } }),
        env,
        {},
    );

    it('surfaces the invite sentinel and a null review by default', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, { ...BOOKING_ROW, review_invite_sent_at: 1753500000000, customer_id: null, total_cents: 6000, line_items_json: '[]' }, 'first');
        env.DB.__on(/FROM events WHERE id = \?/, ENDED_EVENT, 'first');
        const res = await get();
        expect(res.status).toBe(200);
        const j = await res.json();
        // `eventEnded` is additive (2026-07-27): the client used to recompute
        // this predicate locally and made the identical UTC-vs-Denver mistake as
        // the server, so both agreed and the Resend button lit up ~6h early on
        // event day. Now server-computed, single source of truth.
        expect(j.reviewInvite).toEqual({ sentAt: 1753500000000, eventEnded: true });
        expect(j.review).toBe(null);
    });

    it('surfaces a submitted review', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, { ...BOOKING_ROW, customer_id: null, total_cents: 6000, line_items_json: '[]' }, 'first');
        env.DB.__on(/FROM events WHERE id = \?/, ENDED_EVENT, 'first');
        env.DB.__on(/FROM reviews WHERE booking_id = \?/, { id: 'rev_1', status: 'published', rating: 5, created_at: 1753500000000 }, 'first');
        const res = await get();
        const j = await res.json();
        expect(j.review).toEqual({ id: 'rev_1', status: 'published', rating: 5, createdAt: 1753500000000 });
    });
});
