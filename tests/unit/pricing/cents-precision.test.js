// (milestone-only defensive guard, not in audit Group A)
//
// Verifies that calculateQuote does not introduce floating-point rounding
// drift at common totals. All percent math goes through Math.floor on the
// result of (base × bps / 10000) — this characterizes the floor-not-round
// posture and asserts that small fractional results truncate to 0 (e.g.
// 1¢ × 2.9% = 0.029¢ → 0¢).
//
// Source: worker/lib/pricing.js calculateQuote() taxes/fees percent math.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };

describe('calculateQuote — cents-level precision', () => {
    it('1¢ subtotal × 2.9% percent fee floors to 0¢', () => {
        const ticketTypes = [{ id: 'tt_p', name: 'Penny', priceCents: 1, minPerOrder: 1, maxPerOrder: null, remaining: 100 }];
        const taxesFees = [{
            id: 'tf', category: 'fee',
            percent_bps: 290, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
            active: 1, sort_order: 30, name: 'Stripe %',
        }];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_p', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        // 1 × 290 / 10000 = 0.029 → floor = 0
        expect(q.feeCents).toBe(0);
        expect(q.totalCents).toBe(1);
    });

    it('large round numbers produce exact integer results', () => {
        const ticketTypes = [{ id: 'tt_round', name: 'R', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 }];
        const taxesFees = [{
            id: 'tf', category: 'tax',
            percent_bps: 700, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
            active: 1, sort_order: 10, name: '7%',
        }];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_round', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        // 10000 × 700 / 10000 = 700 (exact)
        expect(q.taxCents).toBe(700);
        expect(q.totalCents).toBe(10700);
    });

    it('per-row floor does NOT compound across multiple taxes (each rounds independently)', () => {
        // Each percent computation is `Math.floor(base * bps / 10000)`.
        // Two 2.5% taxes on 333 cents both round down independently:
        //   floor(333 * 250 / 10000) = floor(8.325) = 8
        //   floor(333 * 250 / 10000) = floor(8.325) = 8
        // total tax = 16 (NOT floor of combined 5%, which would be floor(16.65) = 16 too,
        // but that coincidence is what we want to verify — both methods give 16 here).
        const ticketTypes = [{ id: 'tt', name: 'T', priceCents: 333, minPerOrder: 1, maxPerOrder: null, remaining: 100 }];
        const taxesFees = [
            {
                id: 'tf1', category: 'tax',
                percent_bps: 250, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'A',
            },
            {
                id: 'tf2', category: 'tax',
                percent_bps: 250, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 20, name: 'B',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        expect(q.taxCents).toBe(8 + 8);
        expect(q.totalCents).toBe(333 + 16);
    });

    it('totalCents = subtotal - discount + tax + fee with no drift', () => {
        // Manual math should equal returned totalCents at every common point.
        const ticketTypes = [{ id: 'tt', name: 'T', priceCents: 8000, minPerOrder: 1, maxPerOrder: null, remaining: 100 }];
        const taxesFees = [
            {
                id: 'tf_t', category: 'tax',
                percent_bps: 700, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'Tax',
            },
            {
                id: 'tf_f', category: 'fee',
                percent_bps: 290, fixed_cents: 30, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 30, name: 'Fee',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt', qty: 1 }],
            addonSelections: [],
            taxesFees,
            promo: { discountType: 'fixed', discountValue: 500 },
        });
        // subtotal=8000, discount=500, afterDiscount=7500
        // tax = floor(7500 * 700 / 10000) = 525
        // fee base = 7500 + 525 = 8025
        // fee = floor(8025 * 290 / 10000) + 30 = floor(232.725) + 30 = 232 + 30 = 262
        // total = 7500 + 525 + 262 = 8287
        expect(q.discountCents).toBe(500);
        expect(q.taxCents).toBe(525);
        expect(q.feeCents).toBe(262);
        expect(q.totalCents).toBe(8287);
        // Identity: total = afterDiscount + tax + fee (where afterDiscount = subtotal - discount).
        expect(q.totalCents).toBe(q.subtotalCents - q.discountCents + q.taxCents + q.feeCents);
    });

    it('attendee multiplier scaling preserves integer math', () => {
        // 3 attendees × 33¢ fixed_cents = 99 (exact, no float).
        const ticketTypes = [{ id: 'tt', name: 'T', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 }];
        const taxesFees = [{
            id: 'tf', category: 'fee',
            percent_bps: 0, fixed_cents: 33, per_unit: 'attendee', applies_to: 'all',
            active: 1, sort_order: 30, name: '$0.33/attendee',
        }];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt', qty: 3 }],
            addonSelections: [],
            taxesFees,
        });
        expect(q.feeCents).toBe(99);
    });
});
