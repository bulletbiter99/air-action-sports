// audit Group A #8 — calculateQuote rejects ticket selection that exceeds
// remaining capacity (errors[] populated).
//
// Implementation:
//   if (tt.remaining != null && sel.qty > tt.remaining)
//     errors.push(`${tt.name}: only ${tt.remaining} remaining`);
//
// The check is `!= null` so capacity is enforced when the ticket type
// carries an explicit remaining number. Ticket types with `remaining: null`
// bypass the check (uncapped). The line item is STILL pushed even when
// capacity is exceeded — errors[] is the signal, not a hard reject. The
// caller (POST /api/bookings/quote) returns HTTP 400 when errors.length > 0.
//
// Source: worker/lib/pricing.js calculateQuote() ticket loop (line 37).

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };

describe('calculateQuote — ticket capacity errors', () => {
    it('emits an error when qty exceeds remaining', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 5 }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 10 }],
            addonSelections: [],
        });
        expect(q.errors).toContain('Standard: only 5 remaining');
    });

    it('does not emit an error when qty equals remaining (exact)', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 5 }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 5 }],
            addonSelections: [],
        });
        expect(q.errors).toHaveLength(0);
    });

    it('does not emit an error when qty < remaining', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 3 }],
            addonSelections: [],
        });
        expect(q.errors).toHaveLength(0);
    });

    it('does not enforce capacity when remaining is null (uncapped)', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: null }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 999 }],
            addonSelections: [],
        });
        expect(q.errors).toHaveLength(0);
        expect(q.subtotalCents).toBe(9990000);
    });

    it('emits an error when qty=1 against remaining=0 (sold out)', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 0 }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
        });
        expect(q.errors).toContain('Standard: only 0 remaining');
    });

    it('still pushes the line item even when capacity exceeded (caller decides)', () => {
        // Confirms capacity is a SOFT block — line item present, math computed,
        // but errors[] is non-empty so the public quote endpoint returns 400.
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 5 }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 10 }],
            addonSelections: [],
        });
        expect(q.lineItems).toHaveLength(1);
        expect(q.lineItems[0].qty).toBe(10);
        expect(q.subtotalCents).toBe(100000);
        expect(q.errors.length).toBeGreaterThan(0);
    });
});
