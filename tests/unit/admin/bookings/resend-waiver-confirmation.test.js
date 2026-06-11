// POST /api/admin/bookings/:id/resend-waiver-confirmation tests (2026-06-11).
// Re-sends the waiver-confirmation receipt for every signed, non-cancelled
// attendee on the booking. Sibling of /resend-confirmation; the support tool
// for "did my waiver go through?".

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockResendFetch } from '../../../helpers/mockResend.js';

const BOOKING_ID = 'bk_wconf_test';

const BOOKING_ROW = { id: BOOKING_ID, event_id: 'evt_1', email: 'buyer@example.com', full_name: 'Buyer X', status: 'paid' };
const EVENT_ROW = { id: 'evt_1', title: 'FOXTROT: Jungle Warfare', display_date: '20 June 2026', location: 'Kaysville, UT' };
const TEMPLATE_ROW = {
    id: 'tpl_waiver_confirmation',
    slug: 'waiver_confirmation',
    subject: 'Waiver on file — {{event_name}} ({{event_date}})',
    body_html: '<p>{{player_name}} — <a href="{{ticket_link}}">ticket</a></p>',
    body_text: '{{player_name}} {{ticket_link}}',
    status: 'published',
};

const SIGNED_ROWS = [
    { attendee_id: 'at_1', booking_id: BOOKING_ID, email: 'alice@example.com', player_name: 'Alice Smith', signed_at: 1781136000000, claim_period_expires_at: 1812672000000 },
    { attendee_id: 'at_2', booking_id: BOOKING_ID, email: 'bob@example.com', player_name: 'Bob Smith', signed_at: 1781136000000, claim_period_expires_at: 1812672000000 },
];

let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    ({ cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' }));
});

const url = (id) => `https://airactionsport.com/api/admin/bookings/${id}/resend-waiver-confirmation`;
const post = (id) => worker.fetch(
    new Request(url(id), { method: 'POST', headers: { cookie: cookieHeader } }),
    env,
    {},
);

function bindHappy({ signed = SIGNED_ROWS, template = TEMPLATE_ROW } = {}) {
    env.DB.__on(/FROM bookings WHERE id = \?/, BOOKING_ROW, 'first');
    env.DB.__on(/FROM events WHERE id = \?/, EVENT_ROW, 'first');
    env.DB.__on(/JOIN waivers w ON w\.id = a\.waiver_id/, { results: signed }, 'all');
    env.DB.__on(/FROM email_templates WHERE slug/, template, 'first');
}

describe('POST /:id/resend-waiver-confirmation', () => {
    it('sends one receipt per signed attendee and audits each', async () => {
        bindHappy();
        mockResendFetch();
        const audits = [];
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => { audits.push({ sql, args }); return {}; }, 'run');

        const res = await post(BOOKING_ID);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ sent: 2, skipped: 0, failed: 0 });

        const calls = globalThis.fetch.mock.calls;
        expect(calls).toHaveLength(2);
        const first = JSON.parse(calls[0][1].body);
        expect([].concat(first.to)).toContain('alice@example.com');
        expect(first.subject).toBe('Waiver on file — FOXTROT: Jungle Warfare (20 June 2026)');
        expect(first.html).toContain(`/booking/success?token=${BOOKING_ID}`);
        expect(first.tags).toContainEqual({ name: 'type', value: 'waiver_confirmation' });
        expect(first.tags).toContainEqual({ name: 'attendee_id', value: 'at_1' });

        expect(audits).toHaveLength(2);
        expect(audits[0].sql).toContain('booking.waiver_confirmation_resent');
        expect(audits[0].args).toContain('at_1');
    });

    it('404 for an unknown booking', async () => {
        env.DB.__on(/FROM bookings WHERE id = \?/, null, 'first');
        const res = await post('bk_nope');
        expect(res.status).toBe(404);
    });

    it('409 when no attendee has a signed waiver yet', async () => {
        bindHappy({ signed: [] });
        const res = await post(BOOKING_ID);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/No signed waivers/);
    });

    it('403 for staff role', async () => {
        const staffEnv = createMockEnv();
        const staff = await createAdminSession(staffEnv, { id: 'u_staff', role: 'staff' });
        const res = await worker.fetch(
            new Request(url(BOOKING_ID), { method: 'POST', headers: { cookie: staff.cookieHeader } }),
            staffEnv,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('template missing → 200 with everything skipped, nothing sent', async () => {
        bindHappy({ template: null });
        mockResendFetch();
        const res = await post(BOOKING_ID);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ sent: 0, skipped: 2, failed: 0 });
        expect(globalThis.fetch.mock.calls).toHaveLength(0);
    });
});
