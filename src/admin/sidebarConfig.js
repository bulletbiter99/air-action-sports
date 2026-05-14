// M4 B5 — sidebar config-as-code per docs/m4-discovery/sidebar-ia-audit.md.
// M5 B0 (sub-batch 0-sidebar) — D10: Rentals / Roster / Scan restored to
// standing nav as capability-gated items. Reverses D09 partially: the
// /admin/today page still surfaces them as quick-action tiles when an
// event is live; the sidebar now also shows them standing for the
// personas with ops capability (Owner sees all). Capability gating is
// stubbed against the legacy role hierarchy until M5 Batch 2 ships
// real DB-backed capabilities.
//
// Surface 1 IA target: flat top-level (Home / Today / Events / Bookings /
// Customers / Rentals / Roster / Scan) + a collapsible Settings group
// with 10 sub-items.
//
// Production state post-B12a: the Sidebar component in AdminLayout.jsx
// always renders this config (legacy NAV_SECTIONS deleted; new_admin_dashboard
// flag deleted in B12b post-DELETE).
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
    // M5.5 B6.5 — Sites + Fields directory (capability-gated). Backed by
    // worker/routes/admin/sites.js; powers field rentals (M5.5 B7+).
    { type: 'item', to: '/admin/sites', label: 'Sites', capability: 'sites.read' },
    // M5.5 B8 — Field rentals (B2B field bookings). Conceptually adjacent to
    // Sites (Sites = the where, Field Rentals = what's happening at the where).
    { type: 'item', to: '/admin/field-rentals', label: 'Field Rentals', capability: 'field_rentals.read' },
    // M5 B0 (D10) — restored from the M4 B5 D09 collapse. Capability-gated
    // so non-owner roles only see what their persona needs. The /admin/today
    // page continues to surface these as quick-action tiles when an event
    // is live; this sidebar entry serves the standing-time use case
    // (between events).
    { type: 'item', to: '/admin/rentals', label: 'Rentals', capability: 'rentals.read' },
    { type: 'item', to: '/admin/roster', label: 'Roster', capability: 'roster.read' },
    { type: 'item', to: '/admin/scan', label: 'Scan', capability: 'scan.use' },
    // Operational dashboards + tools — promoted from the Settings group
    // so it can be configuration-only. Order: insights (Analytics /
    // Feedback) before marketing/partner ops (Promo Codes / Vendors).
    { type: 'item', to: '/admin/analytics', label: 'Analytics' },
    {
        type: 'item',
        to: '/admin/feedback',
        label: 'Feedback',
        badgeKey: 'newFeedback',
    },
    { type: 'item', to: '/admin/promo-codes', label: 'Promo Codes' },
    { type: 'item', to: '/admin/vendors', label: 'Vendors' },
    { type: 'separator' },
    {
        type: 'group',
        key: 'settings',
        label: 'Settings',
        defaultExpanded: false,
        // Configuration-only: things that change how the system works.
        // Operational tools (Analytics, Feedback, Promo Codes, Vendors)
        // are top-level entries above the separator.
        items: [
            { type: 'item', to: '/admin/settings', label: 'Overview' },
            { type: 'item', to: '/admin/settings/taxes-fees', label: 'Taxes' },
            { type: 'item', to: '/admin/settings/email-templates', label: 'Email' },
            { type: 'item', to: '/admin/staff', label: 'Team' },
            { type: 'item', to: '/admin/audit-log', label: 'Audit' },
            { type: 'item', to: '/admin/waivers', label: 'Waivers' },
        ],
    },
];

// ────────────────────────────────────────────────────────────────────
// Capability stub — M5 B0 sidebar restoration
// ────────────────────────────────────────────────────────────────────
//
// Maps a capability key to the minimum legacy role that should hold it.
// Replaced in M5 Batch 2 by a DB-backed query against role_presets +
// user_capability_overrides. Until then, all four current admins are
// owner-role and see every item; this stub is the bridge.
//
// Role hierarchy (from worker/lib/auth.js requireRole): owner > manager > staff.

const ROLE_LEVELS = { staff: 1, manager: 2, owner: 3 };

const CAPABILITY_TO_LEGACY_ROLE = {
    'rentals.read': 'manager',
    'roster.read': 'staff',
    'scan.use': 'staff',
    // M5.5 B6.5 — Sites directory. Manager + above see the entry; the
    // DB-backed capability check at requireCapability() still gates the
    // routes for finer-grained permissions (Site Coordinator, etc.).
    'sites.read': 'manager',
    // M5.5 B8 — Field Rentals. Manager + above see the entry; the DB-backed
    // capability check at requireCapability() still gates the routes for
    // finer-grained per-action permissions (deposit_record vs balance_record,
    // bypass_conflict, etc.).
    'field_rentals.read': 'manager',
};

/**
 * Stub capability check used by getVisibleItems until M5 B2 lands the
 * real DB-backed implementation in worker/lib/capabilities.js. Maps a
 * capability key to a minimum legacy role; an item with no capability
 * field is always visible (current admins are all owner).
 *
 * @param {string|undefined} userRole - 'owner' | 'manager' | 'staff' | undefined
 * @param {string|undefined} capability - capability key, e.g. 'rentals.read'
 * @returns {boolean}
 */
export function userHasCapabilityStub(userRole, capability) {
    if (!capability) return true;
    const requiredRole = CAPABILITY_TO_LEGACY_ROLE[capability];
    if (!requiredRole) return true; // unknown capability defaults to visible
    const userLevel = ROLE_LEVELS[userRole] || 0;
    const requiredLevel = ROLE_LEVELS[requiredRole] || 999;
    return userLevel >= requiredLevel;
}

// ────────────────────────────────────────────────────────────────────
// Visibility filter — applied at render time
// ────────────────────────────────────────────────────────────────────

/**
 * Filters a sidebar config array to the items that should render given
 * the current today-active state, feature flags, and (M5 B0) user role.
 *
 * @param {Array} config - The sidebar config array (typically SIDEBAR).
 * @param {Object} ctx - Render context.
 * @param {Object|null} ctx.todayState - From useTodayActive(); shape
 *   { activeEventToday, eventId, checkInOpen } | null
 * @param {Object} ctx.flags - Feature flag values keyed by flag name,
 *   e.g. { customers_entity: true }
 * @param {string|undefined} ctx.userRole - 'owner' | 'manager' | 'staff'.
 *   Drives capability-stub gating for items with a `capability` field.
 *   Omitted/undefined treated as no role; capability-gated items hidden.
 * @returns {Array} Filtered config — separators and groups pass through
 *   unchanged; items with `dynamic`, `requiresFlag`, or `capability`
 *   are filtered.
 */
export function getVisibleItems(config, ctx = {}) {
    if (!Array.isArray(config)) return [];
    const todayState = ctx.todayState || null;
    const flags = ctx.flags || {};
    const userRole = ctx.userRole;

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

        // Items gated by a capability (M5 B0 stub; M5 B2 swaps to real check)
        if (entry.capability) {
            return userHasCapabilityStub(userRole, entry.capability);
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
