// audit Group E #48 — POST /api/admin/bookings/manual with paymentMethod=comp
// creates a status='comp' booking with no charge.
//
// Source: worker/routes/admin/bookings.js, immediate-paid branch + comp price
// override (lines 154, 173). Comp bookings have unit_price_cents=0 for every
// line item, $0 subtotal/tax/fee/total, and stripe_payment_intent=NULL (no
// synthetic intent — they're free, not paid out-of-band).

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import {
    createAdminBookingFixture,
    bindAdminBookingFixture,
    buildManualBody,
} from '../../helpers/adminBookingFixture.js';

describe('POST /api/admin/bookings/manual — comp branch (E48)', () => {
    it("creates a status='comp' booking with $0 totals and no Stripe fetch", async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture);

        const body = buildManualBody({ paymentMethod: 'comp' });
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
        expect(json.status).toBe('comp');
        expect(json.paymentMethod).toBe('comp');
        expect(json.totalCents).toBe(0);

        const stripeCalls = (globalThis.fetch.mock?.calls || []).filter(
            ([url]) => typeof url === 'string' && url.startsWith('https://api.stripe.com'),
        );
        expect(stripeCalls).toHaveLength(0);

        const writes = env.DB.__writes();
        const bookingInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO bookings/.test(w.sql),
        );
        expect(bookingInsert).toBeTruthy();
        const args = bookingInsert.args;
        // Comp skips taxes_fees entirely — subtotal/tax/fee/total all 0
        expect(args[7]).toBe(0);   // subtotal_cents
        expect(args[8]).toBe(0);   // tax_cents
        expect(args[9]).toBe(0);   // fee_cents
        expect(args[10]).toBe(0);  // total_cents
        expect(args[11]).toBe('comp');
        expect(args[13]).toBe('comp');
        expect(args[14]).toBeNull();  // stripe_payment_intent NULL for comp

        // Line items: unit_price_cents=0, name appended " (comp)"
        const lineItems = JSON.parse(args[6]);
        expect(lineItems).toHaveLength(1);
        expect(lineItems[0].unit_price_cents).toBe(0);
        expect(lineItems[0].line_total_cents).toBe(0);
        expect(lineItems[0].name).toMatch(/\(comp\)$/);

        // Audit action is 'booking.manual_comp' (not 'booking.manual_card_pending')
        const auditWrite = writes.find(
            (w) => w.kind === 'run'
                && /INSERT INTO audit_log/.test(w.sql)
                && w.args[1] === 'booking.manual_comp',
        );
        expect(auditWrite).toBeTruthy();
    });
});
