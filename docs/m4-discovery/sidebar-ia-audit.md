# M4 Batch 0 — Sidebar / IA Audit

Verified by reading [src/admin/AdminLayout.jsx](../../src/admin/AdminLayout.jsx) (sidebar inline at lines 11–45 + 102–179) and [src/App.jsx](../../src/App.jsx) (admin route registration at lines 90–119).

## Current sidebar structure

Hard-coded in [`NAV_SECTIONS`](../../src/admin/AdminLayout.jsx:11):

| # | Section label | Items | Notes |
|---|---|---|---|
| 1 | (no label) | Dashboard `/admin` | end-match |
| 2 | Event Setup | Events `/admin/events` · Promos `/admin/promo-codes` · Vendors `/admin/vendors` | — |
| 3 | Event Day | Roster `/admin/roster` · Scan `/admin/scan` · Rentals `/admin/rentals` | — |
| 4 | Insights | Analytics `/admin/analytics` · Feedback `/admin/feedback` (badged) | When `customers_entity` flag is on, **Customers `/admin/customers`** is injected at the **top** of this section ([AdminLayout.jsx:112-121](../../src/admin/AdminLayout.jsx:112)) |
| 5 | (no label) | Settings `/admin/settings` | — |

**Routes registered in App.jsx that have no sidebar entry:**
- `/admin/new-booking` (CTA in dashboard header instead)
- `/admin/users` (Team — accessible only via direct link or settings page)
- `/admin/audit-log`
- `/admin/vendor-packages`, `/admin/vendor-contracts`
- `/admin/waivers`
- `/admin/customers/:id` (detail; reachable from list)
- `/admin/settings/taxes-fees`, `/admin/settings/email-templates`
- `/admin/forgot-password`, `/admin/reset-password`, `/admin/accept-invite`, `/admin/login`, `/admin/setup`

## Surface 1 target IA

```
Home              → /admin                    (renamed from "Dashboard")
Today             → /admin/today              (dynamic; only when active event)
Events            → /admin/events
Bookings          → /admin/bookings           (NEW; built in B2)
Customers         → /admin/customers          (M3; promote from Insights nested)
─────             (separator)
Settings          → /admin/settings           (collapsible group)
  ├─ Taxes               /admin/settings/taxes-fees       (exists)
  ├─ Email               /admin/settings/email-templates  (exists)
  ├─ Team                /admin/users                     (exists; relocate)
  ├─ Audit               /admin/audit-log                 (exists; relocate)
  ├─ Waivers             /admin/waivers                   (exists; relocate)
  ├─ Vendors             /admin/vendors                   (exists; relocate; sub-pages remain at /admin/vendor-packages, vendor-contracts)
  ├─ Promo Codes         /admin/promo-codes               (exists; relocate)
  └─ Feature flags       /admin/settings (anchor)         (existing density-toggle UI; surface for new_admin_dashboard + customers_entity)
```

## Delta — what Batch 5 must do

| Action | From | To | Depends on |
|---|---|---|---|
| **Rename label** | "Dashboard" (Section 1) | "Home" | — |
| **Add nav item** | — | "Today" `/admin/today` (dynamic — render only when `/api/admin/today/active` returns `activeEventToday: true`) | Batch 4 ships `/api/admin/today/active`; Batch 12 ships the actual page. In B5 we add the nav item and gate it on the API response, even though clicking it pre-B12 may 404. |
| **Add nav item** | — | "Bookings" `/admin/bookings` top-level | Batch 2 ships the page; in B5 we add the nav item |
| **Promote nav item** | "Customers" nested under "Insights" (when flag on) | top-level "Customers" | None — promotion only affects sidebar config |
| **Remove section** | "Insights" (Analytics + Feedback + injected Customers) | dissolved | Analytics moves to Settings group; Feedback moves to Settings group; Customers becomes top-level |
| **Remove section** | "Event Setup" (Events / Promos / Vendors) | dissolved | Events becomes top-level; Promos + Vendors move to Settings group |
| **Remove section** | "Event Day" (Roster / Scan / Rentals) | dissolved into Today | Per Surface 1, event-day operations are subordinate to the Today landing page. **Open question:** are Roster/Scan/Rentals child-routes of `/admin/today`, or do they stay as sibling top-level routes hidden from the sidebar by default and surfaced from within `/admin/today`? Recommend the latter for B5 (keeps deep links working), but flag for confirmation. |
| **Add separator** | — | between "Customers" and "Settings" | — |
| **Convert Settings to collapsible group** | flat link to `/admin/settings` | expandable group with 8 sub-items (Taxes / Email / Team / Audit / Waivers / Vendors / Promo Codes / Feature flags) | Need state persistence — recommend `localStorage` (sidebar UX state, not security-critical). The clicking the parent "Settings" label could either toggle expand/collapse OR navigate to `/admin/settings`. Recommend label = expand toggle, plus a "Settings overview" item at the top of the expanded group that links to `/admin/settings`. |

## Implementation pattern recommended for Batch 5

Per CLAUDE.md M2 conventions ("config-as-code so future milestones add to the config rather than the component"), extract the sidebar config to a new module:

```
src/admin/sidebarConfig.js
```

Schema (proposal):
```js
export const SIDEBAR = [
  { type: 'item', to: '/admin', label: 'Home', end: true },
  { type: 'item', to: '/admin/today', label: 'Today', dynamic: 'todayActive' },  // hidden unless predicate true
  { type: 'item', to: '/admin/events', label: 'Events' },
  { type: 'item', to: '/admin/bookings', label: 'Bookings' },
  { type: 'item', to: '/admin/customers', label: 'Customers', requiresFlag: 'customers_entity' },
  { type: 'separator' },
  {
    type: 'group',
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
      // Analytics + Feedback temporary placement — final home decided pre-Reports M7
      { type: 'item', to: '/admin/analytics', label: 'Analytics' },
      { type: 'item', to: '/admin/feedback', label: 'Feedback', badgeKey: 'newFeedback' },
    ],
  },
];
```

Sidebar component reads this config; renders sections/items per type; consumes `useFeatureFlag` for `requiresFlag`; consumes `/api/admin/today/active` for `dynamic: 'todayActive'`; reads `localStorage` for `defaultExpanded`.

## M4 batches that interact with the sidebar

| Batch | Interaction |
|---|---|
| B2 | Adds `/admin/bookings` — Batch 5 adds the nav entry |
| B4 | Adds `/api/admin/today/active` — Batch 5 consumes it for the dynamic Today item |
| **B5** | **Executes the IA reorganization above** |
| B7 | Command palette is a sidebar-overlay UX, not a sidebar item — orthogonal |
| B12 | Builds `/admin/today` page — may add Today sub-section in sidebar then |

## Visual-regression dependencies

Batch 1 captures admin-baseline snapshots (per the M4 prompt's added admin baselines). Batch 5's sidebar reorganization will produce intentional diffs for:
- Admin dashboard (sidebar layout differs)
- Admin customers list (Customers sidebar item position changes)
- Admin events list (sidebar reorganization is visible)
- Admin feedback list (Feedback moves into Settings group)

Batch 5 will need to update those baselines via `playwright --update-snapshots`. Batch 1's admin baselines should be captured **before** Batch 5 lands so the diffs are visible in B5's PR.

## Open question for operator

**Roster / Scan / Rentals placement.** Surface 1 collapses them under Today. Recommendation: keep routes alive at `/admin/roster`, `/admin/scan`, `/admin/rentals` (deep links work; Batch 4's `TodayCheckIns` widget can link to `/admin/scan?event=...`); hide from sidebar default; surface them from `/admin/today` via prominent action tiles when active event today; show them in sidebar as Today's sub-items only when `todayActive` is true. Confirm before B5 implements.
