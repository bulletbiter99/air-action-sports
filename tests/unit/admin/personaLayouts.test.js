// M4 B4b — tests for src/admin/personaLayouts.js (rewired for persona).
//
// Pure helper tests; no DOM, no fetch, no D1.

import { describe, it, expect } from 'vitest';
import {
    PERSONA_LAYOUTS,
    resolveLayout,
    roleDerivedDefault,
    personaLabel,
} from '../../../src/admin/personaLayouts.js';

describe('PERSONA_LAYOUTS registry', () => {
    it('has all six persona keys (B4a migration enum)', () => {
        const keys = Object.keys(PERSONA_LAYOUTS);
        expect(keys).toContain('owner');
        expect(keys).toContain('booking_coordinator');
        expect(keys).toContain('marketing');
        expect(keys).toContain('bookkeeper');
        expect(keys).toContain('generic_manager');
        expect(keys).toContain('staff');
    });

    it('owner / generic_manager / staff / booking_coordinator / marketing have concrete widget arrays', () => {
        expect(Array.isArray(PERSONA_LAYOUTS.owner)).toBe(true);
        expect(Array.isArray(PERSONA_LAYOUTS.generic_manager)).toBe(true);
        expect(Array.isArray(PERSONA_LAYOUTS.staff)).toBe(true);
        // M4 B4c — booking_coordinator promoted from alias to concrete set
        expect(Array.isArray(PERSONA_LAYOUTS.booking_coordinator)).toBe(true);
        // M4 B4e — marketing promoted from alias to concrete set
        expect(Array.isArray(PERSONA_LAYOUTS.marketing)).toBe(true);
    });

    it('bookkeeper is the only remaining alias-only persona (null) until B4f', () => {
        expect(PERSONA_LAYOUTS.bookkeeper).toBeNull();
    });

    it('booking_coordinator widget set ships the 5 BC widgets in BC-spec order', () => {
        expect(PERSONA_LAYOUTS.booking_coordinator).toEqual([
            'BookingCoordinatorKPIs',
            'BookingsNeedingAction',
            'TodayCheckIns',
            'QuickActions',
            'RecentFeedback',
        ]);
    });

    it('owner widget set ships the 7-widget M4 B4d order', () => {
        expect(PERSONA_LAYOUTS.owner).toEqual([
            'RevenueSummary',
            'ActionQueue',
            'UpcomingEventsReadiness',
            'TodayEvents',
            'RecentBookings',
            'RecentActivity',
            'CronHealth',
        ]);
    });

    it('marketing widget set ships the 6-widget M4 B4e order (5 new + RecentFeedback reused)', () => {
        expect(PERSONA_LAYOUTS.marketing).toEqual([
            'MarketingKPIs',
            'ConversionFunnel',
            'UpcomingEventsFillRate',
            'PromoCodePerformance',
            'RecentFeedback',
            'AssetLibraryShortcut',
        ]);
    });
});

describe('roleDerivedDefault', () => {
    it('owner role → owner widget set', () => {
        expect(roleDerivedDefault('owner')).toBe(PERSONA_LAYOUTS.owner);
    });

    it('manager role → generic_manager widget set', () => {
        expect(roleDerivedDefault('manager')).toBe(PERSONA_LAYOUTS.generic_manager);
    });

    it('staff role → staff widget set', () => {
        expect(roleDerivedDefault('staff')).toBe(PERSONA_LAYOUTS.staff);
    });

    it('unrecognized role → fallback layout (TodayEvents + RecentBookings)', () => {
        const layout = roleDerivedDefault('admin');
        expect(layout).toEqual(['TodayEvents', 'RecentBookings']);
    });

    it('null/undefined role → fallback layout', () => {
        expect(roleDerivedDefault(null)).toEqual(['TodayEvents', 'RecentBookings']);
        expect(roleDerivedDefault(undefined)).toEqual(['TodayEvents', 'RecentBookings']);
    });
});

describe('resolveLayout', () => {
    it('persona=owner returns the owner widget set', () => {
        const layout = resolveLayout({ persona: 'owner', role: 'owner' });
        expect(layout).toBe(PERSONA_LAYOUTS.owner);
    });

    it('persona=generic_manager returns the manager widget set', () => {
        const layout = resolveLayout({ persona: 'generic_manager', role: 'manager' });
        expect(layout).toBe(PERSONA_LAYOUTS.generic_manager);
    });

    it('persona=staff returns the staff widget set', () => {
        const layout = resolveLayout({ persona: 'staff', role: 'staff' });
        expect(layout).toBe(PERSONA_LAYOUTS.staff);
    });

    it('persona=booking_coordinator returns the dedicated BC widget set (M4 B4c)', () => {
        const layout = resolveLayout({ persona: 'booking_coordinator', role: 'manager' });
        expect(layout).toBe(PERSONA_LAYOUTS.booking_coordinator);
    });

    it('persona=booking_coordinator with role=staff still returns the BC widget set (persona wins over role)', () => {
        // BC persona is decoupled from role per D08; even if a staff-role
        // user is set to BC persona, they get the BC widgets.
        const layout = resolveLayout({ persona: 'booking_coordinator', role: 'staff' });
        expect(layout).toBe(PERSONA_LAYOUTS.booking_coordinator);
    });

    it('persona=marketing returns the dedicated Marketing widget set (M4 B4e)', () => {
        const layout = resolveLayout({ persona: 'marketing', role: 'manager' });
        expect(layout).toBe(PERSONA_LAYOUTS.marketing);
    });

    it('persona=marketing with role=staff still returns the Marketing widget set (persona wins)', () => {
        const layout = resolveLayout({ persona: 'marketing', role: 'staff' });
        expect(layout).toBe(PERSONA_LAYOUTS.marketing);
    });

    it('persona=bookkeeper (alias-only) with role=owner falls back to owner set', () => {
        // E.g., an owner who set persona='bookkeeper' before B4f ships
        // bookkeeper widgets — they see the existing owner widgets.
        const layout = resolveLayout({ persona: 'bookkeeper', role: 'owner' });
        expect(layout).toBe(PERSONA_LAYOUTS.owner);
    });

    it('persona=null (B4a-pre-backfill or new user) falls back to role-derived default', () => {
        expect(resolveLayout({ persona: null, role: 'manager' })).toBe(
            PERSONA_LAYOUTS.generic_manager,
        );
        expect(resolveLayout({ persona: null, role: 'owner' })).toBe(
            PERSONA_LAYOUTS.owner,
        );
    });

    it('persona unrecognized (e.g., a future enum value before code update) falls back to role-derived', () => {
        const layout = resolveLayout({ persona: 'future_persona', role: 'staff' });
        expect(layout).toBe(PERSONA_LAYOUTS.staff);
    });

    it('persona=null AND role=unknown → FALLBACK_LAYOUT (defensive)', () => {
        expect(resolveLayout({ persona: null, role: 'unknown' })).toEqual(
            ['TodayEvents', 'RecentBookings'],
        );
    });

    it('null user → FALLBACK_LAYOUT', () => {
        expect(resolveLayout(null)).toEqual(['TodayEvents', 'RecentBookings']);
    });

    it('undefined user → FALLBACK_LAYOUT', () => {
        expect(resolveLayout(undefined)).toEqual(['TodayEvents', 'RecentBookings']);
    });
});

describe('personaLabel', () => {
    it('returns "Owner view" for persona=owner', () => {
        expect(personaLabel('owner')).toBe('Owner view');
    });

    it('returns "Booking coordinator view" for persona=booking_coordinator', () => {
        expect(personaLabel('booking_coordinator')).toBe('Booking coordinator view');
    });

    it('returns "Marketing view" for persona=marketing', () => {
        expect(personaLabel('marketing')).toBe('Marketing view');
    });

    it('returns "Bookkeeper view" for persona=bookkeeper', () => {
        expect(personaLabel('bookkeeper')).toBe('Bookkeeper view');
    });

    it('returns "Manager view" for persona=generic_manager', () => {
        expect(personaLabel('generic_manager')).toBe('Manager view');
    });

    it('returns "Staff view" for persona=staff', () => {
        expect(personaLabel('staff')).toBe('Staff view');
    });

    it('legacy role compat: returns "Manager view" for role=manager (pre-B4b callers)', () => {
        expect(personaLabel('manager')).toBe('Manager view');
    });

    it('returns "Default view" for null / undefined / unrecognized', () => {
        expect(personaLabel(null)).toBe('Default view');
        expect(personaLabel(undefined)).toBe('Default view');
        expect(personaLabel('xyz')).toBe('Default view');
    });
});
