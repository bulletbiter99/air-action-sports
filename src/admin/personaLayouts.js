// M3 Batch 9 — persona layouts for the new AdminDashboard.
// M4 B4b — rewired to read user.persona (decoupled from role per D08).
//
// Maps user.persona → ordered list of widget keys. The persona shell
// (src/admin/AdminDashboardPersona.jsx) iterates the resolved layout
// and renders the corresponding widget from src/admin/widgets/PersonaWidgets.jsx.
//
// Persona model (per migration 0028 + decision D08):
//   - 6 persona enum values: owner / booking_coordinator / marketing /
//     bookkeeper / generic_manager / staff
//   - Persona is a "lens preference" decoupled from role. Capability
//     gating still uses role; widget selection uses persona.
//   - Existing rows backfilled in B4a: owner→owner, manager→generic_manager,
//     staff→staff. New users created between B4a and a future "persona
//     selection at user-create time" batch will have persona=NULL —
//     resolveLayout falls back to roleDerivedDefault(role) gracefully.
//
// Widget set status:
//   - owner: M3 widget set (RevenueSummary, CronHealth, TodayEvents,
//     RecentBookings). Owner extension widgets (UpcomingEventsReadiness,
//     ActionQueue, RecentActivity) ship in M4 B4d.
//   - generic_manager: M3 manager widget set (TodayEvents, RecentBookings,
//     CronHealth).
//   - staff: M3 staff widget set (TodayEvents, RecentBookings).
//   - booking_coordinator / marketing / bookkeeper: until B4c-B4f ship
//     dedicated widget sets, alias-map to roleDerivedDefault — so a
//     manager who picked persona='booking_coordinator' before B4c sees
//     the same widgets as a generic_manager would.

export const PERSONA_LAYOUTS = {
    // M4 B4d — Owner persona extended from 4 to 7 widgets. Order:
    // financial top → action items → forward-looking → today's ops →
    // context → system pulse.
    owner: [
        'RevenueSummary',
        'ActionQueue',
        'UpcomingEventsReadiness',
        'TodayEvents',
        'RecentBookings',
        'RecentActivity',
        'CronHealth',
    ],
    generic_manager: ['TodayEvents', 'RecentBookings', 'CronHealth'],
    staff: ['TodayEvents', 'RecentBookings'],
    // M4 B4c — Booking Coordinator widget set ships in this batch.
    booking_coordinator: [
        'BookingCoordinatorKPIs',
        'BookingsNeedingAction',
        'TodayCheckIns',
        'QuickActions',
        'RecentFeedback',
    ],
    // Personas without dedicated widget sets yet — alias to a role-derived
    // default in resolveLayout(). Listed here for self-documentation +
    // personaLabel coverage.
    marketing: null,
    bookkeeper: null,
};

const FALLBACK_LAYOUT = ['TodayEvents', 'RecentBookings'];

// Maps a user role to the persona key whose layout best approximates
// that role's needs when no specific persona has been selected.
//
// Used by resolveLayout when:
//   - user.persona is null/undefined (e.g., a user created post-B4a but
//     before persona-selection UI exists)
//   - user.persona is an enum value without its own layout yet
//     (booking_coordinator, marketing, bookkeeper — until B4c-B4f ship)
//
// Exported so future batches can reuse the same mapping (e.g., a "your
// view will change soon" toast that shows what you'll see post-B4c).
export function roleDerivedDefault(role) {
    if (role === 'owner') return PERSONA_LAYOUTS.owner;
    if (role === 'manager') return PERSONA_LAYOUTS.generic_manager;
    if (role === 'staff') return PERSONA_LAYOUTS.staff;
    return FALLBACK_LAYOUT;
}

/**
 * Resolves a layout for the given user. Reads user.persona first,
 * falls back to role-derived default when persona is null or maps to
 * an alias-only entry.
 *
 * @param {{ persona?: string|null, role?: string } | null | undefined} user
 * @returns {string[]} ordered widget keys
 */
export function resolveLayout(user) {
    const persona = user?.persona;
    if (persona && Object.prototype.hasOwnProperty.call(PERSONA_LAYOUTS, persona)) {
        const layout = PERSONA_LAYOUTS[persona];
        if (Array.isArray(layout)) return layout;
        // Alias entry (booking_coordinator/marketing/bookkeeper before
        // their dedicated widget sets ship) — fall through to role-derived.
    }
    return roleDerivedDefault(user?.role);
}

/**
 * Display name for the active persona — surfaced in the dashboard
 * header so the admin knows which lens they're viewing. Accepts either
 * a persona key or a legacy role key (callers haven't all migrated).
 *
 * @param {string|null|undefined} key
 * @returns {string}
 */
export function personaLabel(key) {
    if (key === 'owner') return 'Owner view';
    if (key === 'booking_coordinator') return 'Booking coordinator view';
    if (key === 'marketing') return 'Marketing view';
    if (key === 'bookkeeper') return 'Bookkeeper view';
    if (key === 'generic_manager') return 'Manager view';
    if (key === 'staff') return 'Staff view';
    // Legacy role key compatibility — pre-B4b callers passed user.role.
    if (key === 'manager') return 'Manager view';
    return 'Default view';
}
