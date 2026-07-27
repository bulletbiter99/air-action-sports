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
import { eventInstantMs } from '../../../worker/lib/eventTime.js';

// Fixture instants are DENVER wall-clock moments: event day boundaries, and
// rental/blackout windows as an operator types them into a datetime-local input
// (whose value the browser resolves in LOCAL time before .getTime()). Event
// windows are whole DENVER days now, so building fixtures with a '...Z' suffix
// would compare two different calendars and quietly reintroduce the very bug
// this file guards — an evening rental escaping conflict detection.
const denverMs = (naiveIso) => eventInstantMs(naiveIso);

// Helper: build a mock env wrapping a mockD1 instance
function envWith(db) {
    return { DB: db };
}

describe('dateIsoToDayWindow', () => {
    it('converts YYYY-MM-DD to a whole-DENVER-day window', () => {
        const w = dateIsoToDayWindow('2026-06-15');
        expect(w).not.toBeNull();
        expect(w.startMs).toBe(denverMs('2026-06-15T00:00:00'));
        expect(w.endMs).toBe(denverMs('2026-06-16T00:00:00'));
    });

    it('accepts YYYY-MM-DDTHH:... by truncating to date part', () => {
        const w = dateIsoToDayWindow('2026-06-15T14:30:00');
        expect(w.startMs).toBe(denverMs('2026-06-15T00:00:00'));
        expect(w.endMs).toBe(denverMs('2026-06-16T00:00:00'));
    });

    it('returns null for invalid input', () => {
        expect(dateIsoToDayWindow(null)).toBeNull();
        expect(dateIsoToDayWindow(undefined)).toBeNull();
        expect(dateIsoToDayWindow('')).toBeNull();
        expect(dateIsoToDayWindow('not-a-date')).toBeNull();
        expect(dateIsoToDayWindow('20260615')).toBeNull(); // missing dashes
        expect(dateIsoToDayWindow(12345)).toBeNull(); // not a string
    });

    it('spans multiple days when an end day is given (through end of the last day)', () => {
        const w = dateIsoToDayWindow('2026-06-20', '2026-06-21');
        expect(w.startMs).toBe(denverMs('2026-06-20T00:00:00'));
        expect(w.endMs).toBe(denverMs('2026-06-22T00:00:00')); // midnight after 06-21
    });

    it('truncates time components on both ends of a span', () => {
        const w = dateIsoToDayWindow('2026-06-20T16:00:00', '2026-06-21T22:00:00');
        expect(w.startMs).toBe(denverMs('2026-06-20T00:00:00'));
        expect(w.endMs).toBe(denverMs('2026-06-22T00:00:00'));
    });

    it('falls back to a single day when the end is equal/earlier/malformed', () => {
        expect(dateIsoToDayWindow('2026-06-20', '2026-06-20').endMs).toBe(denverMs('2026-06-21T00:00:00'));
        expect(dateIsoToDayWindow('2026-06-20', '2026-06-19').endMs).toBe(denverMs('2026-06-21T00:00:00'));
        expect(dateIsoToDayWindow('2026-06-20', 'not-a-date').endMs).toBe(denverMs('2026-06-21T00:00:00'));
        expect(dateIsoToDayWindow('2026-06-20', null).endMs).toBe(denverMs('2026-06-21T00:00:00'));
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
            startsAt: denverMs('2026-06-15T00:00:00'),
            endsAt: denverMs('2026-06-16T00:00:00'),
        });
        expect(result).toEqual({ events: [], blackouts: [], fieldRentals: [] });
        // No SQL should have been issued
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns empty when endsAt <= startsAt', async () => {
        const db = createMockD1();
        const t = denverMs('2026-06-15T00:00:00');
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
            endsAt: denverMs('2026-06-16T00:00:00'),
        });
        expect(result).toEqual({ events: [], blackouts: [], fieldRentals: [] });
    });
});

describe('detectEventConflicts — events table', () => {
    function setupEventsMock(db, eventRows) {
        db.__on(/SELECT id, title, date_iso, end_date_iso, location FROM events/, () => ({
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
            startsAt: denverMs('2026-06-15T00:00:00'),
            endsAt: denverMs('2026-06-16T00:00:00'),
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
            startsAt: denverMs('2026-06-15T09:00:00'),
            endsAt: denverMs('2026-06-15T17:00:00'),
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
            startsAt: denverMs('2026-06-16T00:00:00'),
            endsAt: denverMs('2026-06-17T00:00:00'),
        });
        expect(result.events).toHaveLength(0);
    });

    it('excludeEventId removes self on edit', async () => {
        const db = createMockD1();
        setupEventsMock(db, []); // SQL filter handles the exclude
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: denverMs('2026-06-15T00:00:00'),
            endsAt: denverMs('2026-06-16T00:00:00'),
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
            startsAt: denverMs('2026-06-15T00:00:00'),
            endsAt: denverMs('2026-06-16T00:00:00'),
        });
        expect(result.events).toHaveLength(1);
        expect(result.events[0].id).toBe('ev_ok');
    });

    it('multi-day event conflicts on its SECOND day (span window, not just day 1)', async () => {
        const db = createMockD1();
        setupEventsMock(db, [
            {
                id: 'ev_2day', title: 'Weekend Op',
                date_iso: '2026-06-20T16:00:00', end_date_iso: '2026-06-21T22:00:00',
                location: 'Ghost Town',
            },
        ]);
        // Request covering only DAY 2 (2026-06-21). Pre-Phase-2 the event's
        // day-1-only window missed this; the span window now overlaps.
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: denverMs('2026-06-21T00:00:00'),
            endsAt: denverMs('2026-06-22T00:00:00'),
        });
        expect(result.events).toHaveLength(1);
        expect(result.events[0].id).toBe('ev_2day');
    });

    it('single-day event (NULL end_date_iso) does NOT conflict with the next day', async () => {
        const db = createMockD1();
        setupEventsMock(db, [
            { id: 'ev_1day', title: 'One Day', date_iso: '2026-06-20T16:00:00', end_date_iso: null, location: null },
        ]);
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: denverMs('2026-06-21T00:00:00'),
            endsAt: denverMs('2026-06-22T00:00:00'),
        });
        expect(result.events).toHaveLength(0);
    });

    it('events query selects end_date_iso and uses a COALESCE day-overlap filter', async () => {
        const db = createMockD1();
        setupEventsMock(db, []);
        await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: denverMs('2026-06-20T00:00:00'),
            endsAt: denverMs('2026-06-21T00:00:00'),
        });
        const q = db.__writes().find((w) => /FROM events/.test(w.sql));
        expect(q.sql).toMatch(/end_date_iso/);
        expect(q.sql).toMatch(/COALESCE\(end_date_iso, date_iso\)/);
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
                    starts_at: denverMs('2026-06-15T08:00:00'),
                    ends_at: denverMs('2026-06-15T12:00:00'),
                },
            ],
        }), 'all');
        db.__on(/FROM field_rentals/, { results: [] }, 'all');

        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: denverMs('2026-06-15T09:00:00'),
            endsAt: denverMs('2026-06-15T11:00:00'),
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
            startsAt: denverMs('2026-06-15T00:00:00'),
            endsAt: denverMs('2026-06-16T00:00:00'),
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
            startsAt: denverMs('2026-06-15T00:00:00'),
            endsAt: denverMs('2026-06-16T00:00:00'),
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
            startsAt: denverMs('2026-06-15T00:00:00'),
            endsAt: denverMs('2026-06-16T00:00:00'),
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
                    starts_at: denverMs('2026-06-15T10:00:00'),
                    ends_at: denverMs('2026-06-15T14:00:00'),
                },
            ],
        }), 'all');
        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: denverMs('2026-06-15T12:00:00'),
            endsAt: denverMs('2026-06-15T16:00:00'),
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
                    starts_at: denverMs('2026-06-15T08:00:00'),
                    ends_at: denverMs('2026-06-15T12:00:00'),
                },
            ],
        }), 'all');
        db.__on(/FROM field_rentals/, () => ({
            results: [
                {
                    id: 'fr_1',
                    customer_id: 'cus_x',
                    starts_at: denverMs('2026-06-15T10:00:00'),
                    ends_at: denverMs('2026-06-15T14:00:00'),
                },
            ],
        }), 'all');

        const result = await detectEventConflicts(envWith(db), {
            siteId: 'site_g',
            startsAt: denverMs('2026-06-15T09:00:00'),
            endsAt: denverMs('2026-06-15T11:00:00'),
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

// ── The silent field double-booking (fixed 2026-07-27) ────────────────────
// Event windows used to be pinned to UTC midnight, i.e. Denver 18:00 the day
// BEFORE through 18:00 the day OF. Blackouts and field rentals hold genuine
// epoch-ms, so an evening rental on an event day fell past the window's end and
// was never nominated as a candidate: no 409, no conflict banner, the operator
// double-booked the field. The evening BEFORE was symmetrically a false
// positive. Event-vs-event was always fine (both sides shifted together), which
// is why this survived — the engine looked self-consistent.
describe('event window is a DENVER day, not a UTC day', () => {
    const EVENT_DAY = '2026-07-25';

    it('spans Denver midnight to Denver midnight', () => {
        const w = dateIsoToDayWindow(`${EVENT_DAY}T08:30:00`);
        expect(w.startMs).toBe(denverMs('2026-07-25T00:00:00'));
        expect(w.endMs).toBe(denverMs('2026-07-26T00:00:00'));
        // 24h in MDT — the guard is that it is not a fixed +24h across DST.
        expect(w.endMs - w.startMs).toBe(24 * 3600000);
    });

    it('a 6-11 PM rental ON the event day now falls INSIDE the window', () => {
        const w = dateIsoToDayWindow(`${EVENT_DAY}T08:30:00`);
        const rentalStart = denverMs('2026-07-25T18:00:00');
        const rentalEnd = denverMs('2026-07-25T23:00:00');
        expect(intervalsOverlap(w.startMs, w.endMs, rentalStart, rentalEnd)).toBe(true);
        // Under the old UTC-midnight window this rental began after endMs.
        const utcWindowEnd = Date.parse(`2026-07-26T00:00:00Z`);
        expect(rentalStart >= utcWindowEnd).toBe(true);
    });

    it('a 6-11 PM rental the EVENING BEFORE is no longer a false conflict', () => {
        const w = dateIsoToDayWindow(`${EVENT_DAY}T08:30:00`);
        const rentalStart = denverMs('2026-07-24T18:00:00');
        const rentalEnd = denverMs('2026-07-24T23:00:00');
        expect(intervalsOverlap(w.startMs, w.endMs, rentalStart, rentalEnd)).toBe(false);
    });

    it('handles a DST day correctly — spring forward is a 23-hour day', () => {
        const w = dateIsoToDayWindow('2026-03-08');
        expect(w.startMs).toBe(denverMs('2026-03-08T00:00:00'));
        expect(w.endMs).toBe(denverMs('2026-03-09T00:00:00'));
        // A fixed +24h would have overshot into the next day by an hour.
        expect(w.endMs - w.startMs).toBe(23 * 3600000);
    });

    it('handles a DST day correctly — fall back is a 25-hour day', () => {
        const w = dateIsoToDayWindow('2026-11-01');
        expect(w.endMs - w.startMs).toBe(25 * 3600000);
    });

    it('a well-formed but nonexistent end date falls back to single-day', () => {
        const w = dateIsoToDayWindow('2026-07-25', '2026-02-30');
        expect(w.endMs).toBe(denverMs('2026-07-26T00:00:00'));
    });
});
