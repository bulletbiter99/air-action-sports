// audit Group A #6 (split — see also applies-to-all.test.js)
// audit Group A #7 — promo distributes proportionally between tickets/addons
//                    in the tax-base computation (the most subtle behavior).
//
// Tax with applies_to='tickets' uses ticketsSubtotal as the base, BUT
// when a promo is applied the discount is distributed proportionally
// across tickets/addons before the per-scope base is computed.
//
// Source: worker/lib/pricing.js taxes loop, percentBase ternary at lines
// 124-127:
//   t.applies_to === 'tickets' ? Math.max(0, ticketsSubtotal -
//                                          discountCents *
//                                          (subtotalCents
//                                            ? ticketsSubtotal / subtotalCents
//                                            : 0))
// vs the same pattern for 'addons'.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = {
    id: 'ev_test',
    addons: [{ sku: 'rifle', name: 'Rifle', price_cents: 3500, type: 'rental', max_per_order: 10 }],
};
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — tax with applies_to=tickets', () => {
    it('base = ticketsSubtotal (excludes addons) with no promo', () => {
        const taxesFees = [
            {
                id: 'tf', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'tickets',
                active: 1, sort_order: 10, name: 'Ticket Tax',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],   // 10000
            addonSelections: [{ sku: 'rifle', qty: 1 }],               // 3500 → 13500 subtotal
            taxesFees,
        });
        // tax base = ticketsSubtotal = 10000 (NOT 13500)
        // tax = floor(10000 * 1000 / 10000) = 1000
        expect(q.subtotalCents).toBe(13500);
        expect(q.taxCents).toBe(1000);
        expect(q.totalCents).toBe(13500 + 1000);
    });

    it('base = addonsSubtotal when applies_to=addons (mirror of tickets case)', () => {
        const taxesFees = [
            {
                id: 'tf', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'addons',
                active: 1, sort_order: 10, name: 'Addon Tax',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 1 }],
            taxesFees,
        });
        // tax base = addonsSubtotal = 3500
        // tax = floor(3500 * 1000 / 10000) = 350
        expect(q.taxCents).toBe(350);
        expect(q.totalCents).toBe(13500 + 350);
    });

    it('with a promo, distributes discount proportionally across tickets/addons (audit A7)', () => {
        // ticketsSubtotal = 10000, addonsSubtotal = 3500, subtotal = 13500
        // promo: 1000 fixed → discountCents = 1000
        // proportional discount on tickets: 1000 * (10000/13500) ≈ 740.7407
        // tickets-base = max(0, 10000 - 740.7407) ≈ 9259.2593
        // tax = floor(9259.2593 * 1000 / 10000) = floor(925.9259) = 925
        const taxesFees = [
            {
                id: 'tf', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'tickets',
                active: 1, sort_order: 10, name: 'Ticket Tax',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 1 }],
            taxesFees,
            promo: { discountType: 'fixed', discountValue: 1000 },
        });
        expect(q.discountCents).toBe(1000);
        expect(q.taxCents).toBe(925);
    });

    it('discount distribution: max(0, ...) clamps when discount exceeds the scope', () => {
        // Edge: tickets are 1000, addons are 9000, subtotal 10000.
        // Promo: 9999 fixed → discountCents = 9999.
        // Proportional ticket discount: 9999 * (1000/10000) = 999.9
        // tickets-base = max(0, 1000 - 999.9) = 0.1 (still positive but ~0)
        // tax = floor(0.1 * 1000 / 10000) = floor(0.01) = 0
        const eventBig = {
            id: 'ev', addons: [{ sku: 'big', name: 'Big', price_cents: 9000, type: 'rental', max_per_order: 1 }],
        };
        const ttSmall = [{ id: 'tt_small', name: 'Small', priceCents: 1000, minPerOrder: 1, maxPerOrder: null, remaining: 1 }];
        const taxesFees = [
            {
                id: 'tf', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'tickets',
                active: 1, sort_order: 10, name: 'Ticket Tax',
            },
        ];
        const q = calculateQuote({
            event: eventBig,
            ticketTypes: ttSmall,
            ticketSelections: [{ ticketTypeId: 'tt_small', qty: 1 }],
            addonSelections: [{ sku: 'big', qty: 1 }],
            taxesFees,
            promo: { discountType: 'fixed', discountValue: 9999 },
        });
        expect(q.discountCents).toBe(9999);
        expect(q.taxCents).toBe(0);
    });
});
