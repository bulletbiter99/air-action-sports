// Vitest unit tests for worker/lib/eventConflicts.js.
// Uses mockD1 to simulate D1 query responses.

import { describe, it, expect } from 'vitest';
import { createMockD1 } from '../../helpers/mockD1.js';
import {
    detectEventConflicts,
    dateIsoToDayWindow,
    intervalsOverlap,
    hasAnyConflict,
} from '../../../worker/lib/eventConflicts.js';

// Helper: build a mock env wrapping a mockD1 instance
function envWith(db) {
    return { DB: db };
}

describe('dateIsoToDayWindow', () => {
    it('converts YYYY-MM-DD to a 24-hour UTC window', () => {
        const w = dateIsoToDayWindow('2026-06-15');
        expect(w).not.toBeNull();
        expect(w.startMs).toBe(Date.parse('2026-06-15T00:00:00Z'));
        expect(w.endMs).toBe(Date.parse('2026-06-16T00:00:00Z'));
    });

    it('accepts YYYY-MM-DDTHH:... by truncating to date part', () => {
        const w = dateIsoToDayWindow('2026-06-15T14:30:00');
        expect(w.startMs).toBe(Date.parse('2026-06-15T00:00:00Z'));
        expect(w.endMs).toBe(Date.parse('2026-06-16T00:00:00Z'));
    });

    it('returns null for invalid input', () => {
        expect(dateIsoToDayWindow(null)).toBeNull();
        expect(dateIsoToDayWindow(undefined)).toBeNull();
        expect(dateIsoToDayWindow('')).toBeNull();
        expect(dateIsoToDayWindow('not-a-date')).toBeNull();
        expect(dateIsoToDayWindow('20260615')).toBeNull(); // missing dashes
        expect(dateIsoToDayWindow(12345)).toBeNull(); // not a string
    });
});

describe('intervalsOverlap', () => {
    it('detects overlap', () => {
        expect(intervalsOverlap(100, 200, 150, 250)).toBe(true);
        expect(intervalsOverlap(150, 250, 100, 200)).toBe(true);
    });

    it('detects containment', () => {
        expect(intervalsOverlap(100, 200, 120, 180)).toBe(true);
        expect(intervalsOverlap(120, 180, 100, 200)).toBe(true);
    });

    it('adjacent intervals do NOT overlap (half-open)', () => {
        expect(intervalsOverlap(100, 200, 200, 300)).toBe(false);
        expect(intervalsOverlap(200, 300, 100, 200)).toBe(false);
    });

    it('disjoint intervals do not overlap', () => {
        expect(intervalsOverlap(100, 200, 300, 400)).toBe(false);
    });

    it('identical intervals overlap', () => {
        expect(intervalsOverlap(100, 200, 100, 200)).toBe(true);
    });
});

describe('detectEventConflicts — edge cases', () => {
    it('returns empty conflicts when siteId is missing', async () => {
        const db = createMockD1();
        const result = await detectEventConflicts(envWith(db), {
            siteId: null,
            startsAt: Date.parse('2026-06-15T00:00:00Z'),
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
        });
        expect(result).toEqual({ events: [], blackouts: [], fieldRentals: [] });
        // No SQL should have been issued
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns empty when endsAt <= startsAt', async () => {
        const db = createMockD1();
        const t = Date.parse('2026-06-15T00:00:00Z');
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_x',
            startsAt: t,
            endsAt: t, // zero-duration
        });
        expect(result).toEqual({ events: [], blackouts: [], fieldRentals: [] });
    });

    it('returns empty when startsAt/endsAt not finite numbers', async () => {
        const db = createMockD1();
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_x',
            startsAt: NaN,
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
        });
        expect(result).toEqual({ events: [], blackouts: [], fieldRentals: [] });
    });
});

describe('detectEventConflicts — events table', () => {
    function setupEventsMock(db, eventRows) {
        db.__on(/SELECT id, title, date_iso, location FROM events/, () => ({
            results: eventRows,
            meta: { rows_read: eventRows.length },
        }), 'all');
        // No blackouts/rentals
        db.__on(/FROM site_blackouts/, { results: [] }, 'all');
        db.__on(/FROM field_rentals/, { results: [] }, 'all');
    }

    it('identical day window: 1 event conflict', async () => {
        const db = createMockD1();
        setupEventsMock(db, [
            { id: 'ev_a', title: 'Op Nightfall', date_iso: '2026-06-15', location: 'Ghost Town' },
        ]);
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T00:00:00Z'),
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
        });
        expect(result.events).toHaveLength(1);
        expect(result.events[0].id).toBe('ev_a');
    });

    it('partial day overlap (rental 9am-5pm on same day): conflict', async () => {
        const db = createMockD1();
        setupEventsMock(db, [
            { id: 'ev_a', title: 'Op A', date_iso: '2026-06-15', location: 'X' },
        ]);
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T09:00:00Z'),
            endsAt: Date.parse('2026-06-15T17:00:00Z'),
        });
        expect(result.events).toHaveLength(1);
    });

    it('adjacent days (event 2026-06-15, rental 2026-06-16 midnight start): NO conflict', async () => {
        const db = createMockD1();
        // SQL filter would exclude this event entirely (date_iso > endDateIsoExclusive)
        // We test by setting up the mock so the events query returns empty.
        setupEventsMock(db, []);
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-16T00:00:00Z'),
            endsAt: Date.parse('2026-06-17T00:00:00Z'),
        });
        expect(result.events).toHaveLength(0);
    });

    it('excludeEventId removes self on edit', async () => {
        const db = createMockD1();
        setupEventsMock(db, []); // SQL filter handles the exclude
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T00:00:00Z'),
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
            excludeEventId: 'ev_self',
        });
        // Verify the SQL included AND id != ?
        const writes = db.__writes();
        const eventQuery = writes.find((w) => /FROM events/.test(w.sql));
        expect(eventQuery.sql).toMatch(/id != \?/);
        expect(eventQuery.args).toContain('ev_self');
        expect(result.events).toHaveLength(0);
    });

    it('event with malformed date_iso is skipped', async () => {
        const db = createMockD1();
        setupEventsMock(db, [
            { id: 'ev_bad', title: 'Bad', date_iso: 'not-a-date', location: null },
            { id: 'ev_ok', title: 'OK', date_iso: '2026-06-15', location: null },
        ]);
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T00:00:00Z'),
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
        });
        expect(result.events).toHaveLength(1);
        expect(result.events[0].id).toBe('ev_ok');
    });
});

describe('detectEventConflicts — blackouts', () => {
    it('detects a blackout overlapping the request window', async () => {
        const db = createMockD1();
        db.__on(/FROM events/, { results: [] }, 'all');
        db.__on(/FROM site_blackouts/, () => ({
            results: [
                {
                    id: 'blk_1',
                    reason: 'Maintenance',
                    starts_at: Date.parse('2026-06-15T08:00:00Z'),
                    ends_at: Date.parse('2026-06-15T12:00:00Z'),
                },
            ],
        }), 'all');
        db.__on(/FROM field_rentals/, { results: [] }, 'all');

        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T09:00:00Z'),
            endsAt: Date.parse('2026-06-15T11:00:00Z'),
        });
        expect(result.blackouts).toHaveLength(1);
        expect(result.blackouts[0].id).toBe('blk_1');
    });

    it('blackout in a different site does not conflict', async () => {
        const db = createMockD1();
        db.__on(/FROM events/, { results: [] }, 'all');
        // Mock filters by site_id in SQL; we simulate by returning empty
        db.__on(/FROM site_blackouts/, { results: [] }, 'all');
        db.__on(/FROM field_rentals/, { results: [] }, 'all');
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_other',
            startsAt: Date.parse('2026-06-15T00:00:00Z'),
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
        });
        expect(result.blackouts).toHaveLength(0);
    });
});

describe('detectEventConflicts — field_rentals table missing (pre-B4)', () => {
    it('treats field_rentals query failure as no rentals (no throw)', async () => {
        const db = createMockD1();
        db.__on(/FROM events/, { results: [] }, 'all');
        db.__on(/FROM site_blackouts/, { results: [] }, 'all');
        db.__on(/FROM field_rentals/, () => {
            throw new Error('no such table: field_rentals');
        }, 'all');

        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T00:00:00Z'),
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
        });
        expect(result.fieldRentals).toEqual([]);
        // Other conflicts still computed normally
        expect(result.events).toEqual([]);
        expect(result.blackouts).toEqual([]);
    });

    it('field_rentals table exists but no overlapping rentals', async () => {
        const db = createMockD1();
        db.__on(/FROM events/, { results: [] }, 'all');
        db.__on(/FROM site_blackouts/, { results: [] }, 'all');
        db.__on(/FROM field_rentals/, { results: [] }, 'all');
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T00:00:00Z'),
            endsAt: Date.parse('2026-06-16T00:00:00Z'),
        });
        expect(result.fieldRentals).toEqual([]);
    });

    it('field_rentals returns overlapping rentals when present', async () => {
        const db = createMockD1();
        db.__on(/FROM events/, { results: [] }, 'all');
        db.__on(/FROM site_blackouts/, { results: [] }, 'all');
        db.__on(/FROM field_rentals/, () => ({
            results: [
                {
                    id: 'fr_1',
                    customer_id: 'cus_x',
                    starts_at: Date.parse('2026-06-15T10:00:00Z'),
                    ends_at: Date.parse('2026-06-15T14:00:00Z'),
                },
            ],
        }), 'all');
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T12:00:00Z'),
            endsAt: Date.parse('2026-06-15T16:00:00Z'),
        });
        expect(result.fieldRentals).toHaveLength(1);
        expect(result.fieldRentals[0].id).toBe('fr_1');
    });
});

describe('detectEventConflicts — combined', () => {
    it('returns conflicts from all three sources together', async () => {
        const db = createMockD1();
        db.__on(/FROM events/, () => ({
            results: [
                { id: 'ev_1', title: 'Op X', date_iso: '2026-06-15', location: null },
            ],
        }), 'all');
        db.__on(/FROM site_blackouts/, () => ({
            results: [
                {
                    id: 'blk_1',
                    reason: 'Weather',
                    starts_at: Date.parse('2026-06-15T08:00:00Z'),
                    ends_at: Date.parse('2026-06-15T12:00:00Z'),
                },
            ],
        }), 'all');
        db.__on(/FROM field_rentals/, () => ({
            results: [
                {
                    id: 'fr_1',
                    customer_id: 'cus_x',
                    starts_at: Date.parse('2026-06-15T10:00:00Z'),
                    ends_at: Date.parse('2026-06-15T14:00:00Z'),
                },
            ],
        }), 'all');

        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: Date.parse('2026-06-15T09:00:00Z'),
            endsAt: Date.parse('2026-06-15T11:00:00Z'),
        });
        expect(result.events).toHaveLength(1);
        expect(result.blackouts).toHaveLength(1);
        expect(result.fieldRentals).toHaveLength(1);
    });
});

describe('hasAnyConflict', () => {
    it('returns false for empty result', () => {
        expect(hasAnyConflict({ events: [], blackouts: [], fieldRentals: [] })).toBe(false);
    });

    it('returns true when any category has conflicts', () => {
        expect(hasAnyConflict({ events: [{}], blackouts: [], fieldRentals: [] })).toBe(true);
        expect(hasAnyConflict({ events: [], blackouts: [{}], fieldRentals: [] })).toBe(true);
        expect(hasAnyConflict({ events: [], blackouts: [], fieldRentals: [{}] })).toBe(true);
    });

    it('returns false for null/undefined input', () => {
        expect(hasAnyConflict(null)).toBe(false);
        expect(hasAnyConflict(undefined)).toBe(false);
    });

    it('handles missing arrays gracefully', () => {
        expect(hasAnyConflict({})).toBe(false);
    });
});
