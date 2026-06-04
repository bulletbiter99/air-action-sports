// POST /api/admin/bookings/:id/reschedule — move a booking to another event.
//
// Remaps event_id + ticket line items + attendees to the chosen target
// event/ticket type, adjusts both events' sold counts, PRESERVES payment,
// blocks checked-in attendees, and writes a booking.rescheduled audit row.
// requireRole('owner', 'manager') — staff is 403.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockResendFetch } from '../../../helpers/mockResend.js';

function buildReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

function bindFixture(env, { booking = {}, targetEvent = {}, targetType = {}, attendees } = {}) {
    env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, {
        id: 'bk_1',
        event_id: 'volga',
        full_name: 'Glen', email: 'glen@example.com', phone: null,
        player_count: 1,
        line_items_json: '[{"type":"ticket","ticket_type_id":"tt_volga","name":"General Admission (comp)","qty":1,"unit_price_cents":0,"line_total_cents":0}]',
        total_cents: 0, status: 'comp', payment_method: 'comp',
        customer_id: 'cus_glen',
        ...booking,
    }, 'first');
    env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
        id: 'foxtrot', title: 'Foxtrot: Jungle Warfare', published: 1, ...targetEvent,
    }, 'first');
    env.DB.__on(/SELECT id, event_id, name, price_cents, active FROM ticket_types WHERE id = \?/, {
        id: 'tt_foxtrot', event_id: 'foxtrot', name: 'General Admission', price_cents: 2500, active: 1, ...targetType,
    }, 'first');
    env.DB.__on(/SELECT id, checked_in_at FROM attendees WHERE booking_id = \?/,
        { results: attendees || [{ id: 'at_1', checked_in_at: null }] }, 'all');
}

async function post(env, cookieHeader, id, body) {
    return await worker.fetch(
        buildReq(`/api/admin/bookings/${id}/reschedule`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env, {},
    );
}

const GOOD = { targetEventId: 'foxtrot', targetTicketTypeId: 'tt_foxtrot' };

describe('POST /api/admin/bookings/:id/reschedule — happy path', () => {
    it('remaps event + ticket type + attendees, adjusts sold, writes audit', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindFixture(env);

        const res = await post(env, cookieHeader, 'bk_1', GOOD);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.toEvent).toBe('foxtrot');
        expect(json.toEventTitle).toBe('Foxtrot: Jungle Warfare');
        expect(json.ticketQty).toBe(1);

        const writes = env.DB.__writes();
        const bUpdate = writes.find((w) => /UPDATE bookings SET event_id/.test(w.sql));
        expect(bUpdate).toBeDefined();
        expect(bUpdate.args[0]).toBe('foxtrot');
        expect(bUpdate.args[1]).toContain('tt_foxtrot');           // line items remapped
        expect(bUpdate.sql).toMatch(/reminder_sent_at = NULL/);    // reminders reset

        const aUpdate = writes.find((w) => /UPDATE attendees SET ticket_type_id/.test(w.sql));
        expect(aUpdate).toBeDefined();
        expect(aUpdate.args[0]).toBe('tt_foxtrot');

        const release = writes.find((w) => /UPDATE ticket_types SET sold = MAX/.test(w.sql) && w.args.includes('tt_volga'));
        expect(release).toBeDefined();
        const claim = writes.find((w) => /UPDATE ticket_types SET sold = sold \+/.test(w.sql) && w.args.includes('tt_foxtrot'));
        expect(claim).toBeDefined();

        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && /booking\.rescheduled/.test(w.sql));
        expect(audit).toBeDefined();
        const meta = JSON.parse(audit.args[2]);
        expect(meta.from_event).toBe('volga');
        expect(meta.to_event).toBe('foxtrot');
    });

    it('does not email the customer unless resendConfirmation is set', async () => {
        const env = createMockEnv();
        const fetchMock = mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindFixture(env);
        await post(env, cookieHeader, 'bk_1', GOOD);
        const resendCalls = (fetchMock.mock.calls || []).filter(([url]) => url === 'https://api.resend.com/emails');
        expect(resendCalls).toHaveLength(0);
    });
});

describe('POST /api/admin/bookings/:id/reschedule — guards', () => {
    it('400 when target fields are missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env);
        expect((await post(env, cookieHeader, 'bk_1', {})).status).toBe(400);
    });

    it('409 when target equals the current event', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env, { booking: { event_id: 'foxtrot' } });
        expect((await post(env, cookieHeader, 'bk_1', GOOD)).status).toBe(409);
    });

    it('404 when the booking is missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, null, 'first');
        expect((await post(env, cookieHeader, 'bk_x', GOOD)).status).toBe(404);
    });

    it('404 when the target event is missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, { id: 'bk_1', event_id: 'volga', status: 'comp', line_items_json: '[]', customer_id: 'c' }, 'first');
        env.DB.__on(/SELECT \* FROM events WHERE id = \?/, null, 'first');
        expect((await post(env, cookieHeader, 'bk_1', GOOD)).status).toBe(404);
    });

    it('409 when the target event is not published', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env, { targetEvent: { published: 0 } });
        expect((await post(env, cookieHeader, 'bk_1', GOOD)).status).toBe(409);
    });

    it('400 when the ticket type belongs to a different event', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env, { targetType: { event_id: 'someother' } });
        expect((await post(env, cookieHeader, 'bk_1', GOOD)).status).toBe(400);
    });

    it('409 when an attendee is already checked in', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env, { attendees: [{ id: 'at_1', checked_in_at: 123 }] });
        expect((await post(env, cookieHeader, 'bk_1', GOOD)).status).toBe(409);
    });

    it('409 when the booking status is pending (not paid/comp)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u', role: 'manager' });
        bindFixture(env, { booking: { status: 'pending' } });
        expect((await post(env, cookieHeader, 'bk_1', GOOD)).status).toBe(409);
    });

    it('403 when the caller is staff', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindFixture(env);
        expect((await post(env, cookieHeader, 'bk_1', GOOD)).status).toBe(403);
    });
});
