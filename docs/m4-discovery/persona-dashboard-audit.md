# M4 Batch 0 — Persona Dashboard Widget Audit

Verified by reading [src/admin/personaLayouts.js](../../src/admin/personaLayouts.js), [src/admin/AdminDashboardPersona.jsx](../../src/admin/AdminDashboardPersona.jsx), [src/admin/widgets/PersonaWidgets.jsx](../../src/admin/widgets/PersonaWidgets.jsx), and [src/admin/AdminDashboard.jsx](../../src/admin/AdminDashboard.jsx).

## Headline finding — persona model mismatch

**The Surface 1 design specifies four job-title personas (Owner / Booking Coordinator / Marketing Manager / Bookkeeper). M3 shipped three role-based personas (owner / manager / staff) keyed on `user.role`.**

The DB `users.role` column has three values: `owner`, `manager`, `staff` (per [worker/lib/auth.js](../../worker/lib/auth.js) hierarchy: owner > manager > staff). The Surface 1 personas (BC, Marketing, Bookkeeper) have no DB representation today — there is no `users.persona`, `users.specialty`, or capability-bundle column.

**Implication for Batch 4:** before any widget work begins, Batch 4 must resolve how persona maps to user. Three viable options, in increasing order of effort:

1. **Map design-personas → existing roles** (e.g. BC widgets → manager view; Marketing + Bookkeeper widgets → owner view, partitioned with tabs or a sub-selector). Lowest effort. Loses the "lens" quality of persona-tailored UX.
2. **Add `users.persona` column** with values `owner / booking_coordinator / marketing / bookkeeper / generic_manager / staff`. Migration + admin UI to pick. Owner persona stays default. Resolves Surface 1 cleanly. Medium effort; needs a migration batch.
3. **Per-user widget layouts** (drag-and-drop personalization). Highest effort. Likely M5+.

Recommend Option 2 in Batch 4a as a small migration + role-to-persona-default mapping; existing role-based defaults stay until a user opts into a different persona. **Stop-and-ask trigger flagged in plan output to resolve before Batch 4 begins.**

## Shipped — Owner persona

Layout in [src/admin/personaLayouts.js:19](../../src/admin/personaLayouts.js:19):
```js
owner: ['RevenueSummary', 'CronHealth', 'TodayEvents', 'RecentBookings']
```

| Surface 1 designed widget | Shipped? | Wired? | API | M4 batch to complete |
|---|---|---|---|---|
| Today's events status (active-event card) | Partial (`TodayEvents`) | ✓ owner | `/api/admin/events` | B4 — extend to show check-in progress when active event today |
| KPI grid (Revenue MTD / Upcoming events / Bookings to date / Pending refunds) | Partial — `RevenueSummary` shows lifetime, not MTD | ✓ owner | `/api/admin/analytics/overview` | B4 — add MTD scoping; add Upcoming events count + Pending refunds widgets |
| Upcoming events readiness (top 3 with paid % / waivers % / rentals % / vendors %) | ✗ | ✗ | needs new endpoint | B4 — new `UpcomingEventsReadiness` widget |
| Action queue (pending refunds, COIs expiring, missing waivers, vendor unsigned) | ✗ | ✗ | needs new endpoint | B4 — new `ActionQueue` widget |
| Recent activity (audit log stream, last 10) | ✗ | ✗ | `/api/admin/audit-log` exists | B4 — new `RecentActivity` widget |
| Cron health | ✓ (`CronHealth`) | ✓ owner | `/api/admin/analytics/cron-status` | — keep |

Owner ships with **2 of 6 designed widgets** intact. The remaining 4 are net-new in B4.

## Shipped — Manager persona

Layout: `manager: ['TodayEvents', 'RecentBookings', 'CronHealth']`

The Surface 1 design's "Booking Coordinator" persona maps most naturally to the `manager` role today. Designed widgets:

| Surface 1 BC widget | Shipped? | M4 batch |
|---|---|---|
| KPI row: New today / Needs action / Refund queue / Walk-ups today | ✗ | B4 — new `BookingCoordinatorKPIs` widget |
| Bookings needing action (4×3) | ✗ | B4 — new `BookingsNeedingAction` widget; can hand-off to `/admin/bookings` (B2) for full list |
| Today's check-ins (event days only) | Partial — `TodayEvents` shows events, not check-in counts | B4 — new `TodayCheckIns` widget; gates on `/api/admin/today/active` |
| Quick actions (4 large tiles) | ✗ — `+ New Booking` CTA exists in header but not a tile grid | B4 — new `QuickActions` widget |
| Recent customer feedback | ✗ | B4 — new `RecentFeedback` widget; reads `/api/admin/feedback?status=new&limit=5` |

Manager ships with **0 of 5 designed BC widgets**. Current shipped widgets (`TodayEvents`, `RecentBookings`, `CronHealth`) are useful generic carry-overs but don't match the BC persona spec.

## Not shipped — Marketing Manager persona

No widgets implemented. M3 closing inventory was correct: zero coverage. All 6 designed widgets net-new in B4:
- KPI row (Conversion rate / Promo redemption / AOV / Email open rate)
- Funnel widget (last 30 days)
- Upcoming events fill rate
- Promo code performance
- Asset library shortcut (placeholder until M5)
- Recent feedback (marketing-tagged)

**Data dependencies:**
- Email open rate → needs Resend webhook integration (M5/M6 — degrade to "data pending" empty state)
- Asset library → M5 ships the staff infrastructure
- Funnel widget → likely needs new `/api/admin/analytics/funnel` endpoint

## Not shipped — Bookkeeper persona

No widgets implemented. All 5 designed widgets net-new in B4:
- KPI row (Revenue MTD / Refunds MTD / Net revenue MTD / Stripe payout)
- Revenue trend (90-day sparkline)
- 1099 thresholds (placeholder until M5)
- Tax/fee summary (Q-current)
- Refund activity (last 30 days)

**Data dependencies:**
- Stripe payout → needs Stripe Balance/Payouts API integration (likely M6 since Stripe-related)
- 1099 thresholds → M5 staff infrastructure (per-staff payout aggregation)
- Most revenue widgets reuse `/api/admin/analytics/overview` with date scoping; new endpoint may not be needed

## API endpoints in scope for B4

Existing endpoints widgets currently consume:
- `/api/admin/analytics/overview` (lifetime; needs date scoping for MTD)
- `/api/admin/analytics/cron-status`
- `/api/admin/events`
- `/api/admin/bookings?limit=N`

**Missing — Batch 4 must build:**
- `GET /api/admin/today/active` → returns `{ activeEventToday: bool, eventId, checkInOpen: bool }` — used by widget refresh-cadence rule (5 min default → 30s on event day → 10s during check-in window) AND by Batch 5's dynamic Today nav item AND by Batch 6's walk-up booking banner
- `GET /api/admin/analytics/funnel?days=30` — Marketing funnel widget
- `GET /api/admin/dashboard/upcoming-readiness` — Owner readiness widget (paid % / waivers % / rentals % / vendors % per upcoming event)
- `GET /api/admin/dashboard/action-queue` — Owner action queue (aggregates pending refunds, COIs expiring, missing waivers, vendor unsigned)

Batch 4 will likely need a new mount: `worker/routes/admin/dashboard.js` and an `app.route('/api/admin/dashboard', adminDashboard)` line in [worker/index.js](../../worker/index.js).

## Refresh cadence — needs implementation

The Surface 1 addendum specifies:
- Default 5 min
- Event day (active event today): 30s for live widgets (`ActionQueue`, `TodayCheckIns`, `RecentActivity`)
- Active check-in window: 10s for those same widgets
- Static widgets (Revenue MTD, 1099 thresholds, etc.): always 5 min

**No widget today implements this cadence — they all fetch once on mount.** Batch 4 must:
1. Build a shared widget primitive `useWidgetData(url, { cadence })` that polls per the rule
2. Have widgets declare their cadence class (live / static)
3. Have widgets check `/api/admin/today/active` to apply 30s/10s vs 5min

## Summary table — Batch 4 scope

| Item | New widgets | New endpoints | Migration? |
|---|---|---|---|
| Persona model decision | — | — | possibly `users.persona` column |
| Owner completion | 4 (`UpcomingEventsReadiness`, `ActionQueue`, `RecentActivity`, MTD-scoped KPI grid) | 2 (`dashboard/upcoming-readiness`, `dashboard/action-queue`) | — |
| BC persona | 5 (`BookingCoordinatorKPIs`, `BookingsNeedingAction`, `TodayCheckIns`, `QuickActions`, `RecentFeedback`) | 1 (`today/active`) | — |
| Marketing persona | 6 (KPIs, funnel, fill rate, promo perf, asset shortcut placeholder, marketing feedback) | 1 (`analytics/funnel`) | — |
| Bookkeeper persona | 5 (KPIs, revenue trend, 1099 placeholder, tax summary, refund activity) | 0 (reuses analytics/overview with date scope) | — |
| Refresh cadence primitive | shared `useWidgetData` hook | — | — |

**Total Batch 4 scope estimate: ~21 widgets + 4 endpoints + shared primitive + (maybe) 1 migration.** This will need to split into Batch 4a/4b/4c per the 10-file cap.
