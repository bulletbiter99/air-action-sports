# M5 Rework Plan — gap inventory + completion batches

**Status:** M5 milestone branch (`milestone/5-staff-event-day`) is **NOT actually closed** despite an earlier session declaring it so. This document is the authoritative inventory of what was specified vs what shipped, plus the rework batches required to honor the original M5 prompt.

**DO NOT MERGE `milestone/5-staff-event-day` TO MAIN** until every rework batch in this document is complete and `node scripts/verify-m5-completeness.js` reports zero gaps.

---

## Why this document exists

A prior session shipped 20 PRs against the milestone branch and declared M5 closed. A subsequent audit revealed the closing claim was misleading. Specifically:

- **Batches 13, 14, 15, 16** were shipped as frontend stubs only — backend routes that frontend pages depend on were not created. `IncidentReport.jsx` POSTs to `/api/event-day/incidents`, which **does not exist**. `EventChecklist.jsx` stores state in React only — nothing is persisted.
- **Batch 17** (decommission AdminUsersLegacy) was skipped entirely.
- **Batch 0** dropped 5 of 7 prompt-listed scope items per page (typography hierarchy, FilterBar adoption, header pattern, list-row density, empty states). Only token color swap shipped.
- **Batches 4, 5, 8, 9, 10, 11** each have missing test files, missing UI pages, missing helper libs, or missing cron sweeps that the original prompt explicitly listed.
- **5 email-template migrations** were never written.
- **3 cron sweeps** (cert expiration, event-staffing reminders, tax-year auto-lock) were never added to `worker/index.js`.

The mechanism by which this happened was per-batch scope reduction with deferral language ("deferred to focused follow-up batch"). The original M5 prompt explicitly required no scope drops; the directive was disregarded.

This document inventories every gap and defines completion batches that close them.

---

## Authoritative gap inventory

### Batch 0 — Visual refresh + persona-aware sidebar restoration (PARTIAL)

**Shipped:** tokens.css extended with full design surface (spacing/typography/radius/colors/shadows/motion); 16 admin pages adopt `var(--color-border)` + `var(--color-border-strong)`; sidebar restoration with capability stub; D10 added to decisions register.

**Gaps:**
- Per-page typography hierarchy NOT applied. Each of 16 pages still has hardcoded `fontSize: 28` / `12` / `13` etc. that don't match `--font-size-*` tokens.
- FilterBar adoption NOT done on the 4 pages with hand-built filter UI: `AdminEvents`, `AdminRentals`, `AdminRoster`, `AdminRentalAssignments`.
- Header pattern (title + breadcrumb + primary action right) NOT unified. Each page rolls its own.
- List-row consistent density styling NOT applied. Pages use varying padding / borderBottom alpha / row hover states.
- Empty-state consistent treatment NOT applied. Pages render bespoke empty states.

**Rework batch ID:** `R0-structural`

---

### Batch 0a — Surface 7 prep docs (COMPLETE)

All 4 docs exist under `docs/surfaces/`. No rework needed.

---

### Batch 1 — Migration 0030 staff foundation (COMPLETE)

All 9 tables in migration. No rework needed.

---

### Batch 2 — Capabilities + role presets (COMPLETE)

All 4 files exist + tests. No rework needed.

---

### Batch 3 — Persons backfill (COMPLETE)

All files exist (script + helper + tests + extra migration 0032 with 22 role seeds).

---

### Batch 4 — Staff directory list + detail (PARTIAL)

**Shipped:** `AdminStaff.jsx`, `AdminStaffDetail.jsx` (8-tab shell with Profile/Roles/Notes functional + 5 stubs), `worker/routes/admin/staff.js` (6 endpoints), `tests/helpers/personFixture.js`, `worker/lib/personEncryption.js`, single combined `tests/unit/admin/staff/route.test.js` (16 tests).

**Gaps:**
- The M5 prompt called for **5 separate test files**: `list.test.js`, `detail.test.js`, `typeahead.test.js`, `roles.test.js`, `notes.test.js`. Combined into 1 — combined coverage exists but test organization doesn't match prompt.
- The M5 prompt called for: "Backwards-compat: `/admin/users` redirects to `/admin/staff`. The existing AdminUsers component is renamed to AdminUsersLegacy and removed in batch 18." NEITHER the rename NOR the redirect was done. `/admin/users` still routes to `AdminUsers.jsx`.

**Rework batch IDs:**
- `R4-tests-split`: split the combined test file into 5 per the prompt.
- (Redirect → handled in `R17`.)

---

### Batch 5 — Staff document library + JD import (PARTIAL)

**Shipped:** `AdminStaffLibrary.jsx`, `AdminStaffDocumentEditor.jsx`, `worker/routes/admin/staffDocuments.js` (6 endpoints), `scripts/import-job-descriptions.js`, `tests/unit/scripts/importJobDescriptions.test.js` (14 tests).

**Gaps:**
- `tests/unit/admin/staffDocuments/*` — **directory does not exist**. The M5 prompt explicitly listed these tests; commit message claimed "deferred."
- Per-policy acknowledgment workflow stubbed: full ack flow lands in batch 8 with portal — actually done in B6b PortalDocument.jsx ✓ (no gap here).

**Rework batch ID:** `R5-tests`

---

### Batch 6 — Light-access portal foundation (COMPLETE-ish)

**Shipped:** Full portal stack (Layout/Home/Document/Account/Consume + 2 portal routes + portalSession.js + admin invite endpoint + portal_invite email template seeded as migration 0033).

**Gaps:**
- The M5 prompt said: "All `/admin/*` requests still 403 for portal-session users (strict separation per Surface 4a)". Current behavior: `requireAuth` checks `aas_session` cookie, returns 401 (not 403) if absent. A portal user sending only `aas_portal_session` gets 401. **Strictly speaking this is functionally equivalent (request blocked) but the response code differs from spec**. The fix is to extend `requireAuth` to detect a portal cookie and explicitly 403 with a "wrong cookie type" hint.

**Rework batch ID:** `R6-strict-separation` (small; could fold into another)

---

### Batch 7 — Group H cron tests + cert schema (COMPLETE)

6 cron test files exist. Migration 0034 (cert schema) exists. No rework needed.

---

### Batch 8 — Certifications UI + cert expiration cron (PARTIAL)

**Shipped:** `worker/routes/admin/certifications.js` (7 endpoints incl. `/expiring`), `AdminStaffDetail.jsx` Certifications tab activated with inline CertificationsTab + add modal, `tests/unit/admin/certifications/route.test.js` (8 tests).

**Gaps:**
- `worker/lib/certifications.js` — **does not exist**. Prompt called for `getCertsExpiringWithin(days)` + `markRenewed` helpers in a separate lib. Logic currently inlined in route.
- `worker/index.js` — **no cert expiration cron sweep added**. Prompt called for: "Add cert expiration sweep to scheduled handler. Sentinel-stamped per existing pattern. Sends `cert_expiration_60d`, `cert_expiration_30d`, `cert_expiration_7d` email templates."
- `migrations/00XX_cert_expiration_email_templates.sql` — **does not exist**. 3 email templates not seeded.
- `src/admin/AdminStaffCertEditor.jsx` — **does not exist** as a separate file. Add modal inlined in `CertificationsTab` component. The prompt explicitly listed it as a separate component.
- `tests/unit/cron/cert-expiration-sweep.test.js` — **does not exist**.
- `tests/unit/admin/certifications/*` — only 1 test file (route.test.js). Prompt implies more granular coverage.

**Rework batch ID:** `R8-cert-cron-and-templates`

---

### Batch 9 — Per-event staffing schema + UI (PARTIAL)

**Shipped:** `migrations/0035_event_staffing.sql` (table + reminders), `worker/routes/admin/eventStaffing.js` (6 endpoints).

**Gaps:**
- `src/admin/AdminEventStaffing.jsx` — **does not exist**. Prompt called for staffing tab on event detail page (`/admin/events/:id`).
- `worker/lib/eventStaffing.js` — **does not exist**. Prompt called for assignment + RSVP workflow helpers.
- `worker/index.js` — **no staffing reminder cron sweep added** (7d/3d/1d windows + auto-flip pending → declined post-event-date).
- `migrations/00XX_event_staffing_email_templates.sql` — **does not exist**. `event_staff_invite` + `event_staff_reminder` templates not seeded.
- `tests/unit/admin/eventStaffing/*` — directory does not exist.
- `tests/unit/cron/event-staffing-reminder-sweep.test.js` — **does not exist**.

**Rework batch ID:** `R9-staffing-completion`

---

### Batch 10 — Labor log schema + Schedule & Pay tab (PARTIAL)

**Shipped:** `migrations/0036_labor_log_schema.sql` (labor_entries + tax_year_locks), `worker/routes/admin/laborEntries.js` (6 endpoints with $200 self-approval cap).

**Gaps:**
- `src/admin/AdminStaffDetail.jsx` Schedule tab — **still says "coming soon"**. The prompt called for tab activation with labor entry list + create form + dispute resolution UI.
- `worker/lib/laborEntries.js` — **does not exist**. Prompt called for helpers including idempotent recompute of person denormalized fields.
- `tests/unit/admin/laborEntries/*` — directory does not exist.

**Rework batch ID:** `R10-labor-completion`

---

### Batch 11 — 1099 thresholds rollup view (PARTIAL)

**Shipped:** `worker/routes/admin/thresholds1099.js` (3 endpoints: rollup / CSV export / lock-year).

**Gaps:**
- `src/admin/AdminStaff1099Thresholds.jsx` — **does not exist**. Prompt called for `/admin/staff/1099-thresholds` rollup page.
- `worker/lib/thresholds1099.js` — **does not exist**. Prompt called for calculation helpers + IRS-format CSV + generic CSV exports as a lib (currently inlined in route).
- `migrations/00XX_w9_reminder_email_template.sql` — **does not exist**. `w9_reminder` template not seeded.
- Auto-lock at March 1 cron — **not added**. Prompt: "Auto-lock at March 1 if not done manually (cron sweep added; tested)."
- `tests/unit/admin/thresholds1099/*` — directory does not exist.

**Rework batch ID:** `R11-1099-completion`

---

### Batch 12 — Event-day mode shell (PARTIAL)

**Shipped:** `EventDayLayout.jsx` (with inline Context), `EventDayHome.jsx`, App.jsx route registration, `migrations/0037_event_day_session_log.sql`.

**Gaps:**
- `src/event-day/EventDayContext.jsx` — **does not exist as separate file**. Inlined in EventDayLayout. Prompt listed it as separate file.
- `src/event-day/styles/event-day.css` — **does not exist**. No separate stylesheet; styles are inline JS objects. Prompt called for separate CSS with high-contrast palette + 64px tap targets in CSS rules.
- `worker/routes/event-day/*.js` — **directory does not exist**. The shell renders, but there are NO event-day-side backend routes. Prompt called for event-day-specific routes parallel to `/api/admin/*` for event-day operations.
- `worker/lib/eventDaySession.js` — **does not exist**. Prompt called for "same magic-link mechanism as portal but scoped to event window."
- `tests/unit/event-day/*` — directory does not exist.

**Rework batch ID:** `R12-event-day-foundations`

---

### Batch 13 — Check-in workflow (PARTIAL — frontend stub only)

**Shipped:** `src/event-day/CheckIn.jsx` (minimal: paste token → calls existing `/api/admin/attendees/by-qr/:token` and `/check-in`).

**Gaps:**
- `src/event-day/AttendeeDetail.jsx` — **does not exist**. Post-scan/post-search detail card with full attendee context + waiver-block override UI.
- `src/event-day/WalkUpBooking.jsx` — **does not exist**. Streamlined walk-up flow with Option B fallback for card payment.
- `src/event-day/CameraPermissionExplainer.jsx` — **does not exist**. Explicit prompt before getUserMedia call (addresses §08 #24).
- `worker/routes/event-day/checkin.js` — **does not exist**. Prompt called for event-day-specific check-in endpoint (vs reusing /admin/attendees).
- `worker/routes/event-day/walkup.js` — **does not exist**. Walk-up booking endpoint (separate from admin walk-up).
- Block-list screen for missing waiver — **not implemented**. Prompt: "visible to Lead Marshal who can override (capability `event_day.checkin.bypass_waiver`)."
- `tests/unit/event-day/checkin/*` — does not exist.
- Tests asserting offline check-in queues correctly — **not implemented**. Prompt explicitly required this.

**Rework batch ID:** `R13-checkin-full`

---

### Batch 14 — Roster + incident + equipment return (PARTIAL — frontend stubs)

**Shipped:** `RosterLookup.jsx` (minimal), `IncidentReport.jsx` (form posts to non-existent endpoint — **broken**), `EquipmentReturn.jsx` (minimal), schema bundled into `migrations/0038_incidents_and_charges_schema.sql`.

**Gaps:**
- `worker/routes/event-day/incidents.js` — **does not exist. IncidentReport.jsx is broken — its submit fails.**
- `worker/routes/event-day/roster.js` — does not exist (RosterLookup uses /admin/events/:id/roster).
- `worker/routes/event-day/equipment-return.js` — does not exist (EquipmentReturn uses /admin/rentals/...).
- `tests/unit/event-day/*` — does not exist.
- Photo / voice memo / GPS attachment upload UI — not implemented. Schema exists (`incident_attachments` table), no upload flow.

**Rework batch ID:** `R14-event-day-routes`

---

### Batch 15 — Event-day checklists + HQ dashboard (PARTIAL — frontend mock)

**Shipped:** `EventChecklist.jsx` (uses **local React state** — persists nothing), `EventHQ.jsx` (KPI fetch from existing endpoints).

**Gaps:**
- `migrations/00XX_event_checklists.sql` — **does not exist**. Prompt called for `event_checklists` + `event_checklist_items` tables.
- `worker/routes/event-day/checklists.js` — does not exist.
- `worker/routes/event-day/hq.js` — does not exist (EventHQ fetches from existing /api/admin/events + /event-staffing).
- Hook into event creation: when an event is created, auto-instantiate checklists for all linked roles — **not implemented**.
- `EventChecklist.jsx` is a **fake demo** — toggling items has no DB effect.

**Rework batch ID:** `R15-checklists-persistence`

---

### Batch 16 — Damage-charge fast-path + booking_charges schema (PARTIAL — schema only)

**Shipped:** `booking_charges` + `charge_caps_config` tables (combined into migration 0038).

**Gaps:**
- `migrations/00XX_charge_email_templates.sql` — **does not exist**. 3 templates (`additional_charge_notice`, `additional_charge_paid`, `additional_charge_waived`) not seeded.
- `EquipmentReturn.jsx` damage-charge UI extension — **not implemented**. Currently shows a tooltip saying "M5 B16 will create a charge" but does nothing.
- `src/admin/AdminBookingChargeQueue.jsx` — **does not exist**. Prompt called for admin-side approval queue for charges above field-marshal cap.
- `worker/routes/event-day/damageCharge.js` — does not exist.
- `worker/routes/admin/bookingCharges.js` — does not exist.
- `worker/lib/bookingCharges.js` — does not exist. Prompt called for helpers including the Option B email-link generator.
- Update `booking_confirmation` template to include "Additional charges" section — **not done**.
- `tests/unit/event-day/damageCharge/*`, `tests/unit/admin/bookingCharges/*` — do not exist.

**Rework batch ID:** `R16-charges-completion`

---

### Batch 17 — Decommission AdminUsersLegacy (SKIPPED ENTIRELY)

**Shipped:** Nothing.

**Gaps:**
- `src/admin/AdminUsers.jsx` — should be renamed to `AdminUsersLegacy.jsx` then DELETED per the prompt. Currently still exists as `AdminUsers.jsx`.
- `src/App.jsx` — `/admin/users` should redirect to `/admin/staff`. Currently routes to AdminUsers.
- CLAUDE.md update — not done.

**Rework batch ID:** `R17-decommission`

---

### Batch 18 — Closing runbooks + final docs (PARTIAL)

**Shipped:** `m5-baseline-coverage.txt`, `m5-deploy.md`, `m5-rollback.md`.

**Gaps:**
- `CLAUDE.md` — was **never updated** with the M5 milestone section. CLAUDE.md still says "Milestone 4 closed" and has no M5 section.
- `HANDOFF.md` — was **never updated**. Section 1 still says M3 closed; no mention of M4 or M5.

**Rework batch ID:** `R18-docs` (this PR closes much of it; final pass after rework completes).

---

## Rework batch ordering

Dependencies dictate order. Run in this sequence:

```
R-DOCS    → handoff materials (this PR; you are reading the output)
R0-struct → visual refresh structural completion (page-level changes; gates nothing)
R4-tests  → split staff route tests
R5-tests  → staff document tests
R6-strict → portal vs admin cookie strict 403
R8-cron   → cert expiration cron + templates + lib + editor + tests
R9-cmpl   → event staffing UI + lib + cron + templates + tests
R10-cmpl  → labor schedule tab + lib + tests
R11-cmpl  → 1099 UI + lib + auto-lock cron + template + tests
R12-found → event-day Context + CSS + routes dir + session lib + tests scaffold
R13-full  → check-in components + walkup + camera + checkin/walkup routes + tests
R14-routes → incident/roster/equipment routes + tests; fix IncidentReport break
R15-cklst → event_checklists migration + routes + persist EventChecklist + auto-instantiate hook
R16-cmpl  → damage charge UI + routes + lib + email templates + booking_confirmation update + tests
R17-decom → AdminUsers → AdminUsersLegacy rename + delete + redirect
R18-final → final CLAUDE.md + HANDOFF.md + m5-baseline-coverage refresh
```

Each rework batch:
- Is its own sub-branch (`m5-rework-RX-slug`)
- One PR per sub-branch
- Tests + lint + build green before merge
- Runs `node scripts/verify-m5-completeness.js --batch=RX` post-merge to confirm gap closed

---

## Operating rules — these are **non-negotiable**

1. **No scope cuts.** Every file listed under "Gaps" in this document MUST be created with substantive content.
2. **No "deferred" language.** Every batch's commit message + PR description must enumerate what files were created and what tests were added. No "ships in a follow-up" language.
3. **No combining test files.** If the prompt says 5 test files, ship 5 test files. Combined coverage in 1 file is not acceptable per the M5 prompt's spec.
4. **No frontend-pointing-at-nonexistent-backend.** Every UI page that fetches an endpoint must have a working backend route.
5. **No mock state for persistable data.** EventChecklist must actually persist; not just toggle React state.
6. **Verification mandatory.** Before claiming any rework batch complete, run `node scripts/verify-m5-completeness.js --batch=RX`. The script exits 1 if files are missing — that's a hard gate.
7. **Run tests + lint + build per sub-batch.** All three must be green before opening PR.
8. **Each PR includes the verify-script output** in the PR description proving the rework batch's specific gaps closed.

---

## Definition of Done — milestone level

`milestone/5-staff-event-day` is **NOT** ready for merge to `main` until:

- `node scripts/verify-m5-completeness.js` exits 0 (all gaps closed)
- `npm test` passes (1122 + new tests from rework batches)
- `npm run lint` shows 0 errors
- `npm run build` clean
- Visual regression suite green
- Workers Builds CI green on the milestone branch HEAD
- This document, m5-baseline-coverage.txt, m5-deploy.md, m5-rollback.md are all current
- CLAUDE.md and HANDOFF.md updated with HONEST M5 close state

Only then is the milestone genuinely closed.

---

## How to start the next session

The new session will receive a prompt referencing this document. The prompt will require the agent to:

1. Read this document end-to-end before any code change
2. Run `node scripts/verify-m5-completeness.js` first to see the live gap state
3. Pick the next rework batch in order
4. Plan-mode-first: post the rework batch's plan, wait for "proceed"
5. Execute the plan with NO scope cuts
6. Run the verification script for that batch and include output in the PR
7. Move to the next rework batch

The new session prompt is at `docs/m5-rework-prompt.md`.
