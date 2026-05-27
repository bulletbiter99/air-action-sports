# Decisions Register

Closes audit open questions and operator-decision-pending placeholders as they're resolved. Newest at top. Reference each entry by its date + short ID when citing in code/PRs.

---

## 2026-05-27 — D14: M6 sandbox-mode dev pattern — develop + ship past the live-cutover gate

**Source:** Operator direction during M6 multi-batch session 2026-05-26/27 — "complete everything except what's needed in a live scenario."

**Resolution:** All M6 batches that touch Stripe payment flow (B5 setup_future_usage, B6 dispute consumer, B7 off-session charge, B9 PM detach) shipped to production while production was still running on Stripe **sandbox** keys. Live verification of each (real saved PM, real dispute, real $1 e2e) is deferred to operator-completed cutover items 1–5 in `docs/m6-operator-cutover-checklist.md`.

This pattern works because:
- Stripe sandbox and live APIs are byte-equivalent for the request shapes M6 uses; the difference is what's behind the keys.
- Sandbox-mode code paths exercise every error branch (declined, 3DS, no PM, retrieve-failed, etc.) via mocked test fixtures.
- Workers Builds auto-deploys on `git push origin main` — there's no staging environment in which to "stage" the code, so production-on-sandbox IS the staging environment.

**What this means for future milestones:** payment-flow features can ship to production as soon as the code is correct against sandbox. The "is this live yet" question is independent of "is this deployed yet" and depends solely on which Stripe keys the worker's secrets currently hold.

**Status:** ✓ adopted as the M6 dev pattern; preserved as an option for future milestones that touch Stripe.

---

## 2026-05-27 — D13: Remove-saved-PM is owner-only (not manager+)

**Source:** M6 B9 — privacy compliance feature scope.

**Resolution:** `POST /api/admin/bookings/:id/detach-saved-pm` requires `requireRole('owner')` — manager-tier admins cannot detach a customer's saved payment method. Rationale:

- Detaching a PM from a Stripe Customer is irreversible from our UI (Stripe retains the PM object for ~13 months but it's no longer chargeable through our flow).
- Privacy-sensitive customer-data manipulation should sit at the highest privilege level by default.
- Manager-tier admins can still issue refunds (`requireRole('owner', 'manager')`) — refund and PM-detach are different operations.

The UI gate mirrors the API: the "Remove saved card" button in `/admin/bookings/:id` only renders when `hasRole('owner')` AND the booking has a non-synthetic Stripe payment intent (cash_/venmo_/etc. prefixes are excluded — there's no real Stripe PM to detach behind those).

**Status:** ✓ resolved — implementation in B9 (PR [#200](https://github.com/bulletbiter99/air-action-sports/pull/200)).

---

## 2026-05-27 — D12: Off-session damage charge idempotency key format

**Source:** M6 B7 — preventing double-charge on retry / double-click.

**Resolution:** `chargeOffSessionForCharge` passes `idempotencyKey: charge_<chargeId>_offsession` to Stripe's `POST /v1/payment_intents`. Stripe deduplicates requests with the same Idempotency-Key for 24 hours — a retry or operator double-click within that window returns the same PaymentIntent without re-charging.

The format is stable + derivable from the charge ID alone (no timestamp / nonce) so:
- Re-running the same charge attempt is safe
- Stripe dashboard can show the same key on retries
- We never accidentally charge twice for the same damage incident

**Status:** ✓ resolved — implementation in B7 lib (PR [#198](https://github.com/bulletbiter99/air-action-sports/pull/198)).

---

## 2026-05-27 — D11: Damage charge Option A retrieves customer + PM at charge time (no schema change)

**Source:** M6 B7 — needed customer ID + PM ID to off-session-charge against B5's saved payment method.

**Resolution:** `chargeOffSessionForCharge` calls Stripe's `retrievePaymentIntent` on the booking's `stripe_payment_intent` at charge time, reads `customer` + `payment_method` from the returned PI, and uses both for the new off-session charge. **No schema change required** — we don't persist `stripe_customer_id` on the bookings or customers table.

Trade-offs considered:

- **Path B (persist `stripe_customer_id` on bookings):** Would save one Stripe API call per off-session charge. Costs an additional migration + webhook handler change to populate the column on `checkout.session.completed`. Adds a column to a Critical-DNT table.
- **Path A (retrieve on demand — chosen):** One extra Stripe API call per charge. No schema change. No DNT touches beyond the additive endpoint. Simpler to reason about.

Damage charges are low-volume (one per damaged-equipment incident, not per booking), so the extra Stripe call is acceptable. If volume grows, we can revisit and add the column with a backfill migration.

**Status:** ✓ resolved — implementation in B7 lib (PR [#198](https://github.com/bulletbiter99/air-action-sports/pull/198)).

---

## 2026-05-08 — D10: Roster / Scan / Rentals restored to standing nav as capability-gated items (M5 B0)

**Source:** M5 milestone prompt, Batch 0 spec — sidebar restoration directive. Reverses D09 partially.

**Resolution:** M5 Batch 0 sub-batch `0-sidebar` adds Rentals / Roster / Scan back to the top-level sidebar (between Customers and the Settings separator) with declarative `capability` fields:

```js
{ to: '/admin/rentals', label: 'Rentals', capability: 'rentals.read' }
{ to: '/admin/roster',  label: 'Roster',  capability: 'roster.read'  }
{ to: '/admin/scan',    label: 'Scan',    capability: 'scan.use'     }
```

`getVisibleItems` filters these by the calling user's capabilities. Until M5 Batch 2 ships the DB-backed capability system, capability checks fall through to a stub (`userHasCapabilityStub` in `sidebarConfig.js`) that maps capability → minimum legacy role:
- `rentals.read` → manager (managing the rental pool)
- `roster.read` → staff (any admin viewing a roster)
- `scan.use` → staff (any admin scanning at check-in)

**What stays from D09:** the `/admin/today` page continues to surface Rentals/Roster/Scan as quick-action tiles when an event is live. That use case (event-day rapid access) is unchanged. D10 adds back the standing-time use case (between events) that D09 removed by mistake.

**Why partial reversal:** D09 collapsed these under Today on the assumption their only use was event-day. In practice, the Booking Coordinator persona reaches for Roster outside event days (post-event reconciliation, pre-event readiness checks); the Equipment Manager persona reaches for Rentals between events for inventory management. Hiding them entirely except on event days adds friction.

**Sequencing:**
- M5 B0 0-sidebar: declarative capability fields + role-based stub gating
- M5 B2: replace stub with DB-backed `userHasCapability(env, userId, key)` from the formalized capability system

**Status:** ✓ resolved — implementation lands in M5 Batch 0 sub-batch 0-sidebar.

---

## 2026-05-07 — D09: Roster / Scan / Rentals collapse under Today (M4 B5)

**Source:** Operator confirmation in M4 Batch 0 review (PR [#55](https://github.com/bulletbiter99/air-action-sports/pull/55)). Recommendation surfaced in [docs/m4-discovery/sidebar-ia-audit.md](m4-discovery/sidebar-ia-audit.md).

**Resolution:** Batch 5's IA reorganization will collapse the current "Event Day" sidebar section (Roster / Scan / Rentals) under the new dynamic Today nav item. Implementation:
- Routes `/admin/roster`, `/admin/scan`, `/admin/rentals` stay alive (deep links continue to work; widgets in Batch 4 link to `/admin/scan?event=...` etc.)
- Sidebar hides them by default
- They surface as Today's sub-items only when `/api/admin/today/active` returns `activeEventToday: true`
- They surface as prominent action tiles inside `/admin/today` (page built in Batch 12)

Rationale: event-day operations are subordinate to the event being live. When no event is today, exposing them as top-level sidebar items adds noise without value.

**Status:** ✓ resolved — implementation lands in M4 Batches 4 (`/api/admin/today/active`), 5 (sidebar reorg), and 12 (`/admin/today` page).

---

## 2026-05-07 — D08: Persona model adds `users.persona` column (M4 B4a)

**Source:** Operator confirmation in M4 Batch 0 review (PR [#55](https://github.com/bulletbiter99/air-action-sports/pull/55)). Three-option recommendation surfaced in [docs/m4-discovery/persona-dashboard-audit.md](m4-discovery/persona-dashboard-audit.md).

**Resolution:** M4 Batch 4a adds a `users.persona` column with values matching Surface 1's job-title personas (`owner / booking_coordinator / marketing / bookkeeper / generic_manager / staff`). The DB-level `users.role` column (3 values: owner / manager / staff) stays unchanged for capability gating; `users.persona` is a separate "lens preference" that drives which dashboard widgets render.

Sequencing:
- Migration 0026 (or later, depending on B2's saved_views migration cadence): add nullable `users.persona TEXT` column with CHECK constraint enumerating valid values
- Backfill: each existing user gets a default persona derived from their role (owner→owner, manager→generic_manager, staff→staff)
- `personaLayouts.js` keys flip from role-keyed to persona-keyed; the dashboard reads `user.persona` instead of `user.role`
- Admin UI: each user can change their own persona in profile settings; owners can set initial persona at user creation/invitation time

Rationale (rejecting Options 1 and 3):
- Option 1 (map design-personas → existing roles): would force every Marketing-style user to share Owner widgets, losing the "lens" quality of persona-tailored UX.
- Option 3 (per-user drag-drop personalization): much higher effort, blocks shipping, and adds a new abstraction (widget layouts table) to maintain. Defer to M5 or later.

**Status:** ✓ resolved — implementation lands in M4 Batch 4a.

---

## 2026-05-07 — D07: `refund_recorded_external` email template seeded (M4 prompt #30)

**Source:** M4 milestone prompt, Batch 3 spec — captured in [docs/m4-discovery/decisions-register-reconciliation.md](m4-discovery/decisions-register-reconciliation.md).

**Resolution:** A new email template `refund_recorded_external` will be seeded via migration `0027_bookings_refund_external.sql` alongside the schema columns for the external-refund flow. Template fields:
- Subject: "Refund issued for your AAS booking"
- Body specifies: amount refunded, method (`cash` / `venmo` / `paypal` / `comp` / `waived`), reference (operator-entered identifier), and a "contact us if discrepancy" closer.

The template is sent unconditionally when an out-of-band refund is recorded (see D06).

**Status:** ✓ resolved — implementation lands in M4 Batch 3.

---

## 2026-05-07 — D06: External refund flow always notifies customer (M4 prompt #29)

**Source:** M4 milestone prompt, Batch 3 spec — captured in [docs/m4-discovery/decisions-register-reconciliation.md](m4-discovery/decisions-register-reconciliation.md).

**Resolution:** The new "external / out-of-band refund" admin flow (cash / Venmo / PayPal / comp / waived) **always** sends the customer the `refund_recorded_external` email template (D07). There is no "skip notification" checkbox. Rationale: reduces customer-confusion incidents where money goes back via an unexpected channel; preserves audit-trail symmetry with Stripe refunds (which also auto-notify via `booking_refunded`).

**Status:** ✓ resolved — implementation lands in M4 Batch 3.

---

## 2026-05-07 — D05: Booking detail PII gated by `bookings.read.pii` capability (M4 prompt #26)

**Source:** M4 milestone prompt, Batch 3 spec — captured in [docs/m4-discovery/decisions-register-reconciliation.md](m4-discovery/decisions-register-reconciliation.md).

**Resolution:** On the new `/admin/bookings/:id` detail view (M4 B3), customer PII (full email, full phone) is conditionally rendered based on the requesting user's capabilities:
- Users with capability `bookings.read.pii` see full email + phone.
- Users without (e.g. Marketing role) see masked values (`j***@example.com`, `(***) ***-1234`).
- Every PII unmask (a click-to-reveal interaction or capability check that exposes PII) writes an audit-log row of action `customer_pii.unmasked` with `targetType=booking`, `targetId=bookingId`, `meta={fields: ['email','phone']}`.

Capability mapping to roles will be defined in M5 (staff infrastructure milestone) when role hierarchy expands. Until M5, the capability is implicitly granted to `manager` and `owner` roles.

**Status:** ✓ resolved — implementation lands in M4 Batch 3 (capability check + audit-log emission). Role-to-capability mapping table formalized in M5.

---

## 2026-05-07 — D04: Legacy `AdminDashboard` removed entirely (M4 prompt #23)

**Source:** M4 milestone prompt, Batch 10 / Batch 12 spec — captured in [docs/m4-discovery/decisions-register-reconciliation.md](m4-discovery/decisions-register-reconciliation.md).

**Resolution:** Once `new_admin_dashboard` reaches `state='on'` (M4 Batch 12), the legacy `AdminDashboard` code path (currently `AdminDashboardLegacy()` inside [src/admin/AdminDashboard.jsx](../src/admin/AdminDashboard.jsx)) is removed entirely. **No opt-in retention path** — admins cannot pin themselves to legacy after the flag flips to `on`. Rationale: dual maintenance burden + drift between the two views creates support confusion that outweighs any retention benefit.

Sequencing:
- M4 B10: degrade legacy by removing the inline bookings table widget; replace with a link card pointing at `/admin/bookings` (Batches 2-3).
- M4 B12: remove `AdminDashboardLegacy()` function + the flag-gated dispatcher in `AdminDashboard.jsx`; delete the `new_admin_dashboard` flag row from D1 (since it becomes always-on).

**Status:** ✓ resolved — implementation lands in M4 Batches 10 and 12.

---

## 2026-05-07 — D03: Audit pain-point #8 closed (lint config)

**Source:** `docs/audit/08-pain-points.md` #8 ("ESLint 9 + plugins declared in package.json but no eslint.config.js exists; lint not blocking in CI").

**Resolution:** Landed in M3 batch 0 task 0a:
- `eslint.config.js` flat config (ESLint recommended + react-hooks legacy rules + react-refresh; v7's new strict purity / set-state rules deliberately not adopted yet)
- `.github/workflows/ci.yml` lint step now blocking (dropped `continue-on-error: true`)
- Five blocking errors fixed; 253 informational warnings remain (deferred react-hooks and unused-vars cleanup; new code held to "no new warnings" by review)

**Status:** ✓ resolved

---

## 2026-05-07 — D02: Audit §08 Section 1 (operator-stated pain points) resolved

**Source:** `docs/audit/08-pain-points.md` Section 1 ("Operator-stated pain points (TBD by operator) — placeholder section").

**Resolution:** Operator declined to expand. The seeded candidate list at `docs/audit/08-pain-points.md` items 2-42 (the 42 code-observable issues) is treated as the ground-truth pain-point inventory. No additional operator-stated items will be added to Section 1.

**Status:** ✓ resolved — Section 1 may be removed in a future docs cleanup; for now it reads "see Section 2 onward" implicitly.

---

## 2026-05-07 — D01: Audit open question #13 (Phase 2 goal) resolved

**Source:** `docs/audit/10-open-questions.md` #13 ("What is the goal of Phase 2 (admin overhaul) — dashboard-first redesign? IA reorganization? Persona-tailored landing screens? Incremental polish?").

**Resolution:** Answered as **A + B + C + incremental** — all four directions in combination, sequenced across milestones:

| Phase 2 milestone | Direction emphasized |
|---|---|
| M2 (closed) | Incremental — shared primitives extraction, cross-route fix, feature-flag substrate |
| M3 (in flight) | C — persona-tailored AdminDashboard (Owner / BC / Marketing / Bookkeeper) + new customers entity (Surface 3) |
| M4 | A — IA reorganization (`/admin/bookings` redesign, sidebar restructure, visual regression suite) |
| M5 | B — staff infrastructure (new cron sweeps, role hierarchy expansion) |
| M6 | Stripe `setup_future_usage` to public booking flow (saves card on first paid booking; enables Surface 3 customer card view) |
| M7 | Reporting (funnel, LTV, segments — populates the Marketing persona widgets stubbed in M3 batch 9) |
| M8 | Closing — final hardening, M3-prep regrets, ROE owner-decision gaps if owner has resolved them by then |

**Status:** ✓ resolved
