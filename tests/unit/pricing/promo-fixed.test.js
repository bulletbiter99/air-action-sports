// audit Group A #11 — calculateQuote with promo type='fixed' caps discount
// at subtotal.
//
// Implementation: discountCents = Math.min(promo.discountValue, subtotalCents).
// Explicit cap — over-large discountValue is clamped to subtotal.
//
// Source: worker/lib/pricing.js calculateQuote() promo branch (line 107).

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — promo discountType=fixed', () => {
    it('subtracts a fixed amount when discountValue < subtotal', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'fixed', discountValue: 500 },
        });
        expect(q.discountCents).toBe(500);
        expect(q.totalCents).toBe(9500);
    });

    it('applies the full discount when discountValue === subtotal', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'fixed', discountValue: 10000 },
        });
        expect(q.discountCents).toBe(10000);
        expect(q.totalCents).toBe(0);
    });

    it('caps discount at subtotal when discountValue > subtotal', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'fixed', discountValue: 99999 },
        });
        // Math.min(99999, 10000) = 10000 — the cap.
        expect(q.discountCents).toBe(10000);
        expect(q.totalCents).toBe(0);
    });

    it('discountValue=0 yields no discount', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'fixed', discountValue: 0 },
        });
        expect(q.discountCents).toBe(0);
        expect(q.totalCents).toBe(10000);
    });

    it('null promo yields no discount', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: null,
        });
        expect(q.discountCents).toBe(0);
        expect(q.totalCents).toBe(10000);
    });

    it('omitted promo argument defaults to null (no discount)', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            // promo omitted entirely — default param = null per pricing.js signature
        });
        expect(q.discountCents).toBe(0);
        expect(q.totalCents).toBe(10000);
    });
});
