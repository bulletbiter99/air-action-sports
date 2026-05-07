// audit Group E #50 — POST /api/admin/bookings/manual computes tax + fee
// identically to /api/bookings/quote for the same cart. Public/admin parity
// guard, locking the fix from HANDOFF commit 2dd831f (admin previously
// computed fee against subtotal only, while public computes fee against
// subtotal+tax).
//
// Approach: call calculateQuote() directly and POST /manual with the same
// inputs (same event, ticket types, taxes/fees, attendee count). Read the
// admin booking INSERT's tax_cents/fee_cents binds and assert equality.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import {
    createAdminBookingFixture,
    bindAdminBookingFixture,
    buildManualBody,
} from '../../helpers/adminBookingFixture.js';
import { calculateQuote } from '../../../worker/lib/pricing.js';

describe('POST /api/admin/bookings/manual — pricing parity with public quote (E50)', () => {
    it('produces tax_cents and fee_cents identical to calculateQuote for the same cart', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture);

        // Cart: 2 standard tickets ($80 each = $160 subtotal)
        // Default fixture taxes/fees:
        //   City Tax       1%   on subtotal       → 160
        //   State Tax      2%   on subtotal       → 320
        //   Processing     2.9% on subtotal+tax + 30¢ fixed
        const ATTENDEE_QTY = 2;

        // Public-side reference: calculateQuote() with identical inputs.
        const publicQuote = calculateQuote({
            event: { addons: fixture.addons },
            ticketTypes: [
                {
                    id: 'tt_std',
                    name: 'Standard Ticket',
                    priceCents: 8000,
                    minPerOrder: 0,
                    maxPerOrder: null,
                    remaining: null,
                },
            ],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: ATTENDEE_QTY }],
            addonSelections: [],
            taxesFees: fixture.taxesFees,
        });
        expect(publicQuote.errors).toEqual([]);

        // Admin-side: POST /manual with the same cart (paymentMethod=cash so
        // we go through the immediate-paid branch and tax/fee are computed).
        const body = buildManualBody({
            paymentMethod: 'cash',
            attendees: Array.from({ length: ATTENDEE_QTY }, (_, i) => ({
                firstName: `Player${i + 1}`,
                lastName: 'Test',
                email: `p${i + 1}@example.com`,
                ticketTypeId: 'tt_std',
            })),
        });
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

        const writes = env.DB.__writes();
        const bookingInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO bookings/.test(w.sql),
        );
        expect(bookingInsert).toBeTruthy();
        // Immediate-paid INSERT bind layout:
        //   7:subtotal_cents 8:tax_cents 9:fee_cents 10:total_cents
        const adminSubtotal = bookingInsert.args[7];
        const adminTax = bookingInsert.args[8];
        const adminFee = bookingInsert.args[9];
        const adminTotal = bookingInsert.args[10];

        expect(adminSubtotal).toBe(publicQuote.subtotalCents);
        expect(adminTax).toBe(publicQuote.taxCents);
        expect(adminFee).toBe(publicQuote.feeCents);
        expect(adminTotal).toBe(publicQuote.totalCents);

        // Sanity: assert the actual values are non-trivial (the test would
        // pass spuriously if both sides returned 0).
        expect(adminSubtotal).toBe(16000);  // 2 × $80
        expect(adminTax).toBeGreaterThan(0);
        expect(adminFee).toBeGreaterThan(0);
    });
});
