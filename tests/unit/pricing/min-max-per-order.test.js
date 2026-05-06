// audit Group A #9 — calculateQuote rejects ticket qty < minPerOrder
// or > maxPerOrder (errors[] populated, separate error per case).
//
// Plus implicit addon behavior: addon.max_per_order similarly enforced
// in the addon loop.
//
// Implementation:
//   if (tt.minPerOrder && sel.qty < tt.minPerOrder)
//     errors.push(`${tt.name}: minimum ${tt.minPerOrder} per order`);
//   if (tt.maxPerOrder && sel.qty > tt.maxPerOrder)
//     errors.push(`${tt.name}: maximum ${tt.maxPerOrder} per order`);
// (addon analogous, on `addon.max_per_order`)
//
// Note the `tt.minPerOrder &&` short-circuit: minPerOrder=0 or null
// bypasses the check entirely. Same for maxPerOrder.
//
// Source: worker/lib/pricing.js calculateQuote() ticket loop (lines 31-36)
//         + addon loop (lines 65-66).

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = {
    id: 'ev_test',
    addons: [{ sku: 'rifle', name: 'Rifle', price_cents: 3500, type: 'rental', max_per_order: 5 }],
};

describe('calculateQuote — minPerOrder / maxPerOrder errors', () => {
    it('emits a min error when ticket qty < minPerOrder', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_team', name: 'Team', priceCents: 10000, minPerOrder: 4, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_team', qty: 2 }],
            addonSelections: [],
        });
        expect(q.errors).toContain('Team: minimum 4 per order');
    });

    it('emits a max error when ticket qty > maxPerOrder', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_vip', name: 'VIP', priceCents: 15000, minPerOrder: 1, maxPerOrder: 3, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_vip', qty: 5 }],
            addonSelections: [],
        });
        expect(q.errors).toContain('VIP: maximum 3 per order');
    });

    it('does not emit min error at exactly minPerOrder', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_team', name: 'Team', priceCents: 10000, minPerOrder: 4, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_team', qty: 4 }],
            addonSelections: [],
        });
        expect(q.errors).toHaveLength(0);
    });

    it('does not emit max error at exactly maxPerOrder', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_vip', name: 'VIP', priceCents: 15000, minPerOrder: 1, maxPerOrder: 3, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_vip', qty: 3 }],
            addonSelections: [],
        });
        expect(q.errors).toHaveLength(0);
    });

    it('null minPerOrder bypasses the min check', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_x', name: 'X', priceCents: 10000, minPerOrder: null, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_x', qty: 1 }],
            addonSelections: [],
        });
        expect(q.errors).toHaveLength(0);
    });

    it('emits multiple errors at once when both min and max would trigger across types', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [
                { id: 'tt_team', name: 'Team', priceCents: 10000, minPerOrder: 4, maxPerOrder: null, remaining: 100 },
                { id: 'tt_vip', name: 'VIP', priceCents: 15000, minPerOrder: 1, maxPerOrder: 3, remaining: 100 },
            ],
            ticketSelections: [
                { ticketTypeId: 'tt_team', qty: 2 },  // min violation
                { ticketTypeId: 'tt_vip', qty: 5 },   // max violation
            ],
            addonSelections: [],
        });
        expect(q.errors).toContain('Team: minimum 4 per order');
        expect(q.errors).toContain('VIP: maximum 3 per order');
    });

    it('emits an addon max-per-order error', () => {
        const q = calculateQuote({
            event,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle', qty: 10 }],  // addon.max_per_order = 5
        });
        expect(q.errors).toContain('Rifle: max 5 per order');
    });

    it('addon with max_per_order=null is uncapped', () => {
        const eventNoCap = {
            id: 'ev',
            addons: [{ sku: 'unl', name: 'Unlimited', price_cents: 100, type: 'consumable', max_per_order: null }],
        };
        const q = calculateQuote({
            event: eventNoCap,
            ticketTypes: [{ id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 }],
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'unl', qty: 999 }],
        });
        expect(q.errors).toHaveLength(0);
    });
});
