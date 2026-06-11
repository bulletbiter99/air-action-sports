// M6 B4 — admin preview-with-real-data helper.
// Verifies TEMPLATE_SPECS surface, entity fetch dispatch, and the per-template
// var builders. The var builders mirror the four senders in worker/lib/emailSender.js
// (Critical DNT) — these tests are how we catch any future divergence.

import { describe, it, expect } from 'vitest';
import {
    TEMPLATE_SPECS,
    getSpecForSlug,
    supportedSlugs,
    fetchEntityForPreview,
    buildVarsFromEntity,
} from '../../../worker/lib/emailTemplatePreview.js';
import { createMockD1 } from '../../helpers/mockD1.js';

const NOW = 1700000000000;
const ENV = { SITE_URL: 'https://airactionsport.com' };

function mockBooking(extra = {}) {
    return {
        id: 'bk_test_001',
        event_id: 'evt_op_nightfall',
        full_name: 'Sarah Connor',
        email: 'sarah@example.com',
        phone: '+1 555 0199',
        player_count: 4,
        total_cents: 32000,
        ...extra,
    };
}

function mockEvent(extra = {}) {
    return {
        id: 'evt_op_nightfall',
        title: 'Operation Nightfall',
        display_date: '9 May 2026',
        location: 'Ghost Town — Hiawatha UT',
        check_in: '6:30 AM – 8:00 AM',
        first_game: '8:30 AM',
        ...extra,
    };
}

function mockAttendee(slug = 'at_1', extra = {}) {
    return { id: slug, booking_id: 'bk_test_001', waiver_id: null, ...extra };
}

// ────────────────────────────────────────────────────────────────────
// TEMPLATE_SPECS constant
// ────────────────────────────────────────────────────────────────────

describe('TEMPLATE_SPECS', () => {
    it('covers the four booking-flavored templates targeted in B4 v1', () => {
        expect(Object.keys(TEMPLATE_SPECS).sort()).toEqual([
            'admin_notify',
            'booking_confirmation',
            'event_reminder_1hr',
            'event_reminder_24h',
        ]);
    });

    it('all specs share the booking kind + bookingId query param', () => {
        for (const [slug, spec] of Object.entries(TEMPLATE_SPECS)) {
            expect(spec.kind).toBe('booking');
            expect(spec.queryParam).toBe('bookingId');
            expect(typeof spec.buildVars).toBe('function');
        }
    });

    it('is frozen — cannot be mutated by callers', () => {
        expect(Object.isFrozen(TEMPLATE_SPECS)).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────
// getSpecForSlug
// ────────────────────────────────────────────────────────────────────

describe('getSpecForSlug', () => {
    it('returns the spec object for a supported slug', () => {
        const spec = getSpecForSlug('booking_confirmation');
        expect(spec).toBeDefined();
        expect(spec.kind).toBe('booking');
    });

    it('returns null for an unsupported slug', () => {
        expect(getSpecForSlug('waiver_request')).toBeNull();
        expect(getSpecForSlug('password_reset')).toBeNull();
        expect(getSpecForSlug('coi_alert_7d')).toBeNull();
    });

    it('returns null for null/undefined/empty input', () => {
        expect(getSpecForSlug(null)).toBeNull();
        expect(getSpecForSlug(undefined)).toBeNull();
        expect(getSpecForSlug('')).toBeNull();
    });
});

describe('supportedSlugs', () => {
    it('returns the four supported slugs in stable order', () => {
        expect(supportedSlugs()).toEqual([
            'booking_confirmation',
            'admin_notify',
            'event_reminder_24h',
            'event_reminder_1hr',
        ]);
    });
});

// ────────────────────────────────────────────────────────────────────
// fetchEntityForPreview
// ────────────────────────────────────────────────────────────────────

describe('fetchEntityForPreview — success', () => {
    it('returns booking + event + attendees for a valid booking ID', async () => {
        const db = createMockD1();
        db.__on(/FROM bookings WHERE id = \?/, mockBooking(), 'first');
        db.__on(/FROM events WHERE id = \?/, mockEvent(), 'first');
        db.__on(/FROM attendees WHERE booking_id = \?/, {
            results: [mockAttendee('at_1', { waiver_id: 'wv_1' }), mockAttendee('at_2')],
        }, 'all');

        const result = await fetchEntityForPreview({ DB: db }, 'booking_confirmation', 'bk_test_001');
        expect(result.error).toBeUndefined();
        expect(result.entity.booking.id).toBe('bk_test_001');
        expect(result.entity.event.id).toBe('evt_op_nightfall');
        expect(result.entity.attendees).toHaveLength(2);
    });

    it('handles empty attendees array gracefully', async () => {
        const db = createMockD1();
        db.__on(/FROM bookings/, mockBooking(), 'first');
        db.__on(/FROM events/, mockEvent(), 'first');
        // No attendees handler registered → mockD1 default returns { results: [] }

        const result = await fetchEntityForPreview({ DB: db }, 'admin_notify', 'bk_test_001');
        expect(result.error).toBeUndefined();
        expect(result.entity.attendees).toEqual([]);
    });

    it('trims surrounding whitespace from the ID', async () => {
        const db = createMockD1();
        db.__on(/FROM bookings/, mockBooking(), 'first');
        db.__on(/FROM events/, mockEvent(), 'first');

        const result = await fetchEntityForPreview({ DB: db }, 'booking_confirmation', '  bk_test_001  ');
        expect(result.error).toBeUndefined();
        const writes = db.__writes();
        const bookingQuery = writes.find((w) => /FROM bookings WHERE id = \?/.test(w.sql));
        expect(bookingQuery.args).toEqual(['bk_test_001']);
    });
});

describe('fetchEntityForPreview — errors', () => {
    it('returns unknown_template_slug for unsupported templates', async () => {
        const db = createMockD1();
        const result = await fetchEntityForPreview({ DB: db }, 'password_reset', 'u_1');
        expect(result).toEqual({ error: 'unknown_template_slug' });
        // Should not hit DB at all
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns missing_entity_id for empty / null / undefined / non-string id', async () => {
        const db = createMockD1();
        for (const bad of [null, undefined, '', '   ', 0, {}]) {
            const result = await fetchEntityForPreview({ DB: db }, 'booking_confirmation', bad);
            expect(result.error).toBe('missing_entity_id');
        }
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns booking_not_found when booking SELECT returns null', async () => {
        const db = createMockD1();
        // No handler → first() returns null

        const result = await fetchEntityForPreview({ DB: db }, 'booking_confirmation', 'bk_missing');
        expect(result).toEqual({ error: 'booking_not_found' });

        // Should have stopped after the booking query — no event SELECT issued
        const writes = db.__writes();
        expect(writes.some((w) => /FROM events/.test(w.sql))).toBe(false);
    });

    it('returns event_not_found when booking exists but event is dangling', async () => {
        const db = createMockD1();
        db.__on(/FROM bookings/, mockBooking(), 'first');
        // No event handler → first() returns null

        const result = await fetchEntityForPreview({ DB: db }, 'booking_confirmation', 'bk_test_001');
        expect(result).toEqual({ error: 'event_not_found' });
    });
});

// ────────────────────────────────────────────────────────────────────
// buildVarsFromEntity — per-template var construction
// ────────────────────────────────────────────────────────────────────

describe('buildVarsFromEntity — booking_confirmation', () => {
    it('produces the canonical var shape with all-signed waiver summary', () => {
        const vars = buildVarsFromEntity(
            'booking_confirmation',
            {
                booking: mockBooking(),
                event: mockEvent(),
                attendees: [mockAttendee('at_1', { waiver_id: 'wv_1' }), mockAttendee('at_2', { waiver_id: 'wv_2' })],
            },
            ENV
        );

        expect(vars).toEqual({
            player_name: 'Sarah Connor',
            event_name: 'Operation Nightfall',
            event_date: '9 May 2026',
            event_location: 'Ghost Town — Hiawatha UT',
            player_count: 4,
            total_paid: '320.00',
            booking_id: 'bk_test_001',
            waiver_link: 'https://airactionsport.com/booking/success?token=bk_test_001',
            waiver_summary: "All 2 players already have a valid waiver on file — you're cleared for game day, nothing to sign.",
        });
    });

    it('produces partial-signed waiver summary when some attendees unsigned', () => {
        const vars = buildVarsFromEntity(
            'booking_confirmation',
            {
                booking: mockBooking(),
                event: mockEvent(),
                attendees: [mockAttendee('at_1', { waiver_id: 'wv_1' }), mockAttendee('at_2')],
            },
            ENV
        );
        expect(vars.waiver_summary).toContain('1 of 2 players already have');
        expect(vars.waiver_summary).toContain('The remaining 1 player needs');
    });

    it('produces "every player needs to sign" when none signed', () => {
        const vars = buildVarsFromEntity(
            'booking_confirmation',
            {
                booking: mockBooking(),
                event: mockEvent(),
                attendees: [mockAttendee('at_1'), mockAttendee('at_2')],
            },
            ENV
        );
        expect(vars.waiver_summary).toBe('Every player needs to sign a waiver before gameplay.');
    });

    it('handles single-player phrasing in waiver_summary', () => {
        const vars = buildVarsFromEntity(
            'booking_confirmation',
            {
                booking: mockBooking(),
                event: mockEvent(),
                attendees: [mockAttendee('at_1', { waiver_id: 'wv_1' })],
            },
            ENV
        );
        // Deliberate copy change (2026-06-11): was "All 1 player already have
        // a valid waiver on file" — awkward singular grammar in a customer
        // email. Both mirrors (emailSender + emailTemplatePreview) updated.
        expect(vars.waiver_summary).toBe(
            "Your player's waiver is already on file — you're cleared for game day, nothing to sign."
        );
    });

    it('handles empty attendees with fallback summary', () => {
        const vars = buildVarsFromEntity(
            'booking_confirmation',
            { booking: mockBooking(), event: mockEvent(), attendees: [] },
            ENV
        );
        expect(vars.waiver_summary).toBe('Every player needs to sign a waiver before gameplay.');
    });
});

describe('buildVarsFromEntity — admin_notify', () => {
    it('produces the canonical admin notification var shape', () => {
        const vars = buildVarsFromEntity(
            'admin_notify',
            { booking: mockBooking(), event: mockEvent(), attendees: [] },
            ENV
        );
        expect(vars).toEqual({
            event_name: 'Operation Nightfall',
            player_name: 'Sarah Connor',
            player_email: 'sarah@example.com',
            player_phone: '+1 555 0199',
            player_count: 4,
            total_paid: '320.00',
            booking_id: 'bk_test_001',
            admin_link: 'https://airactionsport.com/admin/bookings/bk_test_001',
        });
    });
});

describe('buildVarsFromEntity — event reminders', () => {
    it('event_reminder_24h produces the reminder var shape', () => {
        const vars = buildVarsFromEntity(
            'event_reminder_24h',
            { booking: mockBooking(), event: mockEvent(), attendees: [] },
            ENV
        );
        expect(vars).toEqual({
            player_name: 'Sarah Connor',
            event_name: 'Operation Nightfall',
            event_date: '9 May 2026',
            event_location: 'Ghost Town — Hiawatha UT',
            check_in: '6:30 AM – 8:00 AM',
            first_game: '8:30 AM',
            waiver_link: 'https://airactionsport.com/booking/success?token=bk_test_001',
            booking_id: 'bk_test_001',
        });
    });

    it('event_reminder_1hr uses the same builder (same var shape)', () => {
        const vars24 = buildVarsFromEntity(
            'event_reminder_24h',
            { booking: mockBooking(), event: mockEvent(), attendees: [] },
            ENV
        );
        const vars1 = buildVarsFromEntity(
            'event_reminder_1hr',
            { booking: mockBooking(), event: mockEvent(), attendees: [] },
            ENV
        );
        expect(vars1).toEqual(vars24);
    });

    it('falls back to "See event page" when check_in / first_game are missing', () => {
        const vars = buildVarsFromEntity(
            'event_reminder_24h',
            {
                booking: mockBooking(),
                event: mockEvent({ check_in: null, first_game: null }),
                attendees: [],
            },
            ENV
        );
        expect(vars.check_in).toBe('See event page');
        expect(vars.first_game).toBe('See event page');
    });
});

describe('buildVarsFromEntity — edge cases', () => {
    it('returns {} for unsupported slug', () => {
        const vars = buildVarsFromEntity('waiver_request', { booking: {}, event: {}, attendees: [] }, ENV);
        expect(vars).toEqual({});
    });

    it('returns {} when entity is null', () => {
        expect(buildVarsFromEntity('booking_confirmation', null, ENV)).toEqual({});
    });

    it('SITE_URL falls back to production default when env.SITE_URL missing', () => {
        const vars = buildVarsFromEntity(
            'booking_confirmation',
            { booking: mockBooking(), event: mockEvent(), attendees: [] },
            {}
        );
        expect(vars.waiver_link).toBe('https://airactionsport.com/booking/success?token=bk_test_001');
    });

    it('money helper formats null/undefined cents as "0.00"', () => {
        const vars = buildVarsFromEntity(
            'booking_confirmation',
            {
                booking: mockBooking({ total_cents: null }),
                event: mockEvent(),
                attendees: [],
            },
            ENV
        );
        expect(vars.total_paid).toBe('0.00');
    });
});
