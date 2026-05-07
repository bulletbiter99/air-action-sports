// audit Group E #47 — POST /api/admin/bookings/manual with paymentMethod=cash
// creates a paid booking with no Stripe call.
//
// Source: worker/routes/admin/bookings.js, immediate-paid branch.
// status='paid', stripe_payment_intent='cash_<bookingId>', method='cash'.
// No Stripe API fetch should be issued for cash bookings.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import {
    createAdminBookingFixture,
    bindAdminBookingFixture,
    buildManualBody,
} from '../../helpers/adminBookingFixture.js';

describe('POST /api/admin/bookings/manual — cash branch (E47)', () => {
    it('creates a paid booking and issues no Stripe fetch', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture);

        const body = buildManualBody({ paymentMethod: 'cash' });
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
        expect(json.status).toBe('paid');
        expect(json.paymentMethod).toBe('cash');
        // Cash branch does NOT return paymentUrl/sessionId (those are card-only)
        expect(json.paymentUrl).toBeUndefined();
        expect(json.sessionId).toBeUndefined();

        // No Stripe fetches at all — cash never round-trips to Stripe
        const stripeCalls = (globalThis.fetch.mock?.calls || []).filter(
            ([url]) => typeof url === 'string' && url.startsWith('https://api.stripe.com'),
        );
        expect(stripeCalls).toHaveLength(0);

        const writes = env.DB.__writes();
        const bookingInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO bookings/.test(w.sql),
        );
        expect(bookingInsert).toBeTruthy();
        // Args layout (immediate-paid INSERT):
        //   0:id 1:event_id 2:full_name 3:email 4:phone 5:player_count
        //   6:line_items_json 7:subtotal_cents 8:tax_cents 9:fee_cents
        //   10:total_cents 11:status 12:notes 13:payment_method
        //   14:stripe_payment_intent 15:created_at 16:paid_at
        const args = bookingInsert.args;
        expect(args[11]).toBe('paid');
        expect(args[13]).toBe('cash');
        expect(args[14]).toMatch(/^cash_/);  // synthetic intent format

        // Audit row: 'booking.manual_cash'
        const auditWrite = writes.find(
            (w) => w.kind === 'run'
                && /INSERT INTO audit_log/.test(w.sql)
                && w.args[1] === 'booking.manual_cash',
        );
        expect(auditWrite).toBeTruthy();
        expect(auditWrite.args[0]).toBe('u_actor');
    });
});
