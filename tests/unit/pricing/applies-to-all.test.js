// audit Group A #6 (split — see also applies-to-tickets.test.js)
//
// Tax with applies_to='all' (the default) uses afterDiscount as the base
// (subtotal minus discount, before tax/fee). This is the simpler branch —
// no proportional distribution.
//
// Source: worker/lib/pricing.js taxes loop, line 127:
//   else /* applies_to === 'all' or unset */ : afterDiscount

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = {
    id: 'ev_test',
    addons: [{ sku: 'rifle', name: 'Rifle', price_cents: 3500, type: 'rental', max_per_order: 10 }],
};
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — tax with applies_to=all', () => {
    it('base = full subtotal (tickets + addons) when no promo', () => {
        const taxesFees = [
            {
                id: 'tf', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'All Tax',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],   // 10000
            addonSelections: [{ sku: 'rifle', qty: 1 }],               // 3500
            taxesFees,
        });
        // base = subtotal - 0 discount = 13500
        // tax = floor(13500 * 1000 / 10000) = 1350
        expect(q.taxCents).toBe(1350);
        expect(q.totalCents).toBe(13500 + 1350);
    });

    it('base = afterDiscount when promo applied', () => {
        const taxesFees = [
            {
                id: 'tf', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'All Tax',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 1 }],
            taxesFees,
            promo: { discountType: 'fixed', discountValue: 500 },
        });
        // afterDiscount = 13500 - 500 = 13000
        // tax = floor(13000 * 1000 / 10000) = 1300
        expect(q.discountCents).toBe(500);
        expect(q.taxCents).toBe(1300);
    });

    it('treats unspecified applies_to (the audit-default field) as "all"', () => {
        // Per pricing.js the ternary's else-branch fires for any value other
        // than 'tickets' or 'addons' — including null, undefined, or an
        // unrecognized string. Locks this fall-through.
        const taxesFees = [
            {
                id: 'tf', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking',
                /* applies_to omitted */
                active: 1, sort_order: 10, name: 'Unspecified Scope',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 1 }],
            taxesFees,
        });
        expect(q.taxCents).toBe(1350);  // same as applies_to='all'
    });

    it('multiple taxes with applies_to=all both compute on afterDiscount', () => {
        const taxesFees = [
            {
                id: 'tf_city', category: 'tax',
                percent_bps: 200, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'City Tax',
            },
            {
                id: 'tf_state', category: 'tax',
                percent_bps: 800, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 20, name: 'State Tax',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],   // 10000
            addonSelections: [{ sku: 'rifle', qty: 1 }],               // 3500
            taxesFees,
        });
        // both compute on subtotal 13500
        // city = floor(13500 * 200 / 10000) = 270
        // state = floor(13500 * 800 / 10000) = 1080
        // total tax = 1350
        expect(q.taxCents).toBe(270 + 1080);
    });
});
