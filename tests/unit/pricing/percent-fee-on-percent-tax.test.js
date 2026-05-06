// audit Group A #5 — fees with applies_to='all' compute on (afterDiscount +
// taxCents), i.e. fee base INCLUDES tax. Guards the public/admin-parity bug
// fixed in HANDOFF commit 2dd831f where admin manual booking computed fee
// against subtotal-only, mismatching the customer flow.
//
// Also locks the asymmetry: fee.applies_to='tickets' or 'addons' uses the
// RAW ticketsSubtotal/addonsSubtotal (no discount, no tax) — only fee
// applies_to='all' includes tax in the base. Different from tax behavior
// (where applies_to='tickets' subtracts discount proportionally).
//
// Source: worker/lib/pricing.js fees loop, percentBase computation.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — fee base includes tax (applies_to=all)', () => {
    it('fee percent base = afterDiscount + taxCents when applies_to=all', () => {
        const taxesFees = [
            {
                id: 'tf_tax', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'Tax 10%',
            },
            {
                id: 'tf_fee', category: 'fee',
                percent_bps: 290, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 30, name: 'Stripe 2.9%',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],  // 10000
            addonSelections: [],
            taxesFees,
        });
        // tax = floor(10000 * 1000 / 10000) = 1000
        // fee base = afterDiscount + taxCents = 10000 + 1000 = 11000
        // fee = floor(11000 * 290 / 10000) = floor(319) = 319
        expect(q.taxCents).toBe(1000);
        expect(q.feeCents).toBe(319);
        expect(q.totalCents).toBe(11319);
    });

    it('fee with applies_to=tickets uses RAW ticketsSubtotal (no tax included, no discount)', () => {
        const taxesFees = [
            {
                id: 'tf_tax', category: 'tax',
                percent_bps: 1000, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'Tax 10%',
            },
            {
                id: 'tf_fee', category: 'fee',
                percent_bps: 290, fixed_cents: 0, per_unit: 'booking', applies_to: 'tickets',
                active: 1, sort_order: 30, name: 'Stripe 2.9% on tickets only',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],  // 10000
            addonSelections: [],
            taxesFees,
        });
        // tax = 1000
        // fee base = ticketsSubtotal = 10000 (NOT 11000, NOT discount-adjusted)
        // fee = floor(10000 * 290 / 10000) = 290
        expect(q.taxCents).toBe(1000);
        expect(q.feeCents).toBe(290);
        expect(q.totalCents).toBe(11290);
    });

    it('fee with applies_to=tickets does NOT subtract discount (asymmetry vs tax)', () => {
        // Documents the pricing.js asymmetry: tax.applies_to='tickets' subtracts
        // proportional discount; fee.applies_to='tickets' does not.
        const taxesFees = [
            {
                id: 'tf_fee', category: 'fee',
                percent_bps: 290, fixed_cents: 0, per_unit: 'booking', applies_to: 'tickets',
                active: 1, sort_order: 30, name: 'Stripe %',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],  // 10000
            addonSelections: [],
            taxesFees,
            promo: { discountType: 'fixed', discountValue: 1000 },
        });
        // fee base = ticketsSubtotal = 10000 (raw, no discount adjustment)
        // fee = floor(10000 * 290 / 10000) = 290
        expect(q.discountCents).toBe(1000);
        expect(q.feeCents).toBe(290);
    });
});
