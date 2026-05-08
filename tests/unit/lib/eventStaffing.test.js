// M5 R9 — pure helper tests for worker/lib/eventStaffing.js.
// I/O wrapper tests (sweep + auto-decline) live in
// tests/unit/cron/event-staffing-reminder-sweep.test.js.

import { describe, it, expect } from 'vitest';
import {
    hoursUntilEvent,
    isPastEvent,
    windowLabelForReminder,
    templateSlugForWindow,
} from '../../../worker/lib/eventStaffing.js';

const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;

describe('hoursUntilEvent', () => {
    it('returns null for null/undefined start', () => {
        expect(hoursUntilEvent(null, NOW)).toBeNull();
        expect(hoursUntilEvent(undefined, NOW)).toBeNull();
    });

    it('returns positive hours for future events', () => {
        expect(hoursUntilEvent(NOW + 5 * HOUR, NOW)).toBe(5);
        expect(hoursUntilEvent(NOW + 100 * HOUR, NOW)).toBe(100);
    });

    it('returns negative hours for past events', () => {
        expect(hoursUntilEvent(NOW - 1 * HOUR, NOW)).toBe(-1);
    });

    it('returns 0 for events starting exactly now', () => {
        expect(hoursUntilEvent(NOW, NOW)).toBe(0);
    });
});

describe('isPastEvent', () => {
    it('returns false for null/undefined', () => {
        expect(isPastEvent(null, NOW)).toBe(false);
        expect(isPastEvent(undefined, NOW)).toBe(false);
    });

    it('returns true for events that have started', () => {
        expect(isPastEvent(NOW - HOUR, NOW)).toBe(true);
    });

    it('returns false for events still in the future', () => {
        expect(isPastEvent(NOW + HOUR, NOW)).toBe(false);
    });

    it('treats exactly-now as not-past (use > not >=)', () => {
        expect(isPastEvent(NOW, NOW)).toBe(false);
    });
});

describe('windowLabelForReminder', () => {
    it('returns null for null hours', () => {
        expect(windowLabelForReminder(null)).toBeNull();
        expect(windowLabelForReminder(undefined)).toBeNull();
    });

    it('returns null for past events (negative or zero hours)', () => {
        expect(windowLabelForReminder(-1)).toBeNull();
        expect(windowLabelForReminder(0)).toBeNull();
    });

    it('returns "day_of" for 0 < hours <= 12', () => {
        expect(windowLabelForReminder(1)).toBe('day_of');
        expect(windowLabelForReminder(6)).toBe('day_of');
        expect(windowLabelForReminder(12)).toBe('day_of');
    });

    it('returns "1d" for 12 < hours <= 48', () => {
        expect(windowLabelForReminder(13)).toBe('1d');
        expect(windowLabelForReminder(24)).toBe('1d');
        expect(windowLabelForReminder(48)).toBe('1d');
    });

    it('returns "3d" for 48 < hours <= 96', () => {
        expect(windowLabelForReminder(49)).toBe('3d');
        expect(windowLabelForReminder(72)).toBe('3d');
        expect(windowLabelForReminder(96)).toBe('3d');
    });

    it('returns "7d" for 96 < hours <= 168', () => {
        expect(windowLabelForReminder(97)).toBe('7d');
        expect(windowLabelForReminder(120)).toBe('7d');
        expect(windowLabelForReminder(168)).toBe('7d');
    });

    it('returns null for events more than 7 days out', () => {
        expect(windowLabelForReminder(169)).toBeNull();
        expect(windowLabelForReminder(720)).toBeNull(); // 30 days
    });
});

describe('templateSlugForWindow', () => {
    it('maps all known windows to "event_staff_reminder"', () => {
        expect(templateSlugForWindow('7d')).toBe('event_staff_reminder');
        expect(templateSlugForWindow('3d')).toBe('event_staff_reminder');
        expect(templateSlugForWindow('1d')).toBe('event_staff_reminder');
        expect(templateSlugForWindow('day_of')).toBe('event_staff_reminder');
    });

    it('returns null for unknown windows', () => {
        expect(templateSlugForWindow('14d')).toBeNull();
        expect(templateSlugForWindow(null)).toBeNull();
        expect(templateSlugForWindow('')).toBeNull();
    });
});
