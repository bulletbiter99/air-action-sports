// audit Group E #49 — POST /api/admin/bookings/manual with paymentMethod=card
// mints a Stripe Checkout Session and returns paymentUrl + sessionId.
//
// Source: worker/routes/admin/bookings.js, card branch (lines 244-316).
// Inserts a 'pending' booking, calls createCheckoutSession (which fetches
// POST /v1/checkout/sessions), updates the booking with the returned
// session.id, writes a 'booking.manual_card_pending' audit row.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';
import {
    createAdminBookingFixture,
    bindAdminBookingFixture,
    buildManualBody,
} from '../../helpers/adminBookingFixture.js';

describe('POST /api/admin/bookings/manual — card branch (E49)', () => {
    it('mints a Stripe Checkout Session and returns paymentUrl + sessionId', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture);

        mockStripeFetch({
            'POST /v1/checkout/sessions': {
                id: 'cs_mock_admin_123',
                url: 'https://checkout.stripe.com/c/cs_mock_admin_123',
                payment_intent: 'pi_mock_admin_123',
            },
        });

        const body = buildManualBody({ paymentMethod: 'card' });
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/bookings/manual', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }),
            env,
            {},
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('pending');
        expect(json.paymentMethod).toBe('card');
        expect(json.paymentUrl).toBe('https://checkout.stripe.com/c/cs_mock_admin_123');
        expect(json.sessionId).toBe('cs_mock_admin_123');

        // Exactly one Stripe call: POST /v1/checkout/sessions
        const stripeCalls = globalThis.fetch.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.startsWith('https://api.stripe.com'),
        );
        expect(stripeCalls).toHaveLength(1);
        expect(stripeCalls[0][0]).toBe('https://api.stripe.com/v1/checkout/sessions');
        expect(stripeCalls[0][1].method).toBe('POST');
        // Form-encoded body includes the source=admin_manual metadata flag
        expect(stripeCalls[0][1].body).toContain('metadata%5Bsource%5D=admin_manual');

        const writes = env.DB.__writes();
        const bookingInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO bookings/.test(w.sql),
        );
        expect(bookingInsert).toBeTruthy();
        // Card-branch INSERT bind layout (lines 256-269):
        //   0:id 1:event_id 2:full_name 3:email 4:phone 5:player_count
        //   6:line_items_json 7:subtotal_cents 8:tax_cents 9:fee_cents
        //   10:total_cents 11:notes 12:pending_attendees_json 13:created_at
        // (status='pending', payment_method='card', discount_cents=0 are SQL literals)
        // pending_attendees_json should carry the originally-submitted attendees
        const pendingAttendees = JSON.parse(bookingInsert.args[12]);
        expect(pendingAttendees).toHaveLength(1);
        expect(pendingAttendees[0].firstName).toBe('Alice');
        expect(pendingAttendees[0].ticketTypeId).toBe('tt_std');

        // Subsequent UPDATE bookings SET stripe_session_id = session.id WHERE id = ?
        const sessionUpdate = writes.find(
            (w) => w.kind === 'run' && /UPDATE bookings SET stripe_session_id/.test(w.sql),
        );
        expect(sessionUpdate).toBeTruthy();
        expect(sessionUpdate.args[0]).toBe('cs_mock_admin_123');

        // Audit action: 'booking.manual_card_pending'
        const auditWrite = writes.find(
            (w) => w.kind === 'run'
                && /INSERT INTO audit_log/.test(w.sql)
                && /'booking\.manual_card_pending'/.test(w.sql),
        );
        expect(auditWrite).toBeTruthy();
    });
});
