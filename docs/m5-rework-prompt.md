# M5 Rework — fresh session prompt (HISTORICAL — rework complete 2026-05-08)

> **STATUS: SUPERSEDED.** This prompt drove the M5 rework through R0-R18. All 16 rework PRs (#122-#140) merged to `milestone/5-staff-event-day` on 2026-05-08. Verify-m5 reports 15/15 batches complete · 95/95 checks pass.
>
> **M5 deployed 2026-05-08.** Both this rework prompt and [m5-deploy-prompt.md](m5-deploy-prompt.md) are now historical. For new sessions doing post-M5 work: use the generic resumption prompt at the bottom of HANDOFF.md.

---

The block below is the original rework prompt; preserved for reference.

---

```
You are continuing M5 (Staff Management + Event-Day Mode) on the
Air Action Sports project. The first session shipped 20 PRs against
`milestone/5-staff-event-day` and declared M5 closed, but a subsequent
audit revealed substantial scope gaps. A second (rework) session has now
landed 8 of 15 rework batches (PRs #122-#130). 7 batches remain. The
branch is still NOT ready to merge to main.

Your single job in this session: complete the remaining M5 rework
batches per docs/runbooks/m5-rework-plan.md, with NO scope cuts. Pick
up at R11-1099-completion (the next batch in dependency order).

═══════════════════════════════════════════════════════════════════════
NON-NEGOTIABLE OPERATING RULES
═══════════════════════════════════════════════════════════════════════

1. Read these documents end-to-end BEFORE any code change:
   - docs/runbooks/m5-rework-plan.md — authoritative gap inventory
   - CLAUDE.md (M5 section)
   - HANDOFF.md
   - docs/audit/06-do-not-touch.md (still applies)

2. Run `node scripts/verify-m5-completeness.js` immediately. This is the
   live gap state. Output is the authoritative starting point. If output
   conflicts with what the rework-plan says, trust the script.

3. Pick rework batches IN ORDER. Already done by the prior rework session
   (R0a + R0b + R0c, R4, R5, R6, R8, R9, R10 — verify-m5 will report
   them PASS). REMAINING in dependency order:
     R11-1099-completion → R12-event-day-foundations →
     R13-checkin-full → R14-event-day-routes →
     R15-checklists-persistence → R16-charges-completion →
     R17-decommission → R18-final
   The order honors dependencies (R12 foundations before R13/14/15/16
   which extend the event-day stack; R17 decommission near the end so
   admin tests stay valid; R18 is closing docs).

4. Plan-mode-first per rework batch: write a plan, post it, wait for
   "proceed" before editing.

5. NO scope cuts. Every file listed under "Gaps" in the rework-plan
   for that batch MUST be created with substantive content. Substantive
   means: tests assert real behavior (not just `expect(true).toBe(true)`),
   UI pages render functional UI tied to real API endpoints, lib files
   export the helpers the routes consume.

6. NO "deferred" language in commits. Each rework PR must enumerate
   every file added with substantive coverage description. If you find
   yourself wanting to write "deferred to follow-up batch", stop and
   complete the work in the current batch.

7. NO combining test files unless the prompt's source M5 file list
   says so. If the prompt called for 5 separate test files, ship 5.

8. NO frontend pointing at non-existent backend. Every UI fetch URL
   must resolve to a working route in this PR or an earlier one.

9. NO mock-state for persistable data. EventChecklist must persist
   to D1, not just toggle React state.

10. Verification mandatory before claiming completion:
    - `node scripts/verify-m5-completeness.js --batch=R<batch-id>`
      MUST exit 0
    - `npm test` passes
    - `npm run lint` shows 0 errors
    - `npm run build` clean
    - Include the verify-script output in the PR description, copy
      the "[ PASS ] R<batch-id>" line verbatim

11. Branch + PR cadence (preserved from M5):
    - Sub-branch off `milestone/5-staff-event-day` named
      `m5-rework-R<id>-<slug>`
    - One PR per sub-branch
    - 10-file cap per PR (split a/b if needed)
    - Conventional Commits with `m5-rework-<area>` scope
    - Merge to milestone branch after CI green
    - DO NOT merge milestone branch to main until ALL rework
      batches complete and overall verify exits 0

12. Stop and ask if:
    - A do-not-touch file needs modification beyond the rework's scope
    - A test reveals current behavior conflicting with audit-documented
      behavior
    - The original M5 prompt's spec for a batch conflicts with the
      rework plan (rework plan wins; flag the conflict)
    - You discover a NEW gap not listed in the rework plan (add it
      explicitly via a rework-plan amendment PR before fixing it)

═══════════════════════════════════════════════════════════════════════
IMMEDIATE FIRST STEPS
═══════════════════════════════════════════════════════════════════════

1. cd into the AAS project root.
2. `git checkout milestone/5-staff-event-day && git pull`
3. `npm test` (confirm baseline 1287 tests passing across 133 files —
   that's the post-R10 state from the prior rework session)
4. `node scripts/verify-m5-completeness.js` (confirm baseline 8/15
   batches complete, 43/95 checks pass — that's the rework progress
   when this session starts)
5. Read docs/runbooks/m5-rework-plan.md fully. Skim the "Lessons learned"
   section below before R11.
6. Post the plan for R11-1099-completion (next batch).
   Wait for "proceed".
7. Execute. After tests + lint + build green and
   `verify-m5-completeness.js --batch=R11-1099-completion` exits 0, open
   the PR.

═══════════════════════════════════════════════════════════════════════
LESSONS LEARNED FROM PRIOR REWORK BATCHES (R0-R10)
═══════════════════════════════════════════════════════════════════════

These were caught + fixed mid-batch in the rework session. Apply them
preemptively in remaining batches.

1. **Verify-m5 cron-sweep regex requires `const NAME = ` declaration**
   in `worker/index.js`. Bare imports don't match. When you wire a
   cron sweep imported from a lib file, alias it with a top-level const:
   ```js
   import { runMySweep as _runMySweep } from './lib/...';
   // top-level alias so verify-m5 cron-sweep regex (`const NAME = `)
   // detects the sweep is wired up here:
   const runMySweep = _runMySweep;
   ```
   Used by R8 + R9.

2. **Verify-m5 tab-active regex (`activeTab === 'X'.*ComingSoon` with
   `/s` flag) spans the whole file.** A placeholder helper named
   `ComingSoon` further down in the same file false-positives even
   after the JSX line changes. Rename the helper (R10 used
   `TabPlaceholder`). Affects any tab-activation in
   src/admin/AdminStaffDetail.jsx.

3. **Don't hardcode SQL result column literals.** `INSERT ... VALUES
   (?, ?, ?, 'sent')` makes `expect(args).toContain('sent')` assertions
   fail because the value is in the SQL string, not the args array.
   Always parameterize: `VALUES (?, ?, ?, ?)` and bind `'sent'` as the
   4th arg. Caught + fixed in R9 mid-batch.

4. **`useMemo` inside JSX after an early return guard violates
   `react-hooks/rules-of-hooks`.** R0b had
   `<FilterBar schema={useMemo(() => CONST, [])} />` after
   `if (!isAuthenticated) return null;` — fix is either move the
   `useMemo` to component top OR pass a module-level constant
   directly (the static-CONST case).

5. **`requireAuth` portal-cookie 403 path only fires when admin cookie
   is genuinely absent** (parseCookieHeader returns falsy). Garbled
   admin cookie + portal cookie still goes through admin path → 401.
   Preserves F57 (no-cookie returns 401).

6. **Verify-m5 dirGlob checks** look at any file in the named directory
   for the pattern. A broken-up fix across multiple migrations works
   if the cumulative content matches. Use this when a single migration
   file would be too big to fit the 10-file PR cap.

═══════════════════════════════════════════════════════════════════════
PRIOR REWORK PROGRESS (R0-R10) — for reference
═══════════════════════════════════════════════════════════════════════

| Batch | PR | Verify | Highlights |
|---|---|---|---|
| R0a | #122 | partial of R0 | AdminPageHeader + EmptyState shared primitives + 4 admin pages |
| R0b | #123 | partial of R0 | 7 mid-size admin pages (Users / Waivers / Roster / TaxesFees / EmailTemplates / Vendors / PromoCodes) |
| R0c | #124 | R0 8/8 | 5 largest admin pages — all 16 admin pages now have all 7 M5 B0 scope items |
| R4  | #125 | 5/5 | combined route.test.js → 6 files (5 spec'd + archive); 5 new typeahead tests |
| R5  | #126 | 5/5 | 4 staff document route tests in tests/unit/admin/staffDocuments/ |
| R6  | #127 | 2/2 | requireAuth portal-cookie 403 distinction |
| R8  | #128 | 8/8 | worker/lib/certifications.js + AdminStaffCertEditor.jsx + cron + 3 templates (mig 0039) |
| R9  | #129 | 8/8 | AdminEventStaffing.jsx + worker/lib/eventStaffing.js + 2 crons + 2 templates (mig 0040) |
| R10 | #130 | 4/4 | Schedule tab activated + worker/lib/laborEntries.js |

Tests: 1122 baseline → 1287 (+165). Lint: 0 errors / 384 warnings.
Verify: 8/15 batches complete · 43/95 checks pass.

Migrations 0039 + 0040 are queued for operator-applies-remote at
milestone close. R11-R16 may add more (R11: w9_reminder template;
R15: event_checklists schema; R16: 3 charge email templates +
booking_confirmation update).

═══════════════════════════════════════════════════════════════════════
WHAT THE PRIOR SESSION DROPPED — AT A GLANCE
═══════════════════════════════════════════════════════════════════════

(Reference only; full inventory in m5-rework-plan.md)

- 21+ files specified in the M5 prompt that were never created
- 3 cron sweeps not added to worker/index.js (cert expiration,
  event-staffing reminders, tax-year auto-lock)
- 8+ email templates not seeded (cert_expiration_60d/30d/7d,
  event_staff_invite, event_staff_reminder, w9_reminder,
  additional_charge_notice/paid/waived)
- 4 broken UI states (Schedule tab "coming soon"; IncidentReport
  posts to non-existent endpoint; EventChecklist fake mock state;
  EquipmentReturn damage-charge stub does nothing)
- 5+ migrations not written (event_checklists, multiple email
  template seeds)
- B17 (decommission AdminUsersLegacy + /admin/users redirect) was
  skipped entirely
- B0 dropped 5 of 7 prompt-listed scope items (typography hierarchy,
  FilterBar adoption, header pattern, list-row density, empty states)
- CLAUDE.md and HANDOFF.md were never updated with M5 milestone
  section

═══════════════════════════════════════════════════════════════════════
DEFINITION OF DONE — MILESTONE LEVEL
═══════════════════════════════════════════════════════════════════════

`milestone/5-staff-event-day` is ready to merge to main only when:

- `node scripts/verify-m5-completeness.js` exits 0 (all 95+ checks pass)
- `npm test` passes
- `npm run lint` shows 0 errors
- `npm run build` clean
- Visual regression suite green
- Workers Builds CI green on milestone branch HEAD
- docs/runbooks/m5-baseline-coverage.txt refreshed with post-rework
  test counts
- CLAUDE.md and HANDOFF.md updated with HONEST M5 close state

After all the above, open a PR from `milestone/5-staff-event-day`
to `main` and request operator approval.

═══════════════════════════════════════════════════════════════════════
MANDATORY ACKNOWLEDGMENT
═══════════════════════════════════════════════════════════════════════

Before doing anything else, respond with a one-paragraph acknowledgment
that explicitly:
1. Confirms you have read m5-rework-plan.md and the "Lessons learned"
   section above
2. Confirms you understand "no scope cuts" means every gap-listed file
   must be created with substantive content
3. Confirms you will run verify-m5-completeness.js before claiming any
   batch complete
4. Lists the REMAINING rework batches in execution order (R11 → R12
   → R13 → R14 → R15 → R16 → R17 → R18) — the prior rework session
   already landed R0a/R0b/R0c, R4, R5, R6, R8, R9, R10

After acknowledgment, run the verification script (expect 8/15 PASS,
43/95 checks) and post your R11-1099-completion plan.
```

---

## Notes for the operator

- This prompt is written to make scope-cuts hard. The verification script is the gating mechanism — the new session can claim whatever they want, but if the script doesn't pass, the rework batch isn't done.

- If a rework batch is genuinely too large to fit in one sub-batch (10-file cap), the new session should split into Ra/Rb/Rc — that's allowed (R0 was split in the prior rework session). What's NOT allowed is shipping fewer files than the rework plan lists.

- New session should treat `docs/runbooks/m5-rework-plan.md` as authoritative. If you discover a gap the plan didn't list, add it via a quick rework-plan amendment PR before doing the fix work.

- **Remaining rework scope (R11-R18):** ~7 sub-PRs, ~25-35 new files (helpers / routes / UI / tests), ~3-4 new migrations (R11 w9_reminder; R15 event_checklists schema; R16 3 charge templates + booking_confirmation update), ~1-2 new cron sweeps (R11 tax-year auto-lock).

- **R14 fixes a known production bug** — `IncidentReport.jsx` posts to `/api/event-day/incidents` which doesn't exist; it 404s on submit. The fix is part of R14's scope.

- **R15 rewires fake-mock state** — `EventChecklist.jsx` currently uses local React state with no persistence. R15 adds the migration, routes, and rewires the component to actually POST.

- The milestone branch is currently unmergeable to main. **Do not merge until rework completes** (verify-m5 exits 0).

- After R18 closes, the milestone-to-main PR is opened and the operator runs the queued migrations to remote D1 (0039, 0040, plus any added by R11/R15/R16). Workers Builds redeploy auto-registers the new cron sweeps.
