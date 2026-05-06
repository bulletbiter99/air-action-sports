// audit Group A #12 — when no taxes_fees are configured, total === subtotal.
// Plus baseline assertions on the ticket line-item shape (qty, unit_price_cents,
// line_total_cents) referenced in audit Group A #13.
//
// Source: worker/lib/pricing.js calculateQuote() ticket loop (lines 23-50).

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 8000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — single ticket, no addons, no taxes/fees', () => {
    it('totalCents equals ticket price for one ticket with no extras', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
        });

        expect(q.subtotalCents).toBe(8000);
        expect(q.discountCents).toBe(0);
        expect(q.taxCents).toBe(0);
        expect(q.feeCents).toBe(0);
        expect(q.totalCents).toBe(8000);
        expect(q.totalAttendees).toBe(1);
    });

    it('produces a single ticket line item with qty/unit_price_cents/line_total_cents', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
        });

        expect(q.lineItems).toHaveLength(1);
        expect(q.lineItems[0]).toMatchObject({
            type: 'ticket',
            ticket_type_id: 'tt_std',
            name: 'Standard',
            qty: 1,
            unit_price_cents: 8000,
            line_total_cents: 8000,
        });
    });

    it('reports no errors on a valid single-ticket selection', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
        });
        expect(q.errors).toHaveLength(0);
    });

    it('aggregates qty for a multi-quantity selection of one type', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 4 }],
            addonSelections: [],
        });
        expect(q.subtotalCents).toBe(32000);
        expect(q.totalCents).toBe(32000);
        expect(q.totalAttendees).toBe(4);
        expect(q.lineItems).toHaveLength(1);
        expect(q.lineItems[0].qty).toBe(4);
        expect(q.lineItems[0].line_total_cents).toBe(32000);
    });

    it('emits an error and skips the ticket for an unknown ticket_type_id', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_unknown', qty: 1 }],
            addonSelections: [],
        });
        expect(q.errors).toContain('Unknown ticket type: tt_unknown');
        // No line item created for the unknown selection
        expect(q.lineItems).toHaveLength(0);
        // No attendees counted from a skipped selection → empty cart short-circuit
        expect(q.totalAttendees).toBe(0);
        expect(q.totalCents).toBe(0);
    });
});
