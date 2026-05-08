// M4 B5 — sidebar config-as-code per docs/m4-discovery/sidebar-ia-audit.md.
//
// Surface 1 IA target: flat top-level (Home / Today / Events / Bookings /
// Customers) + a collapsible Settings group with 8 sub-items.
//
// Production state post-B12a: the Sidebar component in AdminLayout.jsx
// always renders this config (legacy NAV_SECTIONS deleted; new_admin_dashboard
// flag deleted in B12b post-DELETE).
//
// Decision D09 (docs/decisions.md): Roster / Scan / Rentals routes stay
// alive; the sidebar hides them by default. They resurface inside
// /admin/today (page activated in B12c) when activeEventToday=true. B4's
// TodayCheckIns widget already deep-links via /admin/scan?event=... so
// the routes work without sidebar entries.
//
// `getVisibleItems`'s `requiresFlag` filter logic stays for forward-compat —
// no current item uses it (M4 B12b removed `requiresFlag: 'customers_entity'`
// from the Customers item; M5+ may reintroduce flag-gated items).

export const SIDEBAR = [
    { type: 'item', to: '/admin', label: 'Home', end: true },
    {
        type: 'item',
        to: '/admin/today',
        label: 'Today',
        dynamic: 'todayActive',
    },
    { type: 'item', to: '/admin/events', label: 'Events' },
    { type: 'item', to: '/admin/bookings', label: 'Bookings' },
    { type: 'item', to: '/admin/customers', label: 'Customers' },
    { type: 'separator' },
    {
        type: 'group',
        key: 'settings',
        label: 'Settings',
        defaultExpanded: false,
        items: [
            { type: 'item', to: '/admin/settings', label: 'Overview' },
            { type: 'item', to: '/admin/settings/taxes-fees', label: 'Taxes' },
            { type: 'item', to: '/admin/settings/email-templates', label: 'Email' },
            { type: 'item', to: '/admin/users', label: 'Team' },
            { type: 'item', to: '/admin/audit-log', label: 'Audit' },
            { type: 'item', to: '/admin/waivers', label: 'Waivers' },
            { type: 'item', to: '/admin/vendors', label: 'Vendors' },
            { type: 'item', to: '/admin/promo-codes', label: 'Promo Codes' },
            // Analytics + Feedback land here temporarily; final home decided
            // pre-Reports M7 per the audit.
            { type: 'item', to: '/admin/analytics', label: 'Analytics' },
            {
                type: 'item',
                to: '/admin/feedback',
                label: 'Feedback',
                badgeKey: 'newFeedback',
            },
        ],
    },
];

// ────────────────────────────────────────────────────────────────────
// Visibility filter — applied at render time
// ────────────────────────────────────────────────────────────────────

/**
 * Filters a sidebar config array to the items that should render given
 * the current today-active state and feature flags.
 *
 * @param {Array} config - The sidebar config array (typically SIDEBAR).
 * @param {Object} ctx - Render context.
 * @param {Object|null} ctx.todayState - From useTodayActive(); shape
 *   { activeEventToday, eventId, checkInOpen } | null
 * @param {Object} ctx.flags - Feature flag values keyed by flag name,
 *   e.g. { customers_entity: true }
 * @returns {Array} Filtered config — separators and groups pass through
 *   unchanged; items with `dynamic` or `requiresFlag` are filtered.
 */
export function getVisibleItems(config, ctx = {}) {
    if (!Array.isArray(config)) return [];
    const todayState = ctx.todayState || null;
    const flags = ctx.flags || {};

    return config.filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;

        // Separators always pass; consumers decide whether to render them.
        if (entry.type === 'separator') return true;

        // Groups always pass; their items are filtered at render time
        // separately if needed.
        if (entry.type === 'group') return true;

        // Items with dynamic predicates
        if (entry.dynamic === 'todayActive') {
            return Boolean(todayState?.activeEventToday);
        }

        // Items gated by a feature flag
        if (entry.requiresFlag) {
            return Boolean(flags[entry.requiresFlag]);
        }

        // Default: visible
        return true;
    });
}

// ────────────────────────────────────────────────────────────────────
// Settings expand state — localStorage-backed
// ────────────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'aas:admin:sidebar:expand:';

/**
 * Reads the persisted expand state for a sidebar group from localStorage.
 * Defensive against localStorage being disabled / throwing.
 *
 * @param {string} groupKey - Stable identifier for the group, e.g. 'settings'.
 * @param {boolean} defaultValue - Returned when no stored value or on error.
 * @returns {boolean}
 */
export function loadSidebarExpand(groupKey, defaultValue = false) {
    if (!groupKey) return defaultValue;
    try {
        if (typeof localStorage === 'undefined') return defaultValue;
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + groupKey);
        if (raw === null || raw === undefined) return defaultValue;
        return raw === 'true';
    } catch {
        return defaultValue;
    }
}

/**
 * Persists the expand state for a sidebar group to localStorage.
 * Defensive against localStorage being disabled / throwing — silent fail.
 *
 * @param {string} groupKey - Stable identifier for the group.
 * @param {boolean} isOpen
 */
export function saveSidebarExpand(groupKey, isOpen) {
    if (!groupKey) return;
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(STORAGE_KEY_PREFIX + groupKey, isOpen ? 'true' : 'false');
    } catch {
        // localStorage disabled (e.g., private mode in some browsers).
        // Silent fail — the group will start each session at its
        // defaultExpanded value.
    }
}
