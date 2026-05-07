// M3 Batch 10 — system tag computation tests.
//
// computeSystemTags is a pure function operating over a customer row +
// the current time. The runCustomerTagsSweep wrapper does I/O and is
// covered indirectly via the mockD1 path (statement count + sequence).

import { describe, it, expect } from 'vitest';
import {
    computeSystemTags,
    runCustomerTagsSweep,
    TAG_THRESHOLDS,
} from '../../../worker/lib/customerTags.js';
import { createMockD1 } from '../../helpers/mockD1.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000; // arbitrary fixed instant for deterministic tests

describe('computeSystemTags', () => {
    it('returns no tags for a brand-new customer with no bookings', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: 0,
            total_bookings: 0,
            first_booking_at: null,
            last_booking_at: null,
        };
        expect(computeSystemTags(cust, NOW)).toEqual([]);
    });

    it('emits "vip" when lifetime_value_cents > VIP threshold', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: TAG_THRESHOLDS.VIP_LTV_CENTS + 1,
            total_bookings: 1,
            first_booking_at: NOW - DAY_MS,
            last_booking_at: NOW - DAY_MS,
        };
        expect(computeSystemTags(cust, NOW)).toContain('vip');
    });

    it('does NOT emit "vip" when LTV equals the threshold (strict >)', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: TAG_THRESHOLDS.VIP_LTV_CENTS,
            total_bookings: 1,
            first_booking_at: NOW - DAY_MS,
            last_booking_at: NOW - DAY_MS,
        };
        expect(computeSystemTags(cust, NOW)).not.toContain('vip');
    });

    it('emits "frequent" when total_bookings >= FREQUENT threshold', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: 0,
            total_bookings: TAG_THRESHOLDS.FREQUENT_BOOKINGS,
            first_booking_at: NOW - 60 * DAY_MS,
            last_booking_at: NOW - DAY_MS,
        };
        expect(computeSystemTags(cust, NOW)).toContain('frequent');
    });

    it('emits "lapsed" when last booking > 180 days ago AND customer has bookings', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: 8000,
            total_bookings: 1,
            first_booking_at: NOW - 365 * DAY_MS,
            last_booking_at: NOW - 200 * DAY_MS,
        };
        expect(computeSystemTags(cust, NOW)).toContain('lapsed');
    });

    it('does NOT emit "lapsed" when total_bookings is zero (no booking history)', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: 0,
            total_bookings: 0,
            first_booking_at: null,
            last_booking_at: NOW - 365 * DAY_MS, // weird but harmless
        };
        expect(computeSystemTags(cust, NOW)).not.toContain('lapsed');
    });

    it('emits "new" when first booking is within last 30 days', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: 8000,
            total_bookings: 1,
            first_booking_at: NOW - 5 * DAY_MS,
            last_booking_at: NOW - 5 * DAY_MS,
        };
        expect(computeSystemTags(cust, NOW)).toContain('new');
    });

    it('does NOT emit "new" once first booking is older than 30 days', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: 8000,
            total_bookings: 1,
            first_booking_at: NOW - 60 * DAY_MS,
            last_booking_at: NOW - DAY_MS,
        };
        expect(computeSystemTags(cust, NOW)).not.toContain('new');
    });

    it('can emit multiple tags simultaneously (vip + frequent + new)', () => {
        const cust = {
            id: 'cus_x',
            lifetime_value_cents: 100000, // way above $500
            total_bookings: 8,
            first_booking_at: NOW - 10 * DAY_MS,
            last_booking_at: NOW - DAY_MS,
        };
        const tags = computeSystemTags(cust, NOW);
        expect(tags).toContain('vip');
        expect(tags).toContain('frequent');
        expect(tags).toContain('new');
        expect(tags).not.toContain('lapsed'); // recent booking, not stale
    });

    it('safely handles null/missing customer (defensive)', () => {
        expect(computeSystemTags(null, NOW)).toEqual([]);
        expect(computeSystemTags(undefined, NOW)).toEqual([]);
    });
});

describe('runCustomerTagsSweep', () => {
    it('clears existing system tags then inserts current computed set; returns summary', async () => {
        const db = createMockD1();
        db.__on(/SELECT[\s\S]*FROM customers\s+WHERE archived_at IS NULL/, {
            results: [
                {
                    id: 'cus_a',
                    lifetime_value_cents: 100000,        // → vip
                    total_bookings: 6,                    // → frequent
                    first_booking_at: NOW - 10 * DAY_MS,  // → new
                    last_booking_at: NOW - 1 * DAY_MS,
                },
                {
                    id: 'cus_b',
                    lifetime_value_cents: 0,
                    total_bookings: 0,
                    first_booking_at: null,
                    last_booking_at: null,
                },
            ],
        }, 'all');

        const result = await runCustomerTagsSweep({ DB: db }, { now: NOW });

        expect(result.customersProcessed).toBe(2);
        expect(result.tagsInserted).toBe(3); // cus_a: vip+frequent+new; cus_b: none
        expect(typeof result.durationMs).toBe('number');

        const writes = db.__writes();
        // First write: DELETE all system tags (sentinel-first cleanup)
        const del = writes.find(
            (w) => w.kind === 'run' && /DELETE FROM customer_tags WHERE tag_type = 'system'/.test(w.sql),
        );
        expect(del).toBeTruthy();

        // 3 inserts: vip, frequent, new — all for cus_a
        const inserts = writes.filter(
            (w) => w.kind === 'run' && /INSERT INTO customer_tags/.test(w.sql),
        );
        expect(inserts).toHaveLength(3);
        for (const w of inserts) {
            expect(w.args[0]).toBe('cus_a');     // customer_id bind
            expect(['vip', 'frequent', 'new']).toContain(w.args[1]); // tag bind
            expect(w.args[2]).toBe(NOW);          // created_at bind
        }
    });

    it('handles zero-customer case (just emits the DELETE; no INSERTs)', async () => {
        const db = createMockD1();
        db.__on(/FROM customers\s+WHERE archived_at IS NULL/, { results: [] }, 'all');

        const result = await runCustomerTagsSweep({ DB: db }, { now: NOW });
        expect(result.customersProcessed).toBe(0);
        expect(result.tagsInserted).toBe(0);

        const inserts = db.__writes().filter(
            (w) => w.kind === 'run' && /INSERT INTO customer_tags/.test(w.sql),
        );
        expect(inserts).toHaveLength(0);
    });
});
