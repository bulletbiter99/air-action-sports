// audit Group A #1 — empty-cart short-circuit must produce all-zero totals
// even when fixed-fee processing fees are configured. Guards the bug fixed
// in HANDOFF commit 5555426 where a $0.30 fixed fee leaked into totals
// when subtotal was 0 (per_unit=booking → multiplier=1 even with 0 attendees).
//
// Source: worker/lib/pricing.js calculateQuote() lines 88-100.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../../worker/lib/pricing.js';

const event = { id: 'ev_test', addons: [] };
const ticketTypes = [
    { id: 'tt_std', name: 'Standard', priceCents: 8000, minPerOrder: 1, maxPerOrder: null, remaining: 100 },
];

describe('calculateQuote — empty cart', () => {
    it('returns all-zero totals when no tickets selected', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [],
            addonSelections: [],
        });

        expect(q.subtotalCents).toBe(0);
        expect(q.discountCents).toBe(0);
        expect(q.taxCents).toBe(0);
        expect(q.feeCents).toBe(0);
        expect(q.totalCents).toBe(0);
        expect(q.totalAttendees).toBe(0);
    });

    it('emits "At least one ticket is required" error', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [],
            addonSelections: [],
        });
        expect(q.errors).toContain('At least one ticket is required');
    });

    it('does NOT leak fixed-fee processing charges into total when subtotal is zero', () => {
        // Active processing fee with $0.30 fixed amount per booking. Without
        // the empty-cart short-circuit this would produce feeCents=30 and
        // totalCents=30 even though the user selected nothing — the bug
        // from HANDOFF commit 5555426.
        const taxesFees = [
            {
                id: 'tf_processing',
                category: 'fee',
                percent_bps: 290,
                fixed_cents: 30,
                per_unit: 'booking',
                applies_to: 'all',
                active: 1,
                sort_order: 30,
                name: 'Processing Fees',
            },
        ];

        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [],
            addonSelections: [],
            taxesFees,
        });

        expect(q.feeCents).toBe(0);
        expect(q.totalCents).toBe(0);
    });

    it('returns lineItems as an empty array when nothing selected', () => {
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [],
            addonSelections: [],
        });
        expect(Array.isArray(q.lineItems)).toBe(true);
        expect(q.lineItems).toHaveLength(0);
    });

    it('returns promoApplied:null on empty-cart short-circuit', () => {
        // The short-circuit branch returns promoApplied:null explicitly.
        // The non-short-circuit branch does not include this key in its
        // return shape — characterizing this asymmetry.
        const q = calculateQuote({
            event,
            ticketTypes,
            ticketSelections: [],
            addonSelections: [],
        });
        expect(q.promoApplied).toBeNull();
    });
});
