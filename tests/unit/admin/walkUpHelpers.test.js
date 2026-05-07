// M4 B6 — tests for src/admin/walkUpHelpers.js (pure helpers).
//
// pickRecallableBookings filters a customer's booking history to the
// most recent N paid/comp bookings. formatBookingHint + formatRelativeAge
// produce the recall-hint copy shown below the CustomerTypeahead in
// AdminNewBooking.

import { describe, it, expect } from 'vitest';
import {
    pickRecallableBookings,
    formatBookingHint,
    formatRelativeAge,
} from '../../../src/admin/walkUpHelpers.js';

describe('pickRecallableBookings', () => {
    it('returns most recent paid booking first', () => {
        const bookings = [
            { id: 'b_old', status: 'paid', paidAt: 1_000_000_000_000 },
            { id: 'b_new', status: 'paid', paidAt: 1_700_000_000_000 },
            { id: 'b_mid', status: 'paid', paidAt: 1_500_000_000_000 },
        ];
        const out = pickRecallableBookings(bookings);
        expect(out.map((b) => b.id)).toEqual(['b_new', 'b_mid', 'b_old']);
    });

    it('limits to max=3 by default', () => {
        const bookings = Array.from({ length: 10 }, (_, i) => ({
            id: `b_${i}`,
            status: 'paid',
            paidAt: 1_000_000_000_000 + i * 1000,
        }));
        const out = pickRecallableBookings(bookings);
        expect(out).toHaveLength(3);
    });

    it('respects custom max', () => {
        const bookings = Array.from({ length: 5 }, (_, i) => ({
            id: `b_${i}`,
            status: 'paid',
            paidAt: 1_000_000_000_000 + i * 1000,
        }));
        expect(pickRecallableBookings(bookings, 5)).toHaveLength(5);
        expect(pickRecallableBookings(bookings, 1)).toHaveLength(1);
    });

    it('filters out non-paid/non-comp bookings', () => {
        const bookings = [
            { id: 'b_paid', status: 'paid', paidAt: 1_700_000_000_000 },
            { id: 'b_pending', status: 'pending', createdAt: 1_700_000_000_000 },
            { id: 'b_refunded', status: 'refunded', paidAt: 1_700_000_000_000 },
            { id: 'b_abandoned', status: 'abandoned', createdAt: 1_700_000_000_000 },
            { id: 'b_comp', status: 'comp', createdAt: 1_700_000_000_000 },
        ];
        const out = pickRecallableBookings(bookings);
        const ids = out.map((b) => b.id);
        expect(ids).toContain('b_paid');
        expect(ids).toContain('b_comp');
        expect(ids).not.toContain('b_pending');
        expect(ids).not.toContain('b_refunded');
        expect(ids).not.toContain('b_abandoned');
    });

    it('falls back to createdAt when paidAt missing', () => {
        const bookings = [
            { id: 'b_only_created', status: 'paid', createdAt: 1_700_000_000_000 },
        ];
        const out = pickRecallableBookings(bookings);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('b_only_created');
    });

    it('accepts snake_case timestamp keys (worker raw response)', () => {
        const bookings = [
            { id: 'b_snake', status: 'paid', paid_at: 1_700_000_000_000 },
        ];
        const out = pickRecallableBookings(bookings);
        expect(out).toHaveLength(1);
    });

    it('skips entries without any usable timestamp', () => {
        const bookings = [
            { id: 'b_ok', status: 'paid', paidAt: 1_700_000_000_000 },
            { id: 'b_no_ts', status: 'paid' },
            { id: 'b_bad_ts', status: 'paid', paidAt: 'not-a-number' },
        ];
        const out = pickRecallableBookings(bookings);
        expect(out.map((b) => b.id)).toEqual(['b_ok']);
    });

    it('returns empty array for non-array input (defensive)', () => {
        expect(pickRecallableBookings(null)).toEqual([]);
        expect(pickRecallableBookings(undefined)).toEqual([]);
        expect(pickRecallableBookings('not-array')).toEqual([]);
    });

    it('returns empty array when max=0', () => {
        const bookings = [{ id: 'b_x', status: 'paid', paidAt: 1 }];
        expect(pickRecallableBookings(bookings, 0)).toEqual([]);
    });

    it('clamps negative max to 0', () => {
        const bookings = [{ id: 'b_x', status: 'paid', paidAt: 1 }];
        expect(pickRecallableBookings(bookings, -3)).toEqual([]);
    });

    it('handles empty array input', () => {
        expect(pickRecallableBookings([])).toEqual([]);
    });

    it('skips null/non-object entries', () => {
        const bookings = [
            null,
            'not-object',
            { id: 'b_ok', status: 'paid', paidAt: 1_700_000_000_000 },
        ];
        const out = pickRecallableBookings(bookings);
        expect(out).toHaveLength(1);
    });
});

describe('formatBookingHint', () => {
    const now = new Date('2026-05-08T12:00:00Z');

    it('returns event title plus relative time', () => {
        const booking = {
            eventTitle: 'Spring Showdown',
            paidAt: new Date('2026-04-24T12:00:00Z').getTime(),  // 14 days ago
        };
        expect(formatBookingHint(booking, now)).toBe('Spring Showdown · 2 weeks ago');
    });

    it('falls back to "previous event" when no title', () => {
        const booking = {
            paidAt: new Date('2026-05-07T12:00:00Z').getTime(),  // 1 day ago
        };
        expect(formatBookingHint(booking, now)).toBe('previous event · 1 day ago');
    });

    it('accepts event_title (snake_case) as well as eventTitle', () => {
        const booking = {
            event_title: 'Snake Title',
            paidAt: new Date('2026-05-07T12:00:00Z').getTime(),
        };
        expect(formatBookingHint(booking, now)).toBe('Snake Title · 1 day ago');
    });

    it('returns just the title when no usable timestamp', () => {
        const booking = { eventTitle: 'No Timestamp' };
        expect(formatBookingHint(booking, now)).toBe('No Timestamp');
    });

    it('returns empty string for null/undefined input', () => {
        expect(formatBookingHint(null)).toBe('');
        expect(formatBookingHint(undefined)).toBe('');
    });

    it('returns empty string for non-object input', () => {
        expect(formatBookingHint('string')).toBe('');
        expect(formatBookingHint(42)).toBe('');
    });
});

describe('formatRelativeAge', () => {
    const now = new Date('2026-05-08T12:00:00Z');

    it('returns "just now" for sub-minute differences', () => {
        expect(formatRelativeAge(now.getTime() - 30 * 1000, now)).toBe('just now');
        expect(formatRelativeAge(now.getTime() - 1000, now)).toBe('just now');
    });

    it('returns minutes for sub-hour differences', () => {
        expect(formatRelativeAge(now.getTime() - 5 * 60 * 1000, now)).toBe('5 minutes ago');
        expect(formatRelativeAge(now.getTime() - 1 * 60 * 1000, now)).toBe('1 minute ago');
    });

    it('returns hours for sub-day differences', () => {
        expect(formatRelativeAge(now.getTime() - 3 * 60 * 60 * 1000, now)).toBe('3 hours ago');
        expect(formatRelativeAge(now.getTime() - 1 * 60 * 60 * 1000, now)).toBe('1 hour ago');
    });

    it('returns days for sub-week differences', () => {
        expect(formatRelativeAge(now.getTime() - 3 * 24 * 60 * 60 * 1000, now)).toBe('3 days ago');
        expect(formatRelativeAge(now.getTime() - 1 * 24 * 60 * 60 * 1000, now)).toBe('1 day ago');
    });

    it('returns weeks for sub-5-week differences', () => {
        expect(formatRelativeAge(now.getTime() - 14 * 24 * 60 * 60 * 1000, now)).toBe('2 weeks ago');
        expect(formatRelativeAge(now.getTime() - 7 * 24 * 60 * 60 * 1000, now)).toBe('1 week ago');
    });

    it('returns months for sub-year differences', () => {
        expect(formatRelativeAge(now.getTime() - 60 * 24 * 60 * 60 * 1000, now)).toBe('2 months ago');
        expect(formatRelativeAge(now.getTime() - 35 * 24 * 60 * 60 * 1000, now)).toBe('1 month ago');
    });

    it('returns years for ≥ 1 year', () => {
        expect(formatRelativeAge(now.getTime() - 400 * 24 * 60 * 60 * 1000, now)).toBe('1 year ago');
        expect(formatRelativeAge(now.getTime() - 800 * 24 * 60 * 60 * 1000, now)).toBe('2 years ago');
    });

    it('returns "just now" for future timestamps (defensive)', () => {
        expect(formatRelativeAge(now.getTime() + 60 * 60 * 1000, now)).toBe('just now');
    });

    it('returns "unknown" for invalid timestamps', () => {
        expect(formatRelativeAge(0, now)).toBe('unknown');
        expect(formatRelativeAge(-1, now)).toBe('unknown');
        expect(formatRelativeAge(NaN, now)).toBe('unknown');
        expect(formatRelativeAge('not-a-number', now)).toBe('unknown');
    });
});
