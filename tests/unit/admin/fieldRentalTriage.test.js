// C2 (2026-07-27) — field-rental triage helpers.
//
// Covers the pure helpers behind the detail page's new Edit / Reschedule
// affordances, plus the datetime-local round trip that was silently shifting
// schedules by the UTC offset on every edit.

import { describe, it, expect } from 'vitest';
import { toDateTimeLocal } from '../../../src/admin/AdminFieldRentalNew.jsx';
import {
    allowedNextStatuses,
    selectableNextStatuses,
    ENGAGEMENT_TYPES,
} from '../../../src/admin/AdminFieldRentalDetail.jsx';
import { FIELD_RENTAL_ENGAGEMENT_TYPES } from '../../../worker/lib/fieldRentals.js';

describe('toDateTimeLocal — datetime-local round trip', () => {
    // THE bug: the wizard displayed with toISOString().slice(0, 16) (UTC) while
    // the input's onChange parsed with new Date(value) (LOCAL). The field
    // therefore rendered the stored instant shifted by the offset, and touching
    // it re-parsed that shifted wall clock as local — moving the real instant
    // by the offset AGAIN. Times visibly jumped on every edit.
    it('round-trips an instant exactly through the input value', () => {
        const ms = new Date(2026, 6, 25, 19, 45).getTime(); // local 7:45 PM
        const value = toDateTimeLocal(ms);
        // This is precisely what the input's onChange does.
        expect(new Date(value).getTime()).toBe(ms);
    });

    it('round-trips across many instants, including both DST sides', () => {
        const samples = [
            new Date(2026, 0, 15, 9, 0),    // January — MST
            new Date(2026, 6, 25, 19, 45),  // July — MDT
            new Date(2026, 2, 8, 13, 30),   // US spring-forward day
            new Date(2026, 10, 1, 13, 30),  // US fall-back day
            new Date(2026, 11, 31, 23, 59),
        ];
        for (const d of samples) {
            const ms = d.getTime();
            expect(new Date(toDateTimeLocal(ms)).getTime(), d.toString()).toBe(ms);
        }
    });

    it('emits the exact YYYY-MM-DDTHH:mm shape the input requires, zero-padded', () => {
        const ms = new Date(2026, 0, 5, 8, 7).getTime();
        expect(toDateTimeLocal(ms)).toBe('2026-01-05T08:07');
    });

    it('would NOT round-trip with the old UTC formatter, unless the runner is UTC', () => {
        // Guards against someone "simplifying" back to toISOString().
        const ms = new Date(2026, 6, 25, 19, 45).getTime();
        const utcValue = new Date(ms).toISOString().slice(0, 16);
        const offsetMinutes = new Date(ms).getTimezoneOffset();
        if (offsetMinutes !== 0) {
            expect(new Date(utcValue).getTime()).not.toBe(ms);
        }
        // ...and the local formatter round-trips regardless of runner zone.
        expect(new Date(toDateTimeLocal(ms)).getTime()).toBe(ms);
    });

    it('returns an empty string for an unusable value rather than "Invalid Date"', () => {
        expect(toDateTimeLocal(NaN)).toBe('');
        expect(toDateTimeLocal(undefined)).toBe('');
    });
});

describe('selectableNextStatuses', () => {
    // allowedNextStatuses mirrors the server's STATUS_TRANSITIONS data map and
    // must keep doing so (its own test pins that). But POST /:id/status
    // special-cases `to === 'refunded'` and 400s BEFORE consulting the map, so
    // offering it only ever produced an error the operator could not act on.
    it('never offers refunded, from any status', () => {
        for (const from of ['lead', 'draft', 'sent', 'agreed', 'paid', 'completed', 'cancelled', 'refunded']) {
            expect(selectableNextStatuses(from), from).not.toContain('refunded');
        }
    });

    it('is otherwise identical to the server mirror', () => {
        for (const from of ['lead', 'draft', 'sent', 'agreed', 'paid', 'completed', 'cancelled', 'refunded']) {
            expect(selectableNextStatuses(from)).toEqual(
                allowedNextStatuses(from).filter((s) => s !== 'refunded'),
            );
        }
    });

    it('leaves the ordinary forward path intact', () => {
        expect(selectableNextStatuses('lead')).toEqual(['draft', 'cancelled']);
        expect(selectableNextStatuses('agreed')).toEqual(['paid', 'sent', 'cancelled']);
        expect(selectableNextStatuses('paid')).toEqual(['completed']);
    });

    it('yields nothing for statuses whose only server transition was refunded', () => {
        // The "Change status" button hides itself on an empty list, which is
        // the correct outcome — these are dead ends by design.
        expect(selectableNextStatuses('completed')).toEqual([]);
        expect(selectableNextStatuses('cancelled')).toEqual([]);
    });
});

describe('ENGAGEMENT_TYPES', () => {
    // The edit modal writes engagement_type straight through to a
    // CHECK-constrained column. A value the server does not know would 400 on
    // save — and the first draft of this modal had exactly that bug
    // ('private_hire', 'league'), caught only by comparing against the server.
    it('matches the server list exactly, in the same order', () => {
        expect(ENGAGEMENT_TYPES.map((t) => t.value)).toEqual(FIELD_RENTAL_ENGAGEMENT_TYPES);
    });

    it('gives every value a human label', () => {
        for (const t of ENGAGEMENT_TYPES) {
            expect(t.label, t.value).toBeTruthy();
            expect(t.label).not.toContain('_');
        }
    });
});
