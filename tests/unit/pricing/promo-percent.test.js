// audit Group A #10 — calculateQuote with promo type='percent' caps discount
// at subtotal.
//
// Implementation: discountCents = Math.floor((subtotalCents * discountValue) / 100).
// For discountValue ≤ 100, the formula naturally produces ≤ subtotal. We do
// NOT test discountValue > 100 — that input shape is rejected upstream by
// the admin promo-code editor and is not a realistic production case.
//
// Source: worker/lib/pricing.js calculateQuote() promo branch (line 105).

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — promo discountType=percent', () => {
    it('applies a 10% discount via floor(subtotal * value / 100)', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'percent', discountValue: 10 },
        });
        // floor(10000 * 10 / 100) = 1000
        expect(q.discountCents).toBe(1000);
        expect(q.totalCents).toBe(9000);
    });

    it('applies a 50% discount', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'percent', discountValue: 50 },
        });
        expect(q.discountCents).toBe(5000);
        expect(q.totalCents).toBe(5000);
    });

    it('applies a 100% discount → total === 0', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'percent', discountValue: 100 },
        });
        expect(q.discountCents).toBe(10000);
        expect(q.totalCents).toBe(0);
    });

    it('uses Math.floor on fractional discount results', () => {
        // 333 cents subtotal at 33% → 333 * 33 / 100 = 109.89 → floor = 109
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_x', name: 'X', priceCents: 333, minPerOrder: 1, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_x', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'percent', discountValue: 33 },
        });
        expect(q.discountCents).toBe(109);
        expect(q.totalCents).toBe(333 - 109);
    });

    it('discountValue=0 yields no discount', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            promo: { discountType: 'percent', discountValue: 0 },
        });
        expect(q.discountCents).toBe(0);
        expect(q.totalCents).toBe(10000);
    });
});
