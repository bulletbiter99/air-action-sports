// M4 Batch 3a — GET /api/admin/bookings/:id detail view.
//
// Existing payload (booking + event + attendees) preserved verbatim.
// New B3a additions:
//   - customer card (LTV / total_bookings / refund_count / prior_booking_count
//     / archived flag) sourced from customers row when booking.customer_id set
//   - activityLog: last 20 audit_log rows with target_type='booking' AND
//     target_id=bookingId, ORDER BY created_at DESC
//   - PII masking per D05: caller without `bookings.read.pii` capability
//     (staff role) sees masked email + phone; caller with capability
//     (manager/owner) sees full PII + writes audit row 'customer_pii.unmasked'
//   - viewerCanSeePII: boolean in response so client can render
//     "PII gated for this role" without parsing the masked values

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

function buildReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

function bindBookingFixture(env, overrides = {}) {
    const booking = {
        id: 'bk_1',
        event_id: 'ev_1',
        full_name: 'Alice Adams',
        email: 'alice@example.com',
        phone: '555-867-5309',
        player_count: 2,
        line_items_json: '[{"type":"ticket","ticket_type_id":"tt_1","qty":2,"line_total_cents":16000}]',
        subtotal_cents: 16000, discount_cents: 0, tax_cents: 0, fee_cents: 0, total_cents: 16000,
        status: 'paid', payment_method: 'cash',
        stripe_session_id: null, stripe_payment_intent: 'cash_bk_1',
        notes: null, pending_attendees_json: null,
        created_at: 1000, paid_at: 1000, refunded_at: null,
        cancelled_at: null,
        reminder_sent_at: null, reminder_1hr_sent_at: null,
        customer_id: 'cus_alice',
        refund_external: 0, refund_external_method: null, refund_external_reference: null,
        refund_requested_at: null,
        ...overrides,
    };
    env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, booking, 'first');
    env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
        id: 'ev_1', title: 'Op Nightfall', date_iso: '2026-05-09T08:30:00',
        display_date: '9 May 2026', location: 'Ghost Town',
        addons_json: '[]', game_modes_json: '[]', custom_questions_json: '[]',
    }, 'first');
    env.DB.__on(/FROM attendees a\s+LEFT JOIN waivers/, { results: [] }, 'all');
    env.DB.__on(
        /FROM customers WHERE id = \?/,
        {
            id: 'cus_alice', email: 'alice@example.com', name: 'Alice Adams', phone: '555-867-5309',
            total_bookings: 5, total_attendees: 8, lifetime_value_cents: 80000, refund_count: 1,
            first_booking_at: 100, last_booking_at: 1000, archived_at: null,
        },
        'first',
    );
    env.DB.__on(
        /FROM audit_log\s+WHERE target_id = \? AND target_type = 'booking'/,
        {
            results: [
                { id: 'al_1', user_id: 'u_admin', action: 'booking.manual_cash', target_type: 'booking',
                  target_id: 'bk_1', meta_json: '{"event_id":"ev_1"}', created_at: 1100 },
                { id: 'al_2', user_id: 'u_admin', action: 'booking.confirmation_resent_bulk', target_type: 'booking',
                  target_id: 'bk_1', meta_json: '{"to":"alice@example.com"}', created_at: 1200 },
            ],
        },
        'all',
    );
    return booking;
}

describe('GET /api/admin/bookings/:id (M4 B3a — detail view)', () => {
    it('returns booking + event + attendees + customer + activityLog (manager sees full PII)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/bk_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();

        expect(json.booking.id).toBe('bk_1');
        expect(json.booking.email).toBe('alice@example.com');
        expect(json.booking.phone).toBe('555-867-5309');
        expect(json.event.title).toBe('Op Nightfall');
        expect(Array.isArray(json.attendees)).toBe(true);
        expect(json.viewerCanSeePII).toBe(true);

        // Customer card surfaces LTV + counts + prior_booking_count
        expect(json.customer).not.toBeNull();
        expect(json.customer.id).toBe('cus_alice');
        expect(json.customer.lifetimeValueCents).toBe(80000);
        expect(json.customer.totalBookings).toBe(5);
        expect(json.customer.priorBookingCount).toBe(4); // total - 1
        expect(json.customer.archived).toBe(false);
        // Customer email also unmasked for capable caller
        expect(json.customer.email).toBe('alice@example.com');

        // Activity log slice (newest-first not enforced in mock; presence check)
        expect(json.activityLog).toHaveLength(2);
        expect(json.activityLog[0].action).toBe('booking.manual_cash');
        expect(json.activityLog[0].meta).toEqual({ event_id: 'ev_1' });
    });

    it('returns null customer when booking.customer_id is null (legacy row)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env, { customer_id: null });

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/bk_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.customer).toBeNull();
    });

    it('404 on missing booking', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/bk_missing', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(404);
    });

    it('staff role sees masked email + phone (no bookings.read.pii capability)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindBookingFixture(env);

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/bk_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();

        expect(json.viewerCanSeePII).toBe(false);
        expect(json.booking.email).toBe('a***@example.com');
        expect(json.booking.phone).toBe('(***) ***-5309');
        expect(json.customer.email).toBe('a***@example.com');
        expect(json.customer.phone).toBe('(***) ***-5309');
    });

    it('does NOT write customer_pii.unmasked audit row when caller is staff (PII not exposed)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindBookingFixture(env);

        await worker.fetch(
            buildReq('/api/admin/bookings/bk_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );

        const writes = env.DB.__writes();
        const piiAudit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /'customer_pii\.unmasked'/.test(w.sql)
        );
        expect(piiAudit).toBeUndefined();
    });

    it('writes customer_pii.unmasked audit row when manager exercises capability', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        await worker.fetch(
            buildReq('/api/admin/bookings/bk_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );

        const writes = env.DB.__writes();
        const piiAudit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /'customer_pii\.unmasked'/.test(w.sql)
        );
        expect(piiAudit).toBeDefined();
        // Binds: user_id, target_id (booking_id), meta_json, created_at
        expect(piiAudit.args[0]).toBe('u_actor');
        expect(piiAudit.args[1]).toBe('bk_1');
        expect(JSON.parse(piiAudit.args[2])).toEqual({ fields: ['email', 'phone'] });
    });

    it('activityLog query orders DESC and limits to 20', async () => {
        // Register the SQL-capturing handler BEFORE the fixture's handler so
        // it matches first (mockD1 returns the first non-undefined response).
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(
            /FROM audit_log\s+WHERE target_id = \? AND target_type = 'booking'/,
            (sql) => { capturedSql = sql; return { results: [] }; },
            'all',
        );

        bindBookingFixture(env);

        await worker.fetch(
            buildReq('/api/admin/bookings/bk_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(capturedSql).toMatch(/ORDER BY created_at DESC/);
        expect(capturedSql).toMatch(/LIMIT 20/);
    });

    it('exposes refund_external fields via formatBooking when present (M4 B3a)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env, {
            status: 'refunded', refunded_at: 1500,
            refund_external: 1, refund_external_method: 'venmo',
            refund_external_reference: 'V-12345', refund_requested_at: 1500,
        });

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/bk_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        const json = await res.json();
        expect(json.booking.refundExternal).toBe(true);
        expect(json.booking.refundExternalMethod).toBe('venmo');
        expect(json.booking.refundExternalReference).toBe('V-12345'); // includeInternal:true exposes reference
        expect(json.booking.refundedAt).toBe(1500);
        expect(json.booking.refundRequestedAt).toBe(1500);
    });

    it('401 when no session cookie', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(buildReq('/api/admin/bookings/bk_1'), env, {});
        expect(res.status).toBe(401);
    });
});
