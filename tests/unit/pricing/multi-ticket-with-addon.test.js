// Basic aggregation: ticketsSubtotal + addonsSubtotal = subtotalCents,
// totalAttendees = sum of ticket qty (addons don't count). Locks the
// pricing.js ticket-then-addon iteration order and the addon line-item
// shape (sku, addon_type, qty, unit_price_cents, line_total_cents).
//
// Source: worker/lib/pricing.js calculateQuote() ticket loop + addon loop.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = {
    id: 'ev_test',
    addons: [
        { sku: 'rifle_rental', name: 'Sword Rifle Package', price_cents: 3500, type: 'rental', max_per_order: 10 },
        { sku: 'bbs_10k', name: '20g BBs 10k', price_cents: 3000, type: 'consumable', max_per_order: 20 },
    ],
};
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 8000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
    { id: 'tt_vip', name: 'VIP', priceCents: 15000, minPerOrder: 1, maxPerOrder: 5, remaining: 5 },
];

describe('calculateQuote — multiple ticket types + addons', () => {
    it('aggregates subtotal across ticket types', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [
                { ticketTypeId: 'tt_std', qty: 3 },  // 3 × 8000 = 24000
                { ticketTypeId: 'tt_vip', qty: 1 },  // 1 × 15000 = 15000
            ],
            addonSelections: [],
        });
        expect(q.subtotalCents).toBe(39000);
        expect(q.totalAttendees).toBe(4);
    });

    it('aggregates subtotal across ticket types + addons', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [
                { ticketTypeId: 'tt_std', qty: 2 },   // 16000
                { ticketTypeId: 'tt_vip', qty: 1 },   // 15000
            ],
            addonSelections: [
                { sku: 'rifle_rental', qty: 2 },      // 7000
                { sku: 'bbs_10k', qty: 3 },           // 9000
            ],
        });
        expect(q.subtotalCents).toBe(16000 + 15000 + 7000 + 9000);
        // Addons do NOT increase totalAttendees — only ticket qty does.
        expect(q.totalAttendees).toBe(3);
    });

    it('produces ticket line items first, then addon line items', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [
                { ticketTypeId: 'tt_std', qty: 1 },
                { ticketTypeId: 'tt_vip', qty: 1 },
            ],
            addonSelections: [
                { sku: 'rifle_rental', qty: 1 },
            ],
        });
        expect(q.lineItems).toHaveLength(3);
        expect(q.lineItems[0].type).toBe('ticket');
        expect(q.lineItems[1].type).toBe('ticket');
        expect(q.lineItems[2].type).toBe('addon');
    });

    it('addon line items carry sku + addon_type + qty + unit_price_cents + line_total_cents', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'rifle_rental', qty: 1 }],
        });
        const addonLine = q.lineItems.find(li => li.type === 'addon');
        expect(addonLine).toMatchObject({
            sku: 'rifle_rental',
            name: 'Sword Rifle Package',
            addon_type: 'rental',
            qty: 1,
            unit_price_cents: 3500,
            line_total_cents: 3500,
        });
    });

    it('skips selections with qty <= 0 silently (no line item, no error)', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [
                { ticketTypeId: 'tt_std', qty: 1 },
                { ticketTypeId: 'tt_vip', qty: 0 },
            ],
            addonSelections: [
                { sku: 'rifle_rental', qty: 0 },
            ],
        });
        expect(q.lineItems).toHaveLength(1);
        expect(q.errors).toHaveLength(0);
        expect(q.totalAttendees).toBe(1);
    });

    it('emits an error for unknown addon sku and skips that line', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'sku_does_not_exist', qty: 1 }],
        });
        expect(q.errors).toContain('Unknown add-on: sku_does_not_exist');
        expect(q.lineItems.filter(li => li.type === 'addon')).toHaveLength(0);
    });

    it('uses addon.type=consumable as default when type is missing', () => {
        const eventNoType = {
            id: 'ev',
            addons: [{ sku: 'no_type', name: 'No Type', price_cents: 100, max_per_order: 1 }],
        };
        const q = calculateQuote({
            event: eventNoType,
            ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [{ sku: 'no_type', qty: 1 }],
        });
        const addonLine = q.lineItems.find(li => li.type === 'addon');
        expect(addonLine.addon_type).toBe('consumable');
    });
});
