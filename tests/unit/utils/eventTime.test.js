// Dual-target parity suite for the eventTime mirror.
//
// src/utils/eventTime.js and worker/lib/eventTime.js are duplicated by necessity
// (Vite bundles src/ for the SPA and must not reach into worker/, which would
// couple every visitor's bundle to a gated file on the Critical reminder-cron
// path). Same convention as src/utils/money.js + worker/lib/money.js.
//
// This file is the ANTI-DRIFT MECHANISM: it imports BOTH and runs the identical
// suite against each, so the two cannot diverge silently. Only the SHARED subset
// is asserted — denverWallClockWindow / eventStartsWithin are worker-only and
// are covered by tests/unit/lib/eventTime.test.js.

import { describe, it, expect } from 'vitest';
import * as clientEventTime from '../../../src/utils/eventTime.js';
import * as workerEventTime from '../../../worker/lib/eventTime.js';

const H = 60 * 60 * 1000;

const targets = [
    { name: 'src/utils/eventTime.js', mod: clientEventTime },
    { name: 'worker/lib/eventTime.js', mod: workerEventTime },
];

for (const { name, mod } of targets) {
    describe(`${name} — eventInstantMs`, () => {
        it('resolves an MDT (summer) event', () => {
            expect(mod.eventInstantMs('2026-07-25T08:30:00')).toBe(Date.parse('2026-07-25T14:30:00Z'));
        });

        it('resolves an MST (winter) event — 7h, not 6h', () => {
            expect(mod.eventInstantMs('2026-01-17T08:30:00')).toBe(Date.parse('2026-01-17T15:30:00Z'));
            const naive = Date.parse('2026-01-17T08:30:00Z');
            expect(mod.eventInstantMs('2026-01-17T08:30:00') - naive).toBe(7 * H);
        });

        it('handles both 2026 DST transitions', () => {
            expect(mod.eventInstantMs('2026-03-08T01:59:00')).toBe(Date.parse('2026-03-08T08:59:00Z'));
            expect(mod.eventInstantMs('2026-03-08T03:00:00')).toBe(Date.parse('2026-03-08T09:00:00Z'));
            expect(mod.eventInstantMs('2026-11-01T00:30:00')).toBe(Date.parse('2026-11-01T06:30:00Z'));
            expect(mod.eventInstantMs('2026-11-01T03:30:00')).toBe(Date.parse('2026-11-01T10:30:00Z'));
        });

        it('treats a date-only value as midnight Denver', () => {
            expect(mod.eventInstantMs('2026-07-25')).toBe(Date.parse('2026-07-25T06:00:00Z'));
        });

        it('accepts a 16-char value and a space separator', () => {
            expect(mod.eventInstantMs('2026-07-25T08:30')).toBe(Date.parse('2026-07-25T14:30:00Z'));
            expect(mod.eventInstantMs('2026-07-25 08:30:00')).toBe(Date.parse('2026-07-25T14:30:00Z'));
        });

        it('handles midnight without the ICU hour-24 off-by-a-day', () => {
            expect(mod.eventInstantMs('2026-07-25T00:00:00')).toBe(Date.parse('2026-07-25T06:00:00Z'));
        });

        it.each([
            [''], [null], [undefined], ['nonsense'],
            ['2026-13-99'], ['2026-02-30'], ['2026-04-31'],
            ['2026-07-25T25:00:00'], ['2026-07-25T08:61:00'],
            ['2026-07-25T08:30:00Z'], ['2026-07-25T08:30:00-06:00'],
        ])('returns null for %s', (value) => {
            expect(mod.eventInstantMs(value)).toBeNull();
        });
    });

    describe(`${name} — denverWallClockToUtcMs`, () => {
        it('defaults to midnight and takes a 1-based month', () => {
            expect(mod.denverWallClockToUtcMs(2026, 7, 25)).toBe(Date.parse('2026-07-25T06:00:00Z'));
            expect(mod.denverWallClockToUtcMs(2026, 1, 17, 8, 30, 0)).toBe(Date.parse('2026-01-17T15:30:00Z'));
        });
    });

    describe(`${name} — denverDateFor`, () => {
        it('returns the Denver calendar date, not the UTC one', () => {
            // 01:00Z on Jul 26 is still 19:00 on Jul 25 in Denver. This is the
            // 6-hour band where every `toISOString().slice(0,10)` in the codebase
            // silently reports tomorrow.
            expect(mod.denverDateFor(Date.parse('2026-07-26T01:00:00Z'))).toBe('2026-07-25');
            expect(new Date(Date.parse('2026-07-26T01:00:00Z')).toISOString().slice(0, 10)).toBe('2026-07-26');
        });

        it('agrees with UTC during the day', () => {
            expect(mod.denverDateFor(Date.parse('2026-07-25T18:00:00Z'))).toBe('2026-07-25');
        });

        it('handles the MST band too (7h offset)', () => {
            expect(mod.denverDateFor(Date.parse('2026-01-18T05:00:00Z'))).toBe('2026-01-17');
        });

        it('returns null for a non-finite input', () => {
            expect(mod.denverDateFor(NaN)).toBeNull();
        });
    });
}

// Guard against one mirror gaining a shared export the other lacks.
describe('mirror parity', () => {
    it.each(['eventInstantMs', 'denverWallClockToUtcMs', 'denverDateFor'])(
        'both modules export %s',
        (fn) => {
            expect(typeof clientEventTime[fn]).toBe('function');
            expect(typeof workerEventTime[fn]).toBe('function');
        },
    );

    it('produces byte-identical results across a spread of inputs', () => {
        for (const iso of [
            '2026-07-25T08:30:00', '2026-01-17T08:30:00', '2026-03-08T02:30:00',
            '2026-11-01T01:30:00', '2026-07-25', '2026-12-31T23:59:59', 'garbage', '',
        ]) {
            expect(clientEventTime.eventInstantMs(iso)).toBe(workerEventTime.eventInstantMs(iso));
        }
        for (const ms of [0, Date.parse('2026-07-26T01:00:00Z'), Date.parse('2026-01-18T05:00:00Z')]) {
            expect(clientEventTime.denverDateFor(ms)).toBe(workerEventTime.denverDateFor(ms));
        }
    });
});
