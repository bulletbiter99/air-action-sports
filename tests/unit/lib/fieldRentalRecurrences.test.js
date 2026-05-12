// M5.5 Batch 10a — pure-helper tests for the recurrence-generation cron.
//
// Covers:
//   - Date arithmetic: isoDate / addDays / weekdayOf
//   - Denver TZ: denverOffsetMinutes across DST boundaries; nthWeekdayOfMonth
//   - combineDateAndLocal: local-time + offset → epoch ms
//   - Frequency parsers: parseWeekdayMask / parseMonthlyPattern /
//     parseCustomDates
//   - Enumerators: enumerateWeeklyDates / enumerateMonthlyNthWeekdayDates
//   - Dispatcher: computeNextOccurrences (window-clipped, ends_on-aware,
//     starts_on-aware, frequency-aware)

import { describe, it, expect } from 'vitest';
import {
    isoDate,
    addDays,
    weekdayOf,
    denverOffsetMinutes,
    nthWeekdayOfMonth,
    combineDateAndLocal,
    parseWeekdayMask,
    parseMonthlyPattern,
    parseCustomDates,
    enumerateWeeklyDates,
    enumerateMonthlyNthWeekdayDates,
    computeNextOccurrences,
} from '../../../worker/lib/fieldRentalRecurrences.js';

// ────────────────────────────────────────────────────────────────────
// Date arithmetic
// ────────────────────────────────────────────────────────────────────

describe('isoDate', () => {
    it('converts a UTC epoch ms to YYYY-MM-DD', () => {
        expect(isoDate(Date.UTC(2026, 5, 15, 12, 0, 0))).toBe('2026-06-15');
    });

    it('returns null for non-finite input', () => {
        expect(isoDate(null)).toBeNull();
        expect(isoDate(undefined)).toBeNull();
        expect(isoDate('abc')).toBeNull();
    });
});

describe('addDays', () => {
    it('adds positive days', () => {
        expect(addDays('2026-06-15', 1)).toBe('2026-06-16');
        expect(addDays('2026-06-15', 30)).toBe('2026-07-15');
    });

    it('subtracts (negative delta)', () => {
        expect(addDays('2026-06-15', -1)).toBe('2026-06-14');
    });

    it('crosses month + year boundaries', () => {
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('returns null for malformed input', () => {
        expect(addDays('not-a-date', 1)).toBeNull();
        expect(addDays(null, 1)).toBeNull();
    });
});

describe('weekdayOf', () => {
    it('returns 0 for Sunday', () => {
        // 2026-06-14 is a Sunday
        expect(weekdayOf('2026-06-14')).toBe(0);
    });

    it('returns 6 for Saturday', () => {
        // 2026-06-13 is a Saturday
        expect(weekdayOf('2026-06-13')).toBe(6);
    });

    it('returns 2 for Tuesday', () => {
        // 2026-06-16 is a Tuesday
        expect(weekdayOf('2026-06-16')).toBe(2);
    });

    it('returns null for malformed input', () => {
        expect(weekdayOf('bogus')).toBeNull();
        expect(weekdayOf(null)).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────
// Denver timezone offset (DST-aware)
// ────────────────────────────────────────────────────────────────────

describe('denverOffsetMinutes', () => {
    it('returns -420 (MST) in mid-January', () => {
        expect(denverOffsetMinutes('2026-01-15')).toBe(-420);
    });

    it('returns -360 (MDT) in mid-July', () => {
        expect(denverOffsetMinutes('2026-07-15')).toBe(-360);
    });

    it('switches to DST on the 2nd Sunday of March', () => {
        // 2026: 2nd Sunday of March is March 8
        expect(denverOffsetMinutes('2026-03-07')).toBe(-420); // day before
        expect(denverOffsetMinutes('2026-03-08')).toBe(-360); // DST starts
        expect(denverOffsetMinutes('2026-03-09')).toBe(-360); // day after
    });

    it('switches back to MST on the 1st Sunday of November', () => {
        // 2026: 1st Sunday of November is November 1
        expect(denverOffsetMinutes('2026-10-31')).toBe(-360); // day before
        expect(denverOffsetMinutes('2026-11-01')).toBe(-420); // MST resumes
        expect(denverOffsetMinutes('2026-11-02')).toBe(-420);
    });

    it('returns null for malformed input', () => {
        expect(denverOffsetMinutes('bogus')).toBeNull();
    });
});

describe('nthWeekdayOfMonth', () => {
    it('2nd Tuesday of June 2026 = 2026-06-09', () => {
        expect(nthWeekdayOfMonth(2026, 6, 2, 2)).toBe('2026-06-09');
    });

    it('1st Sunday of November 2026 = 2026-11-01', () => {
        expect(nthWeekdayOfMonth(2026, 11, 1, 0)).toBe('2026-11-01');
    });

    it('5th Saturday of August 2026 = 2026-08-29', () => {
        // Aug 2026: Sat = 1, 8, 15, 22, 29 (five of them)
        expect(nthWeekdayOfMonth(2026, 8, 5, 6)).toBe('2026-08-29');
    });

    it('returns null when N exceeds month count (5th Tuesday of June 2026)', () => {
        // June 2026: Tue = 2, 9, 16, 23, 30 — five of them, so 5th = 2026-06-30
        // Let's pick a month with only 4 of a weekday for negative test
        // February 2026 (non-leap): Feb 1 is Sunday; Tues = 3, 10, 17, 24 — only 4
        expect(nthWeekdayOfMonth(2026, 2, 5, 2)).toBeNull();
    });

    it('returns null for invalid inputs', () => {
        expect(nthWeekdayOfMonth(2026, 13, 1, 0)).toBeNull(); // month > 12
        expect(nthWeekdayOfMonth(2026, 6, 0, 0)).toBeNull();  // n < 1
        expect(nthWeekdayOfMonth(2026, 6, 1, 7)).toBeNull();  // weekday > 6
    });
});

// ────────────────────────────────────────────────────────────────────
// combineDateAndLocal (local + tz offset → epoch ms)
// ────────────────────────────────────────────────────────────────────

describe('combineDateAndLocal', () => {
    it('converts local 14:00 MDT to UTC 20:00 epoch ms', () => {
        // 2026-06-15 14:00 MDT (offset -360 min) = 2026-06-15 20:00 UTC
        const got = combineDateAndLocal('2026-06-15', '14:00', -360);
        expect(got).toBe(Date.UTC(2026, 5, 15, 20, 0));
    });

    it('converts local 09:00 MST to UTC 16:00 epoch ms', () => {
        // 2026-01-15 09:00 MST (offset -420 min) = 2026-01-15 16:00 UTC
        const got = combineDateAndLocal('2026-01-15', '09:00', -420);
        expect(got).toBe(Date.UTC(2026, 0, 15, 16, 0));
    });

    it('returns null for malformed date or time', () => {
        expect(combineDateAndLocal('bogus', '14:00', -360)).toBeNull();
        expect(combineDateAndLocal('2026-06-15', '25:00', -360)).toBeNull();
        expect(combineDateAndLocal('2026-06-15', 'bogus', -360)).toBeNull();
    });

    it('returns null for non-finite tz offset', () => {
        expect(combineDateAndLocal('2026-06-15', '14:00', NaN)).toBeNull();
        expect(combineDateAndLocal('2026-06-15', '14:00', null)).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────
// parseWeekdayMask
// ────────────────────────────────────────────────────────────────────

describe('parseWeekdayMask', () => {
    it('mask=4 → [2] (Tuesday only)', () => {
        expect(parseWeekdayMask(4)).toEqual([2]);
    });

    it('mask=20 → [2, 4] (Tuesday + Thursday)', () => {
        expect(parseWeekdayMask(20)).toEqual([2, 4]);
    });

    it('mask=127 → [0,1,2,3,4,5,6] (all days)', () => {
        expect(parseWeekdayMask(127)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('mask=0 or invalid → []', () => {
        expect(parseWeekdayMask(0)).toEqual([]);
        expect(parseWeekdayMask(-1)).toEqual([]);
        expect(parseWeekdayMask(128)).toEqual([]);
        expect(parseWeekdayMask(null)).toEqual([]);
        expect(parseWeekdayMask('abc')).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────
// parseMonthlyPattern
// ────────────────────────────────────────────────────────────────────

describe('parseMonthlyPattern', () => {
    it('valid nth_weekday object', () => {
        expect(parseMonthlyPattern({ kind: 'nth_weekday', n: 2, weekday: 2 }))
            .toEqual({ kind: 'nth_weekday', n: 2, weekday: 2 });
    });

    it('valid nth_weekday JSON string', () => {
        expect(parseMonthlyPattern('{"kind":"nth_weekday","n":3,"weekday":5}'))
            .toEqual({ kind: 'nth_weekday', n: 3, weekday: 5 });
    });

    it('rejects day_of_month kind (deferred per plan-mode Option B)', () => {
        expect(parseMonthlyPattern({ kind: 'day_of_month', day: 15 })).toBeNull();
    });

    it('rejects unknown kind', () => {
        expect(parseMonthlyPattern({ kind: 'whatever', n: 1, weekday: 0 })).toBeNull();
    });

    it('rejects n out of range', () => {
        expect(parseMonthlyPattern({ kind: 'nth_weekday', n: 0, weekday: 0 })).toBeNull();
        expect(parseMonthlyPattern({ kind: 'nth_weekday', n: 6, weekday: 0 })).toBeNull();
    });

    it('rejects weekday out of range', () => {
        expect(parseMonthlyPattern({ kind: 'nth_weekday', n: 1, weekday: -1 })).toBeNull();
        expect(parseMonthlyPattern({ kind: 'nth_weekday', n: 1, weekday: 7 })).toBeNull();
    });

    it('rejects malformed JSON string', () => {
        expect(parseMonthlyPattern('not-json')).toBeNull();
    });

    it('rejects null / undefined', () => {
        expect(parseMonthlyPattern(null)).toBeNull();
        expect(parseMonthlyPattern(undefined)).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────
// parseCustomDates
// ────────────────────────────────────────────────────────────────────

describe('parseCustomDates', () => {
    it('parses an array of YYYY-MM-DD strings', () => {
        expect(parseCustomDates(['2026-06-15', '2026-07-04']))
            .toEqual(['2026-06-15', '2026-07-04']);
    });

    it('parses JSON string', () => {
        expect(parseCustomDates('["2026-06-15","2026-07-04"]'))
            .toEqual(['2026-06-15', '2026-07-04']);
    });

    it('returns sorted ascending', () => {
        expect(parseCustomDates(['2026-07-04', '2026-06-15']))
            .toEqual(['2026-06-15', '2026-07-04']);
    });

    it('drops duplicates', () => {
        expect(parseCustomDates(['2026-06-15', '2026-06-15']))
            .toEqual(['2026-06-15']);
    });

    it('filters malformed entries', () => {
        expect(parseCustomDates(['2026-06-15', 'bogus', '2026/07/04', '2026-07-04']))
            .toEqual(['2026-06-15', '2026-07-04']);
    });

    it('returns [] for non-array input', () => {
        expect(parseCustomDates(null)).toEqual([]);
        expect(parseCustomDates({})).toEqual([]);
        expect(parseCustomDates('not-json')).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────
// enumerateWeeklyDates
// ────────────────────────────────────────────────────────────────────

describe('enumerateWeeklyDates', () => {
    it('every Tuesday for 4 weeks', () => {
        const dates = enumerateWeeklyDates('2026-06-15', '2026-07-12', [2]);
        // June 16, 23, 30; July 7
        expect(dates).toEqual(['2026-06-16', '2026-06-23', '2026-06-30', '2026-07-07']);
    });

    it('Tuesday + Thursday for 2 weeks', () => {
        const dates = enumerateWeeklyDates('2026-06-15', '2026-06-28', [2, 4]);
        // Tuesdays: 16, 23. Thursdays: 18, 25.
        expect(dates.sort()).toEqual(['2026-06-16', '2026-06-18', '2026-06-23', '2026-06-25']);
    });

    it('empty weekdays array → empty result', () => {
        expect(enumerateWeeklyDates('2026-06-15', '2026-07-15', [])).toEqual([]);
    });

    it('fromDate > throughDate → empty', () => {
        expect(enumerateWeeklyDates('2026-07-15', '2026-06-15', [2])).toEqual([]);
    });

    it('handles null inputs defensively', () => {
        expect(enumerateWeeklyDates(null, '2026-07-15', [2])).toEqual([]);
        expect(enumerateWeeklyDates('2026-06-15', null, [2])).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────
// enumerateMonthlyNthWeekdayDates
// ────────────────────────────────────────────────────────────────────

describe('enumerateMonthlyNthWeekdayDates', () => {
    it('2nd Tuesday of each month June→August 2026', () => {
        const dates = enumerateMonthlyNthWeekdayDates('2026-06-01', '2026-08-31', 2, 2);
        expect(dates).toEqual(['2026-06-09', '2026-07-14', '2026-08-11']);
    });

    it('5th weekday: skips months that lack a 5th occurrence', () => {
        // 5th Tuesday: in 2026, June has Tuesdays 2,9,16,23,30 (5th = 06-30).
        // July has 7,14,21,28 (only 4). August has 4,11,18,25 (only 4).
        // September has 1,8,15,22,29 (5th = 09-29).
        const dates = enumerateMonthlyNthWeekdayDates('2026-06-01', '2026-09-30', 5, 2);
        expect(dates).toEqual(['2026-06-30', '2026-09-29']);
    });

    it('clips to fromDate (skips a match before fromDate)', () => {
        // 2nd Tuesday of June 2026 = 2026-06-09. fromDate = 2026-06-15 → skip June.
        const dates = enumerateMonthlyNthWeekdayDates('2026-06-15', '2026-07-31', 2, 2);
        expect(dates).toEqual(['2026-07-14']);
    });

    it('returns [] for invalid window', () => {
        expect(enumerateMonthlyNthWeekdayDates('2026-07-15', '2026-06-15', 2, 2)).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────
// computeNextOccurrences (dispatcher)
// ────────────────────────────────────────────────────────────────────

describe('computeNextOccurrences', () => {
    it('weekly: respects starts_on AND fromDate (uses the later)', () => {
        const rec = {
            frequency: 'weekly',
            weekday_mask: 4, // Tuesday
            starts_on: '2026-06-15',
            ends_on: null,
        };
        // fromDate before starts_on → should clamp to starts_on
        const dates = computeNextOccurrences(rec, '2026-06-01', '2026-07-01');
        // Tuesdays from 2026-06-15: 16, 23, 30
        expect(dates).toEqual(['2026-06-16', '2026-06-23', '2026-06-30']);
    });

    it('weekly: respects ends_on (clips below throughDate)', () => {
        const rec = {
            frequency: 'weekly',
            weekday_mask: 4, // Tuesday
            starts_on: '2026-06-01',
            ends_on: '2026-06-20',
        };
        const dates = computeNextOccurrences(rec, '2026-06-01', '2026-07-31');
        // Tuesdays from 2026-06-01: 2, 9, 16, then 23 > ends_on so stop
        expect(dates).toEqual(['2026-06-02', '2026-06-09', '2026-06-16']);
    });

    it('monthly nth_weekday dispatcher', () => {
        const rec = {
            frequency: 'monthly',
            monthly_pattern: { kind: 'nth_weekday', n: 2, weekday: 2 },
            starts_on: '2026-06-01',
            ends_on: null,
        };
        const dates = computeNextOccurrences(rec, '2026-06-01', '2026-08-31');
        expect(dates).toEqual(['2026-06-09', '2026-07-14', '2026-08-11']);
    });

    it('monthly with day_of_month kind → [] (deferred)', () => {
        const rec = {
            frequency: 'monthly',
            monthly_pattern: { kind: 'day_of_month', day: 15 },
            starts_on: '2026-06-01',
            ends_on: null,
        };
        expect(computeNextOccurrences(rec, '2026-06-01', '2026-08-31')).toEqual([]);
    });

    it('custom: filters to window', () => {
        const rec = {
            frequency: 'custom',
            custom_dates_json: '["2026-06-15","2026-07-04","2026-12-31"]',
            starts_on: '2026-06-01',
            ends_on: null,
        };
        const dates = computeNextOccurrences(rec, '2026-06-01', '2026-08-31');
        expect(dates).toEqual(['2026-06-15', '2026-07-04']);
    });

    it('returns [] for unknown frequency', () => {
        expect(computeNextOccurrences({ frequency: 'unknown', starts_on: '2026-06-01' }, '2026-06-01', '2026-07-01')).toEqual([]);
    });

    it('returns [] when fromDate > throughDate', () => {
        const rec = { frequency: 'weekly', weekday_mask: 4, starts_on: '2026-06-01' };
        expect(computeNextOccurrences(rec, '2026-07-15', '2026-06-15')).toEqual([]);
    });

    it('returns [] when starts_on is after the window end', () => {
        const rec = { frequency: 'weekly', weekday_mask: 4, starts_on: '2027-01-01' };
        expect(computeNextOccurrences(rec, '2026-06-01', '2026-12-31')).toEqual([]);
    });

    it('returns [] for null/undefined inputs', () => {
        expect(computeNextOccurrences(null, '2026-06-01', '2026-07-01')).toEqual([]);
        expect(computeNextOccurrences({}, null, '2026-07-01')).toEqual([]);
        expect(computeNextOccurrences({}, '2026-06-01', null)).toEqual([]);
    });
});
