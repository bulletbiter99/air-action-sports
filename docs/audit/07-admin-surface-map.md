# 07 — Admin Surface Map

Per-page audit of every admin screen in [src/admin/](src/admin/) as of `audit/phase-1`. The "last meaningful change" column is the most recent `git log -1` result on the file. JD-persona mapping uses the role tiers from [docs/staff-job-descriptions.md](docs/staff-job-descriptions.md).

## At a glance

- 27 source files in `src/admin/` (24 user-facing screens + 3 framework files: `AdminLayout`, `AdminContext`, `charts`).
- All screens lazy-loaded via `import()` from `src/App.jsx`.
- All non-`/login`, `/setup`, `/forgot-password`, `/reset-password`, `/accept-invite` screens require an `aas_session` cookie (gated by `requireAuth` on every backing API).
- UI is bespoke (no shadcn / no component library); custom CSS in `src/styles/admin.css`. Charts are hand-rolled SVG in `src/admin/charts.jsx`.
- Three commits cover the bulk of admin work after the initial drop: the shipping commit `cde0860` (2026-04-20 — initial admin UI), `3286cbd` (2026-04-25 — feedback + sidebar reorg + payment methods + dynamic homepage), and `a97435c` / `65b043f` / `e46793a` (2026-05-05 — polish wave + per-surface covers + waiver editor).

## Per-page table

| Route | Component | Last meaningful change | Inferred audience (JD persona) | What it does | Functionality state |
|---|---|---|---|---|---|
| `/admin` | [src/admin/AdminDashboard.jsx](src/admin/AdminDashboard.jsx) | `a97435c` 2026-05-05 — polish: notify preview, featured flag, cron monitor, /events cover, booking fix | **Event Director (owner)**, **Booking Coordinator (manager)** | Top-level dashboard. Reads `/api/admin/auth/me`, `/api/admin/bookings/stats/summary`, `/api/admin/bookings` (recent), `/api/admin/analytics/cron-status`. Inline bookings table replaces the JD-promised separate `/admin/bookings`. Header-right `+ New Booking` CTA (manager+) routes to `/admin/new-booking`. CronHealth strip flags stale sweep (>60min) red. | **Functional**. The MethodBadge pill on each booking row is a UI feature only present here. The "JD says `/admin/bookings`" gap (route inventory §JD gap list) is masked by this page's inline table. |
| `/admin/login` | [src/admin/AdminLogin.jsx](src/admin/AdminLogin.jsx) | `cde0860` 2026-04-20 — initial admin UI | **All admin personas** | Email + password form posting to `/api/admin/auth/login`. RL_LOGIN gates 5/min/IP. | Functional. Has not been touched since initial commit — stable. |
| `/admin/setup` | [src/admin/AdminSetup.jsx](src/admin/AdminSetup.jsx) | `cde0860` 2026-04-20 | First-time use only — Owner | Bootstrap-first-owner flow. Hits `/api/admin/auth/setup-needed`. Race-safe `INSERT WHERE NOT EXISTS`. | Functional. Touched only at first deploy; will never run again unless DB is reset. |
| `/admin/forgot-password` | [src/admin/AdminForgotPassword.jsx](src/admin/AdminForgotPassword.jsx) | `cde0860` 2026-04-20 | All admin personas | Email-entry form for password reset. Always returns 200 (no email enumeration). | Functional. |
| `/admin/reset-password?token=...` | [src/admin/AdminResetPassword.jsx](src/admin/AdminResetPassword.jsx) | `cde0860` 2026-04-20 | All admin personas | Consumes reset token, sets new password, auto-login. | Functional. |
| `/admin/accept-invite?token=...` | [src/admin/AdminAcceptInvite.jsx](src/admin/AdminAcceptInvite.jsx) | `cde0860` 2026-04-20 | New invitee | Verifies invite, creates user, sets password, auto-login. 7d TTL. | Functional. |
| `/admin/events` | [src/admin/AdminEvents.jsx](src/admin/AdminEvents.jsx) | `65b043f` 2026-05-05 — feat(events): per-surface cover images | **Event Director (owner)**, **Marketing Manager (manager)**, **Game Designer (manager)** | Event CRUD with: 5 image pickers (Cover · Card · Event Hero · Booking Banner · Social/OG, ratio-aware previews, fallback hint), inline ticket-type CRUD with capacity ≥ sold guard, custom-questions builder, duplicate-as-draft button, archive-vs-delete logic. Uses `MoneyInput` (dollars-and-cents UI; cents in DB). HTML5 native `datetime-local` and `time` pickers. | Functional and feature-rich. The image picker section is the most recent code on this page. |
| `/admin/roster` | [src/admin/AdminRoster.jsx](src/admin/AdminRoster.jsx) | `3286cbd` 2026-04-25 | **Check-In Staff (staff)**, **Lead Marshal (manager)** | Per-event roster: attendees + waiver status + check-in toggle + custom-question answers inline. Auto-selects next upcoming event on mount. CSV export via `/api/admin/events/:id/roster.csv`. Resend-waiver button. | Functional. CSV columns include `q_<key>` for custom questions. |
| `/admin/scan` | [src/admin/AdminScan.jsx](src/admin/AdminScan.jsx) | `cde0860` 2026-04-20 | **Check-In Staff** | Mobile-first QR scanner using `@zxing/browser`. `getUserMedia` requires HTTPS. Generic lookup at `/api/admin/rentals/lookup/:token` returns `attendee \| item \| unknown`. | Functional. Has not been updated since initial commit; the camera-permission dance is implicit (no explicit prompt UX before opening the camera). |
| `/admin/rentals` | [src/admin/AdminRentals.jsx](src/admin/AdminRentals.jsx) | `3286cbd` 2026-04-25 | **Equipment / Rental Manager (manager)** | Item CRUD with category + condition enums; export-quality QR sheet generator at `/admin/rentals/qr-sheet?ids=...` (named export `AdminRentalQrSheet`). Modals dedup'd (single × icon top-right). | Functional. The QR sheet uses `qrcode` lib client-side; tested once at HANDOFF §10 commit. |
| `/admin/rentals/qr-sheet?ids=...` | named export of `AdminRentals.jsx` (`AdminRentalQrSheet`) | shares last commit | Equipment Manager | Print-only view; reads ?ids comma-list, generates QR codes locally. | Functional. |
| `/admin/rentals/assignments` | [src/admin/AdminRentalAssignments.jsx](src/admin/AdminRentalAssignments.jsx) | `4db80f6` 2026-04-20 — fix: mobile responsiveness | Equipment Manager + Field Marshals | Lists all rental assignments, filterable. Return-flow stamps `condition_on_return`. | Functional but low-traffic. Mobile fixes only after initial drop. |
| `/admin/analytics` | [src/admin/AdminAnalytics.jsx](src/admin/AdminAnalytics.jsx) | `4db80f6` 2026-04-20 | **Event Director**, **Bookkeeper (1099 monthly)** | Revenue + sales-velocity + per-event metrics. Uses `src/admin/charts.jsx` — custom zero-dep SVG charts. JD-promised `/admin/analytics/overview` is the **API** path; UI lives here. | Functional. Charts are bespoke (no Recharts/Chart.js). Last X-axis label fix shipped here per HANDOFF §10 row "Admin UI refactor". |
| `/admin/users` | [src/admin/AdminUsers.jsx](src/admin/AdminUsers.jsx) | `4db80f6` 2026-04-20 | **HR Coordinator (manager+)**, **Owner** | Team list, invite modal, role/active toggles, self-lockout + last-owner guards. | Functional. Owner-only invitation flow. The HR Coordinator JD persona was added in the most recent staff-doc expansion (HANDOFF §10 row "docs: full job descriptions for all 12 staff roles" was 12; the just-shipped expansion to 22 roles formalized HR Coordinator's mapping to this page). |
| `/admin/audit-log` | [src/admin/AdminAuditLog.jsx](src/admin/AdminAuditLog.jsx) | `4db80f6` 2026-04-20 | **Compliance/Waiver Reviewer**, **Read-only Auditor** | Filtered + paginated viewer of `audit_log` rows. Action dropdown is built from distinct existing actions (`/api/admin/audit-log/actions`). Manager+. | Functional. Limited UX: filtering by user_id is index-friendly, but there's no full-text search across `meta_json`. |
| `/admin/settings` | [src/admin/AdminSettings.jsx](src/admin/AdminSettings.jsx) | `e46793a` 2026-05-05 — waiver document editor | **Event Director**, **HR Coordinator** | Settings hub. Sub-page links: Taxes & Fees, Email Templates, Team (`/admin/users`), Audit Log (`/admin/audit-log`), Waivers (`/admin/waivers`). | Functional. Last touched by the waiver-editor commit, which presumably added the `/admin/waivers` link tile. |
| `/admin/settings/taxes-fees` | [src/admin/AdminTaxesFees.jsx](src/admin/AdminTaxesFees.jsx) | `4db80f6` 2026-04-20 | **Event Director (owner)**, **Bookkeeper** | Global tax/fee CRUD. `MoneyInput` for cents; bps for percent. CHECK constraints on `category`, `per_unit`, `applies_to` enforce DB-side. | Functional. Inactive seeds shipped from migration 0004 visible here. |
| `/admin/settings/email-templates` | [src/admin/AdminEmailTemplates.jsx](src/admin/AdminEmailTemplates.jsx) | `4db80f6` 2026-04-20 | **Event Director (owner)**, **Marketing Manager** | Edit subject/HTML/text, live iframe preview, send-test button to a typed email. Owner-only edits. | Functional. No draft state — saves directly to live. Risk noted in `06-do-not-touch.md`. |
| `/admin/promo-codes` | [src/admin/AdminPromoCodes.jsx](src/admin/AdminPromoCodes.jsx) | `3286cbd` 2026-04-25 | **Marketing Manager**, **Event Director** | Promo code CRUD: percent / fixed, max-uses, min-order, per-event scoping. | Functional. |
| `/admin/new-booking` | [src/admin/AdminNewBooking.jsx](src/admin/AdminNewBooking.jsx) | `3286cbd` 2026-04-25 | **Booking Coordinator**, **Check-In Staff (walk-up)** | Manual / walk-in booking. Single dropdown for payment method (card / cash / venmo / paypal / comp). Card branch: mints Stripe Session, renders QR + URL, polls `/api/admin/bookings/:id` every 3s for the green "✓ Payment received" state. Cash/Venmo/PayPal/Comp: immediate paid/comp insert. Tax/fee math goes through `/api/bookings/quote` so totals match customer checkout exactly. | Functional. The QR-render-then-poll pattern is unique to this page — the closest design pattern in the codebase is the `/admin/scan` camera flow. |
| `/admin/vendors` | [src/admin/AdminVendors.jsx](src/admin/AdminVendors.jsx) | `e2366a5` 2026-04-21 — feat: vendor management system | **Vendor / Sponsor Coordinator (Tier 4)**, **Event Director (owner)** | Vendor directory + inline contact CRUD. Owner can soft-delete (`force=1` revokes all packages first). | Functional. |
| `/admin/vendor-packages` and `/admin/vendor-packages/:id` | [src/admin/AdminVendorPackages.jsx](src/admin/AdminVendorPackages.jsx) | `e2366a5` 2026-04-21 | **Vendor Coordinator**, **Event Director** | Per-event package list (filter by event/vendor) on the index path; composer (sections + documents + access log + send + revoke + contract toggle + signature status + countersign) on the `:id` path. Both paths render the same component. | Functional. The composer is the most complex single page in the admin. The `vendor_package_templates` admin UI is **deferred** per HANDOFF §11 — currently only insertable via SQL. |
| `/admin/vendor-contracts` | [src/admin/AdminVendorContracts.jsx](src/admin/AdminVendorContracts.jsx) | `e2366a5` 2026-04-21 | **Owner only** (per route guard) | Versioned contract document manager. Owner can create new version (auto-retires previous) or emergency-retire without replacement. | Functional. |
| `/admin/waivers` | [src/admin/AdminWaivers.jsx](src/admin/AdminWaivers.jsx) | `e46793a` 2026-05-05 — waiver document editor | **Owner only** | Versioned waiver document editor. Same versioning pattern as vendor contracts. The most legally-sensitive admin page. | Functional. **Newest screen** — added 2026-05-05 just before this audit. Live now serves `wd_v4` per HANDOFF §12. |
| `/admin/feedback` | [src/admin/AdminFeedback.jsx](src/admin/AdminFeedback.jsx) | `a97435c` 2026-05-05 — polish: notify preview | **All admin tiers (staff for note-only, manager+ for status flips, owner for delete)** | Triage queue with clickable stat cards (New / Triaged / In progress / Resolved / All time), filters (status / type / priority / q), detail modal with status/priority dropdowns, screenshot preview (or "Screenshot retired on X" placeholder), admin notes, Reply via email (mailto), Notify submitter (templated email with sandboxed-iframe preview-before-send modal), Delete (owner). Orange `+` button opens FeedbackModal for admin-submitted tickets. | Functional and recently polished. |

## Framework files (not user-facing)

| File | Last change | Role |
|---|---|---|
| [src/admin/AdminLayout.jsx](src/admin/AdminLayout.jsx) | `3286cbd` 2026-04-25 | Sidebar (5 sections), profile chip with dropdown, mobile hamburger drawer, FeedbackModal for admin-submitted tickets, Feedback unread-count badge polling `/api/admin/feedback/summary` every 60s. |
| [src/admin/AdminContext.jsx](src/admin/AdminContext.jsx) | `cde0860` 2026-04-20 | React Context wrapping `/api/admin/auth/me` + helper for logout. The only state-management infrastructure in admin. |
| [src/admin/charts.jsx](src/admin/charts.jsx) | `3286cbd` 2026-04-25 | Custom zero-dep SVG line/bar/area chart components used by AdminAnalytics. |

## Functionality "stub / missing / broken"

After per-page review, the only meaningfully-stub admin surface is:

- **Vendor package templates UI** (`vendor_package_templates` table) — schema and seed exist (migration 0012), but no admin page exposes the table. Per HANDOFF §11 deferred list: *"Currently create rows via SQL if needed; admin composer deferred."* Not broken — deferred.

No screen is broken. No screen is missing for a JD persona that the JDs say should have one.

## UI patterns / design-system drift

Sampled across the 24 screens:

| Pattern | Used by | Notes |
|---|---|---|
| `MoneyInput` reusable component | AdminEvents (base price, ticket price, addon price), AdminTaxesFees, AdminPromoCodes, AdminRentals (replacement fee), AdminNewBooking | Consistent — dollars-and-cents UI, cents in DB. Documented as a HANDOFF §10 row ("Global money + tax unification"). |
| Modal: × icon top-right, no duplicate bottom Close/Cancel | AdminRentals, AdminEvents | Documented in HANDOFF §10 row "Admin UI refactor". |
| Modal: `<dialog>` element with custom backdrop | most modals | Bespoke; no shadcn `Dialog`. |
| `<datetime-local>`, `<time>` native pickers | AdminEvents | New since "Admin UI refactor"; helpers parse "6:30 AM" round-trip. |
| Custom SVG charts | AdminAnalytics | All in `src/admin/charts.jsx`. No external dep. |
| Stat cards on top of pages | AdminFeedback | Clickable; sets filter chips. Pattern not yet repeated elsewhere — if Phase 2 adds dashboards (analytics, roster, etc.) this is a candidate stamp. |
| FeedbackModal as shared overlay | AdminLayout, AdminFeedback | Cross-boundary (also Footer + Feedback page on public side). |
| Sidebar navigation with section labels | AdminLayout | Documented in HANDOFF §10 row "Admin sidebar reorganization". |
| Inline tables vs separate pages | AdminDashboard (bookings inline) vs AdminEvents (CRUD modal-driven) | Mixed pattern. Either could be the basis for the future overhauled admin. |
| Native HTML elements vs custom controls | Mostly native (`<select>`, `<input type="time">`, etc.) | No third-party form library. `useFormValidation` hook handles validation. |

**Drift observations**:
- Some pages (AdminRoster, AdminRentals) have clearer column structures than others (AdminAuditLog has a less consistent expanded-metadata UX).
- `AdminAuditLog`'s pagination is simpler than `AdminBookings`'-style filter row + result list.
- `AdminFeedback` introduced clickable stat cards as a new pattern — not yet replicated elsewhere.
- Filter UX is hand-built per page, not a shared component. This is a candidate for the Phase 2 overhaul.

## JD-promised admin routes — confirmed-vs-gap

### Confirmed match (route exists in code AND a JD persona maps to it)

| JD path | Component | Persona |
|---|---|---|
| `/admin` | AdminDashboard | Event Director, Booking Coordinator |
| `/admin/feedback` | AdminFeedback | All tiers |
| `/admin/new-booking` | AdminNewBooking | Booking Coordinator, Check-In Staff |
| `/admin/roster` | AdminRoster | Check-In Staff, Lead Marshal |
| `/admin/scan` | AdminScan | Check-In Staff |
| `/admin/rentals` | AdminRentals | Equipment Manager |
| `/admin/rentals/qr-sheet` | AdminRentalQrSheet | Equipment Manager |
| `/admin/events` | AdminEvents | Event Director, Marketing, Game Designer |
| `/admin/analytics` | AdminAnalytics | Event Director, Bookkeeper |
| `/admin/users` | AdminUsers | HR Coordinator, Owner |
| `/admin/audit-log` | AdminAuditLog | Compliance/Waiver Reviewer, Read-only Auditor |
| `/admin/waivers` | AdminWaivers | Owner only |
| `/admin/vendors` | AdminVendors | Vendor Coordinator, Event Director |
| `/admin/promo-codes` | AdminPromoCodes | Marketing Manager |
| `/admin/settings` | AdminSettings | Event Director |
| `/admin/settings/taxes-fees` | AdminTaxesFees | Event Director, Bookkeeper |
| `/admin/settings/email-templates` | AdminEmailTemplates | Event Director, Marketing Manager |
| `/admin/vendor-packages` | AdminVendorPackages | Vendor Coordinator, Event Director |
| `/admin/vendor-contracts` | AdminVendorContracts | Owner only |

### JD-promised paths that do NOT exist as SPA routes (gap list — same as Area 2)

| JD path | Status | What exists instead |
|---|---|---|
| `/admin/bookings` | ✗ no SPA route | Bookings table inline in AdminDashboard. The data API at `/api/admin/bookings` is fully realized. |
| `/admin/bookings/:id/refund` | ✗ no SPA route | Refund modal inside AdminDashboard. The action API at `/api/admin/bookings/:id/refund` is realized. |
| `/admin/analytics/overview` | ✗ no SPA route | This is the **API** path (`GET /api/admin/analytics/overview`), not a UI route. AdminAnalytics consumes it. |

**Net**: every meaningful JD-promised UI page exists. The "missing" rows are JDs naming API paths as if they were UI pages — a JD documentation issue, not a code gap.

## Cross-area follow-ups

- **Area 8**: design-system drift (filter UX, stat-card pattern) is a refactor opportunity, not a bug. Add as code-observable pain point.
- **Area 8**: AdminScan QR-camera permission UX is implicit; flag.
- **Area 8**: AdminAuditLog has no `meta_json` search (full-text); flag for usability.
- **Area 9**: nothing here is tested. Coverage gaps will be enumerated in Area 9.
- **Area 10**: vendor package templates admin UI is deferred — confirm with owner whether Phase 2 should ship it or leave deferred.
