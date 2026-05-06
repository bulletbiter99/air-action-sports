// audit Group A #3 — fixed_cents multiplied by attendee count when
// per_unit ∈ {'ticket', 'attendee'}; multiplier=1 otherwise.
//
// Implementation:
//   const unitMultiplier = (per_unit) =>
//     per_unit === 'ticket' || per_unit === 'attendee' ? totalAttendees : 1;
//
// 'ticket' and 'attendee' are equivalent under this rule (both multiply by
// totalAttendees). The distinction is preserved in the schema but the
// behavior is identical at quote time.
//
// Source: worker/lib/pricing.js calculateQuote() unitMultiplier (line 119).

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

const baseFee = (per_unit) => ({
    id: 'tf_fee', category: 'fee',
    percent_bps: 0, fixed_cents: 100, per_unit, applies_to: 'all',
    active: 1, sort_order: 30, name: `Fee per ${per_unit}`,
});

describe('calculateQuote — per_unit multiplier behavior', () => {
    it('per_unit=booking → fixed fee × 1 regardless of attendee count', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 5 }],  // 5 attendees
            addonSelections: [],
            taxesFees: [baseFee('booking')],
        });
        // fixed_cents=100, multiplier=1 → fee=100
        expect(q.feeCents).toBe(100);
    });

    it('per_unit=ticket → fixed fee × totalAttendees', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 5 }],
            addonSelections: [],
            taxesFees: [baseFee('ticket')],
        });
        // fixed_cents=100, multiplier=5 → fee=500
        expect(q.feeCents).toBe(500);
    });

    it('per_unit=attendee → fixed fee × totalAttendees (same as ticket)', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 5 }],
            addonSelections: [],
            taxesFees: [baseFee('attendee')],
        });
        // 'attendee' and 'ticket' both multiply by totalAttendees → fee=500
        expect(q.feeCents).toBe(500);
    });

    it('unrecognized per_unit value defaults to multiplier=1', () => {
        // ternary's else-branch: anything other than 'ticket'/'attendee' → 1.
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 5 }],
            addonSelections: [],
            taxesFees: [{
                id: 'tf', category: 'fee',
                percent_bps: 0, fixed_cents: 100, per_unit: 'unknown_value', applies_to: 'all',
                active: 1, sort_order: 30, name: 'Unknown',
            }],
        });
        expect(q.feeCents).toBe(100);
    });

    it('multiplier applies to fixed_cents only, not to percent_bps', () => {
        // percent_bps math is independent of multiplier — it's pure subtotal-based.
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 3 }],  // 30000 subtotal, 3 attendees
            addonSelections: [],
            taxesFees: [{
                id: 'tf', category: 'fee',
                percent_bps: 290, fixed_cents: 30, per_unit: 'attendee', applies_to: 'all',
                active: 1, sort_order: 30, name: 'Combined',
            }],
        });
        // percent on subtotal: floor(30000 * 290 / 10000) = 870
        // fixed × 3: 30 × 3 = 90
        // total fee: 960
        expect(q.feeCents).toBe(960);
    });

    it('also applies to taxes (not just fees)', () => {
        // unitMultiplier is shared between tax and fee loops in pricing.js.
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 4 }],
            addonSelections: [],
            taxesFees: [{
                id: 'tf', category: 'tax',
                percent_bps: 0, fixed_cents: 50, per_unit: 'ticket', applies_to: 'all',
                active: 1, sort_order: 10, name: 'Per-ticket tax',
            }],
        });
        // fixed × 4 attendees = 200
        expect(q.taxCents).toBe(200);
    });
});
