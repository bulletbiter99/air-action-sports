// worker/lib/eventTime.js — Denver wall-clock ↔ real instant conversion.
//
// Regression origin: on 2026-07-25, 18 Operation Last Light customers received
// the "T-MINUS 1 HOUR" email at 1:20 AM — six hours early — because
// `unixepoch(events.date_iso)` reads a naked local datetime as UTC. The 1h and
// 24h reminder sweeps both matched early, stamped their sentinels, and then
// never fired at the correct time.
//
// The suite deliberately pins BOTH DST regimes. A hardcoded '-06:00' would pass
// every July assertion here and fail every January one — that asymmetry is the
// point.

import { describe, it, expect } from 'vitest';
import {
    denverWallClockToUtcMs,
    eventInstantMs,
    toDenverWallClock,
    denverWallClockWindow,
    eventStartsWithin,
} from '../../../worker/lib/eventTime.js';

const H = 60 * 60 * 1000;
const MIN = 60 * 1000;

// 2026 America/Denver: MST (UTC-7) through Mar 7, MDT (UTC-6) Mar 8 – Oct 31,
// MST again from Nov 1.
describe('eventInstantMs — MDT (summer, UTC-6)', () => {
    it('resolves Operation Last Light to its true 14:30Z start', () => {
        expect(eventInstantMs('2026-07-25T08:30:00')).toBe(Date.parse('2026-07-25T14:30:00Z'));
    });

    it('resolves Operation Fire Storm (evening start, rolls to the next UTC day)', () => {
        expect(eventInstantMs('2026-07-25T19:45:00')).toBe(Date.parse('2026-07-26T01:45:00Z'));
    });

    it('resolves Fire Storm ENDEX (multi-day end_date_iso)', () => {
        expect(eventInstantMs('2026-07-26T12:00:00')).toBe(Date.parse('2026-07-26T18:00:00Z'));
    });

    it('is exactly 6h later than the buggy naive-as-UTC reading', () => {
        const naive = Date.parse('2026-07-25T08:30:00Z'); // what unixepoch() believes
        expect(eventInstantMs('2026-07-25T08:30:00') - naive).toBe(6 * H);
    });
});

describe('eventInstantMs — MST (winter, UTC-7)', () => {
    it('resolves a January morning event', () => {
        expect(eventInstantMs('2026-01-17T08:30:00')).toBe(Date.parse('2026-01-17T15:30:00Z'));
    });

    it('resolves a post-fall-back November event', () => {
        expect(eventInstantMs('2026-11-15T08:30:00')).toBe(Date.parse('2026-11-15T15:30:00Z'));
    });

    // THE anti-regression guard for a hardcoded offset: in winter the skew is
    // 7 hours, not 6. Any '-06:00' shortcut fails right here.
    it('is 7h — NOT 6h — later than the naive reading', () => {
        const naive = Date.parse('2026-01-17T08:30:00Z');
        expect(eventInstantMs('2026-01-17T08:30:00') - naive).toBe(7 * H);
    });
});

describe('eventInstantMs — 2026 DST transitions', () => {
    // Spring forward: Sun 8 Mar 2026, 02:00 MST → 03:00 MDT.
    it('01:59 on spring-forward day is still MST', () => {
        expect(eventInstantMs('2026-03-08T01:59:00')).toBe(Date.parse('2026-03-08T08:59:00Z'));
    });

    it('03:00 on spring-forward day is already MDT', () => {
        expect(eventInstantMs('2026-03-08T03:00:00')).toBe(Date.parse('2026-03-08T09:00:00Z'));
    });

    // 02:00-02:59 does not exist on this date. Returning a finite deterministic
    // instant beats returning null: an event stored at a nonexistent local time
    // must still generate reminders rather than silently vanish from the sweep.
    it('a nonexistent gap time still yields a finite, stable instant', () => {
        const a = eventInstantMs('2026-03-08T02:30:00');
        expect(Number.isFinite(a)).toBe(true);
        expect(eventInstantMs('2026-03-08T02:30:00')).toBe(a);
    });

    // Fall back: Sun 1 Nov 2026, 02:00 MDT → 01:00 MST. 01:00-01:59 occurs twice.
    it('an ambiguous fold time resolves deterministically to one occurrence', () => {
        const a = eventInstantMs('2026-11-01T01:30:00');
        expect(Number.isFinite(a)).toBe(true);
        expect(eventInstantMs('2026-11-01T01:30:00')).toBe(a);
        // Must be one of the two real candidates: 07:30Z (MDT) or 08:30Z (MST).
        expect([Date.parse('2026-11-01T07:30:00Z'), Date.parse('2026-11-01T08:30:00Z')]).toContain(a);
    });

    it('00:30 before the fold is MDT and 03:30 after it is MST', () => {
        expect(eventInstantMs('2026-11-01T00:30:00')).toBe(Date.parse('2026-11-01T06:30:00Z'));
        expect(eventInstantMs('2026-11-01T03:30:00')).toBe(Date.parse('2026-11-01T10:30:00Z'));
    });
});

describe('eventInstantMs — input shapes', () => {
    it('treats a date-only value as midnight Denver', () => {
        expect(eventInstantMs('2026-07-25')).toBe(Date.parse('2026-07-25T06:00:00Z'));
        expect(eventInstantMs('2026-01-17')).toBe(Date.parse('2026-01-17T07:00:00Z'));
    });

    it('accepts a 16-char value with no seconds', () => {
        expect(eventInstantMs('2026-07-25T08:30')).toBe(Date.parse('2026-07-25T14:30:00Z'));
    });

    it('tolerates a space separator and fractional seconds', () => {
        expect(eventInstantMs('2026-07-25 08:30:00')).toBe(Date.parse('2026-07-25T14:30:00Z'));
        expect(eventInstantMs('2026-07-25T08:30:00.000')).toBe(Date.parse('2026-07-25T14:30:00Z'));
    });

    it('handles midnight without the ICU hour-24 off-by-a-day', () => {
        expect(eventInstantMs('2026-07-25T00:00:00')).toBe(Date.parse('2026-07-25T06:00:00Z'));
    });

    it.each([
        ['empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['free text', 'nonsense'],
        ['month 13 / day 99', '2026-13-99'],
        ['a February 30th', '2026-02-30'],
        ['hour 25', '2026-07-25T25:00:00'],
        ['minute 61', '2026-07-25T08:61:00'],
        ['already has a Z suffix', '2026-07-25T08:30:00Z'],
        ['already has an offset', '2026-07-25T08:30:00-06:00'],
    ])('returns null for %s', (_label, value) => {
        expect(eventInstantMs(value)).toBeNull();
    });

    // Date.UTC silently normalizes out-of-range components, which would turn a
    // malformed row into a confident WRONG instant instead of a null.
    it('does not let Date.UTC normalize a bad date into a plausible one', () => {
        expect(eventInstantMs('2026-13-01')).toBeNull();
        expect(eventInstantMs('2026-00-10')).toBeNull();
        expect(eventInstantMs('2026-04-31')).toBeNull();
    });
});

describe('toDenverWallClock', () => {
    it('round-trips every stored production value', () => {
        for (const iso of [
            '2026-05-09T08:30:00',
            '2026-06-20T07:00:00',
            '2026-06-20T16:00:00',
            '2026-07-25T08:30:00',
            '2026-07-25T19:45:00',
            '2026-07-26T12:00:00',
            '2026-01-17T08:30:00',
        ]) {
            expect(toDenverWallClock(eventInstantMs(iso))).toBe(iso);
        }
    });

    it('emits the same 19-char shape date_iso is stored in', () => {
        const s = toDenverWallClock(Date.parse('2026-07-25T14:30:00Z'));
        expect(s).toHaveLength(19);
        expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it('returns null for a non-finite input', () => {
        expect(toDenverWallClock(NaN)).toBeNull();
        expect(toDenverWallClock(undefined)).toBeNull();
    });
});

describe('denverWallClockToUtcMs', () => {
    it('defaults the time component to midnight', () => {
        expect(denverWallClockToUtcMs(2026, 7, 25)).toBe(Date.parse('2026-07-25T06:00:00Z'));
    });

    it('takes a 1-based month', () => {
        expect(denverWallClockToUtcMs(2026, 1, 17, 8, 30, 0)).toBe(Date.parse('2026-01-17T15:30:00Z'));
    });
});

describe('denverWallClockWindow', () => {
    // EXACTNESS IS LOAD-BEARING. Callers apply a LIMIT to this range, so any
    // unconditional widening lets already-closed rows (sentinel still NULL via
    // the send-failure roll-back, big-event overflow, or an admin reschedule)
    // consume the LIMIT and starve the rows actually due — a silent no-op sweep.
    // These pin that the bounds are exact whenever no DST transition intervenes.
    it('is EXACT (zero padding) for an ordinary MDT window', () => {
        const lo = Date.parse('2026-07-25T14:00:00Z');
        const hi = Date.parse('2026-07-25T15:00:00Z');
        expect(denverWallClockWindow(lo, hi)).toEqual({
            lo: toDenverWallClock(lo),
            hi: toDenverWallClock(hi),
        });
    });

    it('is EXACT for an ordinary MST window', () => {
        const lo = Date.parse('2026-01-17T14:00:00Z');
        const hi = Date.parse('2026-01-17T15:00:00Z');
        expect(denverWallClockWindow(lo, hi)).toEqual({
            lo: toDenverWallClock(lo),
            hi: toDenverWallClock(hi),
        });
    });

    it('widens ONLY when the window straddles a DST transition', () => {
        // Spring forward: 2026-03-08 09:00Z is the 02:00 MST → 03:00 MDT jump.
        const lo = Date.parse('2026-03-08T08:30:00Z');
        const hi = Date.parse('2026-03-08T09:30:00Z');
        const w = denverWallClockWindow(lo, hi);
        expect(w.lo < toDenverWallClock(lo)).toBe(true);
        expect(w.hi > toDenverWallClock(hi)).toBe(true);
    });

    it('produces bounds that sort correctly against a stored value', () => {
        // 1h sweep, standing 60 min before Last Light.
        const now = Date.parse('2026-07-25T13:30:00Z');
        const w = denverWallClockWindow(now + 45 * MIN, now + 75 * MIN);
        expect('2026-07-25T08:30:00' >= w.lo).toBe(true);
        expect('2026-07-25T08:30:00' <= w.hi).toBe(true);
    });

    it('never emits inverted bounds, even across the fall-back fold', () => {
        // Walk every 5 minutes through both 2026 transitions.
        for (const anchor of ['2026-03-08T00:00:00Z', '2026-11-01T00:00:00Z']) {
            const base = Date.parse(anchor);
            for (let m = 0; m < 24 * 60; m += 5) {
                const now = base + m * MIN;
                for (const [lo, hi] of [[45 * MIN, 75 * MIN], [20 * H, 28 * H]]) {
                    const w = denverWallClockWindow(now + lo, now + hi);
                    expect(w.lo <= w.hi).toBe(true);
                }
            }
        }
    });
});

describe('eventStartsWithin — the 2026-07-25 regression', () => {
    const LAST_LIGHT = '2026-07-25T08:30:00';

    it('does NOT fire at 1:20 AM MDT — the exact moment the bad email went out', () => {
        const now = Date.parse('2026-07-25T07:20:00Z'); // 01:20 MDT
        expect(eventStartsWithin(LAST_LIGHT, now + 45 * MIN, now + 75 * MIN)).toBe(false);
    });

    it('DOES fire 60 minutes before the real 8:30 AM start', () => {
        const now = Date.parse('2026-07-25T13:30:00Z'); // 07:30 MDT
        expect(eventStartsWithin(LAST_LIGHT, now + 45 * MIN, now + 75 * MIN)).toBe(true);
    });

    it('fires the 24h window at T-24h and not at T-48h', () => {
        const t24 = Date.parse('2026-07-24T14:30:00Z');
        expect(eventStartsWithin(LAST_LIGHT, t24 + 20 * H, t24 + 28 * H)).toBe(true);
        const t48 = Date.parse('2026-07-23T14:30:00Z');
        expect(eventStartsWithin(LAST_LIGHT, t48 + 20 * H, t48 + 28 * H)).toBe(false);
    });

    it('fires a WINTER event at T-60min (proves the offset is not hardcoded)', () => {
        const now = Date.parse('2026-01-17T14:30:00Z'); // 07:30 MST
        expect(eventStartsWithin('2026-01-17T08:30:00', now + 45 * MIN, now + 75 * MIN)).toBe(true);
    });

    it('excludes a row whose date_iso cannot be parsed', () => {
        const now = Date.parse('2026-07-25T13:30:00Z');
        expect(eventStartsWithin('', now, now + H)).toBe(false);
        expect(eventStartsWithin(null, now, now + H)).toBe(false);
        expect(eventStartsWithin('garbage', now, now + H)).toBe(false);
    });

    it('is inclusive on both bounds, matching SQL BETWEEN', () => {
        const t = eventInstantMs(LAST_LIGHT);
        expect(eventStartsWithin(LAST_LIGHT, t, t)).toBe(true);
        expect(eventStartsWithin(LAST_LIGHT, t + 1, t + H)).toBe(false);
        expect(eventStartsWithin(LAST_LIGHT, t - H, t - 1)).toBe(false);
    });
});

// The load-bearing safety property of the whole design: the SQL pre-filter is a
// padded wall-clock TEXT range, so it may over-select, but it must NEVER drop a
// row the precise JS test would have accepted. Over-fetching costs a few rows;
// under-fetching silently loses a customer email.
describe('SQL pre-filter never excludes a true match', () => {
    // Every EXISTENT wall-clock time must be selectable. The nonexistent
    // spring-forward gap (02:00-02:59 on 2026-03-08) is excluded here and pinned
    // separately below as a known, deliberate limitation.
    const EVENTS = [
        '2026-07-25T08:30:00', // MDT
        '2026-01-17T23:30:00', // MST, late evening (crosses UTC midnight)
        '2026-03-08T03:30:00', // just after spring forward
        '2026-03-08T01:30:00', // just before spring forward
        '2026-11-01T01:30:00', // fall-back fold (ambiguous but EXISTENT)
        '2026-11-01T03:30:00', // just after fall back
        '2026-06-20T07:00:00',
    ];
    const WINDOWS = [
        ['1h', 45 * MIN, 75 * MIN],
        ['24h', 20 * H, 28 * H],
    ];

    it.each(WINDOWS)('holds for the %s sweep across 30 days of tick times', (_label, lo, hi) => {
        let checked = 0;
        for (const iso of EVENTS) {
            const t = eventInstantMs(iso);
            // Walk "now" backward from the event in 7-minute steps for 30 days,
            // which crosses both DST boundaries for the March/November fixtures.
            for (let step = -30 * 24 * 60; step <= 0; step += 7) {
                const now = t + step * MIN;
                const inWindow = eventStartsWithin(iso, now + lo, now + hi);
                if (!inWindow) continue;
                const w = denverWallClockWindow(now + lo, now + hi);
                // Whenever JS says fire, SQL must have handed us the row.
                expect(iso >= w.lo && iso <= w.hi).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0); // guard against a vacuous pass
    });

    // The one case the guarantee does NOT cover, pinned so it stays a visible
    // decision. 02:30 on spring-forward Sunday is a wall clock no instant has,
    // so the row sits outside any range built from real instants. Covering it
    // would require widening the range on transition days, which reintroduces
    // LIMIT starvation — a worse trade for an event that would have to be
    // scheduled at 2:30 AM on the second Sunday of March.
    it('KNOWN GAP: a nonexistent spring-forward wall clock is not range-selectable', () => {
        const gap = '2026-03-08T02:30:00';
        const t = eventInstantMs(gap);
        expect(Number.isFinite(t)).toBe(true);

        // Its own resolved instant reports a DIFFERENT wall clock — the tell.
        expect(toDenverWallClock(t)).not.toBe(gap);
        expect(toDenverWallClock(t)).toBe('2026-03-08T01:30:00');

        // So a window centred on it selects by JS but not by the SQL range.
        const now = t - 60 * MIN;
        expect(eventStartsWithin(gap, now + 45 * MIN, now + 75 * MIN)).toBe(true);
        const w = denverWallClockWindow(now + 45 * MIN, now + 75 * MIN);
        expect(gap >= w.lo && gap <= w.hi).toBe(false);
    });
});
