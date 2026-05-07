# Decisions Register

Closes audit open questions and operator-decision-pending placeholders as they're resolved. Newest at top. Reference each entry by its date + short ID when citing in code/PRs.

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
