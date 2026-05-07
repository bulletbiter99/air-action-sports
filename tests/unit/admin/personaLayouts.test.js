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

    it('owner / generic_manager / staff have concrete widget arrays', () => {
        expect(Array.isArray(PERSONA_LAYOUTS.owner)).toBe(true);
        expect(Array.isArray(PERSONA_LAYOUTS.generic_manager)).toBe(true);
        expect(Array.isArray(PERSONA_LAYOUTS.staff)).toBe(true);
    });

    it('booking_coordinator / marketing / bookkeeper are alias-only (null) until B4c-B4f', () => {
        expect(PERSONA_LAYOUTS.booking_coordinator).toBeNull();
        expect(PERSONA_LAYOUTS.marketing).toBeNull();
        expect(PERSONA_LAYOUTS.bookkeeper).toBeNull();
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

    it('persona=booking_coordinator (alias-only) falls back to role=manager → generic_manager set', () => {
        const layout = resolveLayout({ persona: 'booking_coordinator', role: 'manager' });
        expect(layout).toBe(PERSONA_LAYOUTS.generic_manager);
    });

    it('persona=marketing (alias-only) with role=manager falls back to generic_manager set', () => {
        const layout = resolveLayout({ persona: 'marketing', role: 'manager' });
        expect(layout).toBe(PERSONA_LAYOUTS.generic_manager);
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
