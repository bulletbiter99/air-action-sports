// @vitest-environment jsdom

// Tests for src/hooks/useCountdown.js — the hero countdown on / and the
// MiniCountdown on /events/:slug.
//
// Regression: `targetDate` is an event's naive Denver `dateIso`, and
// `new Date(naive)` parses in the VIEWER's zone. The countdown was therefore
// correct only for visitors physically in Mountain time and ran fast everywhere
// else — 2h on the East Coast, 7h in the UK — hitting 00:00:00:00 while the op
// was still hours away.
//
// The assertions below are ABSOLUTE tuples. That is the point: post-fix the
// output is a pure function of (event instant, now) and no longer depends on the
// runner's ambient timezone, so an exact tuple is both meaningful and stable.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCountdown from '../../../src/hooks/useCountdown.js';

// 2026-07-25T08:30:00 Denver (MDT) === 14:30Z. Standing exactly 3d 2h 15m out.
const EVENT_ISO = '2026-07-25T08:30:00';
const NOW = Date.parse('2026-07-22T12:15:00Z');

describe('useCountdown', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts down to the event\'s true Denver instant', () => {
        const { result } = renderHook(() => useCountdown(EVENT_ISO));
        // 2026-07-25T14:30:00Z − 2026-07-22T12:15:00Z = 3d 2h 15m 0s
        expect(result.current).toEqual({ days: '03', hours: '02', mins: '15', secs: '00' });
    });

    it('does NOT treat the naive string as UTC (the 6h bug)', () => {
        const { result } = renderHook(() => useCountdown(EVENT_ISO));
        // Reading '08:30' as UTC would put the event 6h earlier → 2d 20h 15m.
        expect(result.current).not.toEqual({ days: '02', hours: '20', mins: '15', secs: '00' });
    });

    it('is DST-correct for a winter event (7h offset, not 6h)', () => {
        // 2026-01-17T08:30:00 Denver (MST) === 15:30Z. Now = 13:30Z → 2h out.
        vi.setSystemTime(Date.parse('2026-01-17T13:30:00Z'));
        const { result } = renderHook(() => useCountdown('2026-01-17T08:30:00'));
        expect(result.current).toEqual({ days: '00', hours: '02', mins: '00', secs: '00' });
    });

    it('clamps to zero once the event has started', () => {
        vi.setSystemTime(Date.parse('2026-07-25T15:00:00Z')); // 30 min after start
        const { result } = renderHook(() => useCountdown(EVENT_ISO));
        expect(result.current).toEqual({ days: '00', hours: '00', mins: '00', secs: '00' });
    });

    it('still works for an absolute timestamp with an explicit offset', () => {
        // eventInstantMs rejects these (they are already instants); the fallback
        // branch keeps a future caller from silently freezing at zero.
        const { result } = renderHook(() => useCountdown('2026-07-25T14:30:00Z'));
        expect(result.current).toEqual({ days: '03', hours: '02', mins: '15', secs: '00' });
    });

    it('clamps to zero rather than rendering NaN for a malformed target', () => {
        const { result } = renderHook(() => useCountdown('not a date'));
        expect(result.current).toEqual({ days: '00', hours: '00', mins: '00', secs: '00' });
    });

    it('ticks once per second', () => {
        const { result } = renderHook(() => useCountdown(EVENT_ISO));
        expect(result.current.secs).toBe('00');
        // act() so React flushes the setState the interval fires.
        act(() => { vi.advanceTimersByTime(1000); });
        expect(result.current).toEqual({ days: '03', hours: '02', mins: '14', secs: '59' });
    });
});
