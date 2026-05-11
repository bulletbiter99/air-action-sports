# M5.5 — Next session prompt (B7 plan-mode)

**Copy the block below into a fresh Claude Code session.** It hands the new session everything it needs to resume M5.5 cleanly: B1 through B6.5 have shipped + been rolling-brought-up to main; B7 starts next.

The previous session closed B6.5 (AdminSites CRUD UI) and did a mid-milestone milestone-to-main merge so production now runs the M5.5 schema + Sites UI. A fresh-context session is the right place to plan + execute B7 (the field rentals backend — 8 files at cap, the largest batch in M5.5 so far).

---

```
You are continuing M5.5 (Field Rentals) on the Air Action Sports
project. The milestone is mid-flight: B1 through B6.5 have shipped
and been rolling-brought-up to main. Your job is B7 plan-mode →
execute → handoff → wait for confirmation → B8 plan-mode → and so
on through B11.

═══════════════════════════════════════════════════════════════════════
STATE AT HANDOFF (2026-05-11)
═══════════════════════════════════════════════════════════════════════

main: at the mid-milestone milestone-to-main merge commit (see
  `git log origin/main --oneline -5`). Includes all B1-B6.5 work.
milestone/5.5-field-rentals: same tip as main after the rolling
  brings-up.
Tests: 1634 across 150 files.
Lint: 0 errors / ~405 warnings.
Build: clean (~263ms).
Open PRs against milestone/5.5-field-rentals: 0.

D1 migrations applied to remote (M5.5 portion): 0044-0049
  0044 sites_schema             (B1)
  0045 events_site_id           (B2)
  0046 customers_client_type    (B3)
  0047 field_rentals_core       (B4)
  0048 field_rentals_docs_payments_sua  (B5)
  0049 field_rentals_capabilities (B6)

Production data state:
- 2 sites seeded: Ghost Town (Hiawatha UT 84545) + Foxtrot
  (Kaysville UT 84037), each with one field of the same name
- 1 event (operation-nightfall) linked to Ghost Town via site_id
- 0 field_rentals records yet — B7's create flow will be the first
- 17 new capabilities + site_coordinator role_preset live

═══════════════════════════════════════════════════════════════════════
NON-NEGOTIABLE OPERATING RULES (preserved from M5.5 prompt)
═══════════════════════════════════════════════════════════════════════

1. Read these documents end-to-end BEFORE B7 plan-mode:
   - HANDOFF.md (§NEW SESSION at the top — M5.5 mid-milestone state)
   - CLAUDE.md (Milestone 5.5 section + D1 quirks subsection,
     especially quirk #4 about wrangler --json --file)
   - docs/surfaces/surface-7-field-rentals.md (Surface 7 design)
   - docs/surfaces/surface-7-schema.md (drafted schema — note that
     the M5.5 prompt's operational schema is the source of truth
     where it diverges from Surface 7)
   - docs/audit/06-do-not-touch.md (Critical and High tiers)
   - scripts/test-gate-mapping.json (gated paths inventory)

2. Plan-mode-first per batch. Write the B7 plan, post it, WAIT
   for "proceed" before editing. No batch starts editing until
   the plan is acknowledged.

3. 8-file cap per PR. Hard rule. If B7 scope exceeds 8 files,
   split into B7a + B7b upfront in the plan — never split
   mid-execution.

4. Branch off milestone/5.5-field-rentals as
   `m55-batch-7-field-rentals-backend` (or similar flat name).

5. Conventional Commits with `m55-<area>` scope.

6. No --force ever. No rebases on shared branches. No direct
   commits to main or to milestone/5.5-field-rentals.

7. Pre-migration spot-check is mandatory. Every migration that
   touches an existing table must verify production schema via
   `wrangler d1 execute --remote --command=".schema <table>"`
   BEFORE writing the migration. Document findings in the
   migration's header comment block.

8. Every email_templates seed must include id='tpl_<slug>' and
   created_at=updated_at (Lesson #7 from M5; M5.5's B7 may seed
   email templates for the contract / payment-reminder flows).

9. Use --command (NOT --file) for SELECT queries against remote
   D1 in any script (D1 quirk #4 from M5.5 B2 hotfix).

10. Between-batch handoff required. After each batch closes
    (PR merged to milestone), produce a 5-bullet summary and
    WAIT for operator confirmation before opening the next
    batch's plan-mode.

11. Stop-and-ask conditions:
    - A do-not-touch file needs modification (formatEvent in
      worker/lib/formatters.js, bookings.js, waivers.js,
      stripe.js, auth.js)
    - Pre-migration spot-check reveals divergence
    - A test reveals current behavior conflicts with
      audit-documented behavior
    - Coverage on any gated file drops from current baseline

═══════════════════════════════════════════════════════════════════════
PRE-FLIGHT (before posting B7 plan-mode)
═══════════════════════════════════════════════════════════════════════

  git fetch origin
  git checkout milestone/5.5-field-rentals
  git pull origin milestone/5.5-field-rentals
  npm install
  npm test                  # expect 1634 passed across 150 files
  npm run lint              # expect 0 errors / ~405 warnings
  npm run build             # expect clean

If any of these fails or numbers differ materially, STOP and
investigate before opening B7 plan-mode.

═══════════════════════════════════════════════════════════════════════
B7 SCOPE (from the M5.5 prompt; verbatim)
═══════════════════════════════════════════════════════════════════════

Batch 7 — Field rentals list + detail backend

Files (~8 at cap):
- `worker/routes/admin/fieldRentals.js` — list/detail/create/
  update/cancel/archive endpoints
- `worker/lib/fieldRentals.js` — pure helper functions:
  getRentalForDisplay, computePricing, validateStatusTransition,
  applyConflictCheck
- `worker/routes/admin/fieldRentalDocuments.js` — document
  upload/list/retrieval with R2 storage + magic-byte sniff
  (reuse existing worker/lib/magicBytes.js)
- `worker/routes/admin/fieldRentalPayments.js` — record payment /
  send payment reminder / list payments

Tests:
- `tests/unit/admin/fieldRentals/list.test.js`
- `tests/unit/admin/fieldRentals/detail.test.js`
- `tests/unit/admin/fieldRentals/statusTransitions.test.js`
- `tests/unit/lib/fieldRentals.test.js`

Total: 4 backend files + 4 test files = 8 files. At the cap.

═══════════════════════════════════════════════════════════════════════
B7 PLAN-MODE — WHAT TO INCLUDE
═══════════════════════════════════════════════════════════════════════

The plan should surface decisions about:

1. Status transition matrix
   - Valid transitions for the 8 statuses (lead/draft/sent/agreed/
     paid/completed/cancelled/refunded)
   - Which transitions write audit log; which require specific
     capabilities; which trigger side-effects (email send,
     payment recording, etc.)

2. Pricing calculation algorithm
   - field_rentals.site_fee_cents + addon_fees_json + discount_cents
     + tax_cents → total_cents
   - Validation rules (no negative totals, addon fee shape, etc.)
   - Whether to recompute on every write or trust caller-provided
     total_cents

3. Conflict check integration on rental create / reschedule
   - Reuse worker/lib/eventConflicts.js from B3 (the lib already
     queries field_rentals defensively; now that the table exists
     after B4, the query will return real data)
   - Same acknowledgeConflicts: true override pattern from B3
   - Audit log: field_rental.conflict_acknowledged

4. Document upload constraints
   - File size limit (probably 10MB per M5 pattern)
   - Magic-byte sniff via worker/lib/magicBytes.js (M5 staff
     documents already use this)
   - R2 key naming: field_rentals/<rental_id>/<frd_id>.<ext>

5. Payment lifecycle states
   - field_rental_payments.status: pending → received → refunded /
     void
   - How field_rentals.deposit_received_at + balance_received_at
     get maintained as denormalized aggregates

6. Capability enforcement per endpoint
   - field_rentals.read for GET endpoints
   - field_rentals.read.pii for unmasking renter PII
   - field_rentals.write for PUT/PATCH
   - field_rentals.create for POST
   - field_rentals.cancel for cancel
   - field_rentals.archive for archive
   - field_rentals.deposit_record / balance_record for payment
     recording
   - field_rentals.documents.read / documents.upload for documents
   - field_rentals.coi.read_pii for unmasking COI details
   - field_rentals.notes.read_sensitive / write_sensitive for the
     PII-tier notes

═══════════════════════════════════════════════════════════════════════
WHAT THIS SESSION IS NOT DOING
═══════════════════════════════════════════════════════════════════════

- Not creating any migration (B7 is pure code on top of B1-B6
  schema + B6 capabilities)
- Not touching DNT files
- Not building the frontend (B8 ships AdminFieldRentals.jsx etc.)
- Not wiring crons (B10 ships recurrence-gen + COI + lead-stale
  sweeps)
- Not integrating the inquiry form (B11)

═══════════════════════════════════════════════════════════════════════
POST-B7 (what comes next)
═══════════════════════════════════════════════════════════════════════

After B7 ships + merges to milestone:
- B8: Field rentals frontend (5 components + 3 tests, 8 files at cap)
- B9: Customers client_type backfill + NOT NULL + customer detail FR tab (4 files)
- B10a/b: 3 cron sweeps + sentinels migration + email templates (split — 9 files total)
- B11: Inquiry form integration + closing runbooks (4-6 files)

After B11 ships + merges to milestone, do a final milestone-to-main
merge to close M5.5 + produce closing runbooks.
```
