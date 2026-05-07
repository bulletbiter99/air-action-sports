// M3 Batch 9 — persona layouts for the new AdminDashboard.
//
// Maps user.role → ordered list of widget keys. The persona shell
// (src/admin/AdminDashboardPersona.jsx) iterates the resolved layout
// and renders the corresponding widget from src/admin/widgets/PersonaWidgets.jsx.
//
// Rationale:
//   - owner   : business-health view. Revenue first, then operational
//               health (cron), then today's load + recent activity.
//   - manager : operational view. Today + recent bookings up top, system
//               health below for the off-chance the cron stalls.
//   - staff   : event-day view. Today + recent bookings only — staff
//               don't have access to revenue or system internals.
//
// Adding a new persona or widget is a config-only change here +
// implementing the corresponding component in PersonaWidgets.jsx.

export const PERSONA_LAYOUTS = {
    owner: ['RevenueSummary', 'CronHealth', 'TodayEvents', 'RecentBookings'],
    manager: ['TodayEvents', 'RecentBookings', 'CronHealth'],
    staff: ['TodayEvents', 'RecentBookings'],
};

const FALLBACK_LAYOUT = ['TodayEvents', 'RecentBookings'];

/**
 * Resolves a layout for the given user. Falls back to the staff-style
 * minimal layout when role is missing or unrecognized — defensive in
 * case a future role is added in DB before code knows about it.
 *
 * @param {{ role?: string } | null | undefined} user
 * @returns {string[]} ordered widget keys
 */
export function resolveLayout(user) {
    const role = user?.role;
    if (role && Object.prototype.hasOwnProperty.call(PERSONA_LAYOUTS, role)) {
        return PERSONA_LAYOUTS[role];
    }
    return FALLBACK_LAYOUT;
}

/**
 * Display name for a persona — surfaced in the dashboard header so the
 * admin knows which lens they're viewing.
 *
 * @param {string|null|undefined} role
 * @returns {string}
 */
export function personaLabel(role) {
    if (role === 'owner')   return 'Owner view';
    if (role === 'manager') return 'Manager view';
    if (role === 'staff')   return 'Staff view';
    return 'Default view';
}
