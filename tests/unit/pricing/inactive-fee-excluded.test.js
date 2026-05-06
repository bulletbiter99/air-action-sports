// (milestone-only behavior, not in audit Group A)
//
// taxes_fees rows with active=0 are filtered out of activeTaxes/activeFees
// before the loops run. Inactive entries produce no line item, no taxCents
// contribution, no feeCents contribution — same as if they didn't exist.
//
// This is a configuration-management guarantee: admins can pre-stage
// alternate tax/fee rows and toggle them on/off without removing rows.
//
// Source: worker/lib/pricing.js calculateQuote() taxesFees filter
//         (lines 114-117): `taxesFees.filter((tf) => tf.active && ...)`

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 10000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — inactive taxes/fees excluded', () => {
    it('inactive fee (active=0) is not applied and not in lineItems', () => {
        const taxesFees = [{
            id: 'tf', category: 'fee',
            percent_bps: 290, fixed_cents: 30, per_unit: 'booking', applies_to: 'all',
            active: 0,
            sort_order: 30, name: 'Disabled Fee',
        }];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        expect(q.feeCents).toBe(0);
        expect(q.lineItems.find(li => li.type === 'fee')).toBeUndefined();
    });

    it('inactive tax (active=0) is not applied and not in lineItems', () => {
        const taxesFees = [{
            id: 'tf', category: 'tax',
            percent_bps: 800, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
            active: 0,
            sort_order: 10, name: 'Disabled Tax',
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

    it('mixed active + inactive: only active rows apply', () => {
        const taxesFees = [
            {
                id: 'tf_on', category: 'tax',
                percent_bps: 500, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 1, sort_order: 10, name: 'Active Tax',
            },
            {
                id: 'tf_off', category: 'tax',
                percent_bps: 200, fixed_cents: 0, per_unit: 'booking', applies_to: 'all',
                active: 0, sort_order: 20, name: 'Inactive Tax',
            },
            {
                id: 'tf_fee_off', category: 'fee',
                percent_bps: 290, fixed_cents: 30, per_unit: 'booking', applies_to: 'all',
                active: 0, sort_order: 30, name: 'Inactive Fee',
            },
        ];
        const q = calculateQuote({
            event, ticketTypes,
            ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
            addonSelections: [],
            taxesFees,
        });
        expect(q.taxCents).toBe(500);          // only active tax
        expect(q.feeCents).toBe(0);             // fee is inactive
        expect(q.lineItems).toHaveLength(2);    // 1 ticket + 1 active tax
    });

    it('falsy active values (0, null, undefined, false) all suppress the row', () => {
        // pricing.js uses truthy check: `tf.active && tf.category === 'tax'`.
        // Any falsy value for `active` filters the row out.
        for (const falsy of [0, null, undefined, false]) {
            const taxesFees = [{
                id: 'tf', category: 'fee',
                percent_bps: 0, fixed_cents: 100, per_unit: 'booking', applies_to: 'all',
                active: falsy, sort_order: 30, name: 'Falsy',
            }];
            const q = calculateQuote({
                event, ticketTypes,
                ticketSelections: [{ ticketTypeId: 'tt_std', qty: 1 }],
                addonSelections: [],
                taxesFees,
            });
            expect(q.feeCents).toBe(0);
        }
    });
});
