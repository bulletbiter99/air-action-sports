// audit Group A #2 — fixed fee per booking
// audit Group A #4 — percent tax on subtotal-after-discount
//
// Locks the canonical math for the simplest tax+fee configuration:
//   percent_bps via Math.floor(subtotal * bps / 10000)
//   fixed_cents per_unit=booking applied verbatim
// Plus the rounding-direction guard (Math.floor, not Math.round).
//
// Source: worker/lib/pricing.js calculateQuote() taxes loop + fees loop.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — percent tax + fixed fee composition', () => {
    it('computes a 5% percent tax via floor(subtotal * bps / 10000)', () => {
        const taxesFees = [
            {
                id: 'tf_test_tax', category: 'tax',
                percent_bps: 500, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'Test Tax',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],  // 10000 subtotal
            addonSelections: [],
            taxesFees,
        });
        // floor(10000 * 500 / 10000) = 500
        expect(q.taxCents).toBe(500);
        expect(q.feeCents).toBe(0);
        expect(q.totalCents).toBe(10500);
    });

    it('adds a $0.30 fixed fee per booking regardless of attendee count', () => {
        const taxesFees = [
            {
                id: 'tf_processing', category: 'fee',
                percent_bps: 0, fixed_cents: 30, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 30, name: 'Processing Fee',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 3 }],  // 30000, 3 attendees
            addonSelections: [],
            taxesFees,
        });
        // per_unit='booking' → multiplier = 1, regardless of attendee count
        expect(q.feeCents).toBe(30);
        expect(q.totalCents).toBe(30030);
    });

    it('combines percent tax + fixed fee with fee base = afterDiscount + taxCents', () => {
        const taxesFees = [
            {
                id: 'tf_tax', category: 'tax',
                percent_bps: 500, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'Tax',
            },
            {
                id: 'tf_fee', category: 'fee',
                percent_bps: 0, fixed_cents: 30, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 30, name: 'Fee',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],  // 10000
            addonSelections: [],
            taxesFees,
        });
        // tax = floor(10000 * 500 / 10000) = 500
        // fee base for applies_to='all' is afterDiscount + taxCents = 10500
        // fee percent = 0; fixed = 30 → fee = 30
        // total = 10000 + 500 + 30 = 10530
        expect(q.taxCents).toBe(500);
        expect(q.feeCents).toBe(30);
        expect(q.totalCents).toBe(10530);
    });

    it('uses Math.floor (not Math.round) for percent computation', () => {
        // Subtotal 333 with 5% tax: 333 * 500 / 10000 = 16.65
        // Math.floor → 16 (Math.round would give 17)
        const taxesFees = [{
            id: 'tf', category: 'tax',
            percent_bps: 500, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
            active: 1, sort_order: 10, name: 'T',
        }];
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_x', name: 'X', priceCents: 333, minPerOrder: 1, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_x', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        expect(q.taxCents).toBe(16);
    });

    it('does NOT emit a tax line item when computed amt is 0', () => {
        // pricing.js line 130: `if (amt > 0) { lineItems.push(...) }` — zero
        // tax/fee rows are silently dropped from lineItems. Audit-derived
        // characterization of the silent-drop behavior.
        const taxesFees = [{
            id: 'tf', category: 'tax',
            percent_bps: 0, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
            active: 1, sort_order: 10, name: 'Zero',
        }];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        expect(q.taxCents).toBe(0);
        expect(q.lineItems.find(li => li.type === 'tax')).toBeUndefined();
    });
});
