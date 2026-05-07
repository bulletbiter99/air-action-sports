// M4 B4b — tests for src/hooks/useWidgetData.js.
//
// Targets the pure helper `intervalForTier` directly (matches how
// useFilterState.test.js targets its encode/parse helpers — the React
// hook itself isn't testable without RTL, and this test surface
// captures the cadence rule that's the actual behavior contract).
//
// Cadence rule (per docs/m4-discovery/persona-dashboard-audit.md):
//   tier='static'              → null (no polling)
//   tier='live' default        → 5min (300_000 ms)
//   tier='live' + active event → 30s (30_000 ms)
//   tier='live' + check-in     → 10s (10_000 ms)

import { describe, it, expect } from 'vitest';
import { intervalForTier } from '../../../src/hooks/useWidgetData.js';

describe('intervalForTier — cadence rule', () => {
    describe('tier=static — never polls', () => {
        it('returns null with no today state', () => {
            expect(intervalForTier('static', null)).toBe(null);
        });

        it('returns null with active event today (static doesn\'t promote)', () => {
            expect(intervalForTier('static', { activeEventToday: true })).toBe(null);
        });

        it('returns null with check-in open (static never goes live)', () => {
            expect(intervalForTier('static', { checkInOpen: true })).toBe(null);
        });
    });

    describe('tier=live — base 5min default', () => {
        it('returns 300_000 ms (5min) with no today state', () => {
            expect(intervalForTier('live', null)).toBe(300_000);
        });

        it('returns 5min when /today/active says no active event', () => {
            const today = { activeEventToday: false, checkInOpen: false };
            expect(intervalForTier('live', today)).toBe(300_000);
        });

        it('returns 5min when /today/active result is undefined (default safety)', () => {
            expect(intervalForTier('live', undefined)).toBe(300_000);
        });
    });

    describe('tier=live — promotes to 30s on event day', () => {
        it('returns 30_000 ms when activeEventToday=true', () => {
            const today = { activeEventToday: true, checkInOpen: false };
            expect(intervalForTier('live', today)).toBe(30_000);
        });

        it('returns 30s even with eventId=null (multi-event today)', () => {
            const today = { activeEventToday: true, eventId: null, checkInOpen: false };
            expect(intervalForTier('live', today)).toBe(30_000);
        });
    });

    describe('tier=live — promotes to 10s during check-in', () => {
        it('returns 10_000 ms when checkInOpen=true', () => {
            const today = { activeEventToday: true, checkInOpen: true };
            expect(intervalForTier('live', today)).toBe(10_000);
        });

        it('check-in tier wins over event-day tier', () => {
            // checkInOpen implies activeEventToday in the real endpoint, but
            // defensively: even if both are true the rule picks 10s, not 30s.
            const today = { activeEventToday: true, checkInOpen: true };
            expect(intervalForTier('live', today)).toBe(10_000);
        });

        it('checkInOpen=true alone (no activeEventToday) still picks 10s — the field is the trump signal', () => {
            const today = { activeEventToday: false, checkInOpen: true };
            expect(intervalForTier('live', today)).toBe(10_000);
        });
    });

    describe('unknown tier values', () => {
        it('returns null for unrecognized tier (e.g., "background")', () => {
            expect(intervalForTier('background', { activeEventToday: true })).toBe(null);
        });

        it('returns null for empty string tier', () => {
            expect(intervalForTier('', null)).toBe(null);
        });

        it('returns null for undefined tier', () => {
            expect(intervalForTier(undefined, null)).toBe(null);
        });
    });
});
