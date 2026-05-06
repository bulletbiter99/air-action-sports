// audit Group A #13 — tax + fee rows in lineItems must NOT carry
// qty/unit_price_cents. Guards the Stripe Checkout shaping fix from
// HANDOFF commit 5e7d833 where Stripe received `quantity=undefined&
// unit_amount=undefined` for tax/fee rows passed straight through.
//
// Stripe Checkout's caller (worker/routes/bookings.js) filters
// `quote.lineItems.filter(li => li.type === 'ticket' || li.type === 'addon')`
// before passing to createCheckoutSession. The filter relies on the type
// field; this test locks the underlying lineItem shape so a future caller
// can rely on it too.
//
// Also locks the iteration order: tickets → addons → taxes → fees.
//
// Source: worker/lib/pricing.js, lineItems.push calls in 4 distinct loops.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = {
    id: 'ev_test',
    addons: [{ sku: 'rifle', name: 'Rifle', price_cents: 3500, type: 'rental', max_per_order: 10 }],
};
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];
const taxesFees = [
    {
        id: 'tf_tax', category: 'tax',
        percent_bps: 500, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
        active: 1, sort_order: 10, name: 'Sales Tax',
    },
    {
        id: 'tf_fee', category: 'fee',
        percent_bps: 290, fixed_cents: 30, per_unit: 'booking', applies_to: 'all',
        active: 1, sort_order: 30, name: 'Processing Fees',
    },
];

describe('calculateQuote — lineItems shape per row type', () => {
    it('ticket line items have qty + unit_price_cents + line_total_cents', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 2 }],
            addonSelections: [],
        });
        const ticketLine = q.lineItems.find(li => li.type === 'ticket');
        expect(ticketLine).toBeDefined();
        expect(ticketLine).toHaveProperty('qty', 2);
        expect(ticketLine).toHaveProperty('unit_price_cents', 10000);
        expect(ticketLine).toHaveProperty('line_total_cents', 20000);
        expect(ticketLine).toHaveProperty('ticket_type_id', 'tt_std');
        expect(ticketLine).toHaveProperty('name', 'Standard');
    });

    it('addon line items have qty + unit_price_cents + line_total_cents', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 2 }],
        });
        const addonLine = q.lineItems.find(li => li.type === 'addon');
        expect(addonLine).toBeDefined();
        expect(addonLine).toHaveProperty('qty', 2);
        expect(addonLine).toHaveProperty('unit_price_cents', 3500);
        expect(addonLine).toHaveProperty('line_total_cents', 7000);
        expect(addonLine).toHaveProperty('sku', 'rifle');
        expect(addonLine).toHaveProperty('addon_type', 'rental');
    });

    it('tax line items have line_total_cents but NOT qty or unit_price_cents', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        const taxLine = q.lineItems.find(li => li.type === 'tax');
        expect(taxLine).toBeDefined();
        expect(taxLine).toHaveProperty('line_total_cents');
        expect(taxLine).not.toHaveProperty('qty');
        expect(taxLine).not.toHaveProperty('unit_price_cents');
        // tax-specific metadata IS present
        expect(taxLine).toHaveProperty('tax_fee_id', 'tf_tax');
        expect(taxLine).toHaveProperty('percent_bps', 500);
        expect(taxLine).toHaveProperty('fixed_cents', 0);
        expect(taxLine).toHaveProperty('name', 'Sales Tax');
    });

    it('fee line items have line_total_cents but NOT qty or unit_price_cents', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        const feeLine = q.lineItems.find(li => li.type === 'fee');
        expect(feeLine).toBeDefined();
        expect(feeLine).toHaveProperty('line_total_cents');
        expect(feeLine).not.toHaveProperty('qty');
        expect(feeLine).not.toHaveProperty('unit_price_cents');
        expect(feeLine).toHaveProperty('tax_fee_id', 'tf_fee');
        expect(feeLine).toHaveProperty('percent_bps', 290);
        expect(feeLine).toHaveProperty('fixed_cents', 30);
        expect(feeLine).toHaveProperty('name', 'Processing Fees');
    });

    it('lineItems are emitted in order: ticket → addon → tax → fee', () => {
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 1 }],
            taxesFees,
        });
        const types = q.lineItems.map(li => li.type);
        // pricing.js iterates: ticketSelections → addonSelections → activeTaxes → activeFees
        expect(types).toEqual(['ticket', 'addon', 'tax', 'fee']);
    });

    it('a Stripe-Checkout-style filter on type==="ticket"||"addon" leaves only fully-shaped rows', () => {
        // Mirrors the production filter at worker/routes/bookings.js:
        //   line_items: quote.lineItems.filter(li => li.type === 'ticket' || li.type === 'addon')
        // Every surviving row must have qty + unit_price_cents (Stripe required).
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 1 }],
            taxesFees,
        });
        const stripeReady = q.lineItems.filter(li => li.type === 'ticket' || li.type === 'addon');
        expect(stripeReady).toHaveLength(2);
        for (const li of stripeReady) {
            expect(typeof li.qty).toBe('number');
            expect(typeof li.unit_price_cents).toBe('number');
            expect(typeof li.line_total_cents).toBe('number');
            expect(li.qty).toBeGreaterThan(0);
            expect(li.unit_price_cents).toBeGreaterThan(0);
        }
    });
});
