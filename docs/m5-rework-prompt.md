# M5 Rework — fresh session prompt

**Copy the block below into a fresh Claude Code session.** It hands the new session everything it needs to complete the M5 rework with no scope cuts.

---

```
You are continuing M5 (Staff Management + Event-Day Mode) on the
Air Action Sports project. A previous session shipped 20 PRs against
`milestone/5-staff-event-day` and declared M5 closed, but a subsequent
audit revealed substantial scope gaps. The branch is NOT ready to merge
to main.

Your single job in this session: complete the M5 rework batches per
docs/runbooks/m5-rework-plan.md, with NO scope cuts.

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

3. Pick rework batches IN ORDER (R0-structural -> R4-tests-split ->
   R5-tests -> R6-strict -> R8-cron -> R9-cmpl -> R10-cmpl -> R11-cmpl
   -> R12-found -> R13-full -> R14-routes -> R15-cklst -> R16-cmpl ->
   R17-decom -> R18-final). The order honors dependencies (e.g., R12
   foundations before R13/14/15/16 which extend the event-day stack).

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
3. `npm test` (confirm baseline 1122 tests passing)
4. `node scripts/verify-m5-completeness.js` (confirm baseline 1/95
   checks pass — that's normal at session start)
5. Read docs/runbooks/m5-rework-plan.md fully.
6. Post the plan for R0-structural (the first rework batch).
   Wait for "proceed".
7. Execute. After tests + lint + build green and
   `verify-m5-completeness.js --batch=R0-structural` exits 0, open
   the PR.

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
1. Confirms you have read m5-rework-plan.md
2. Confirms you understand "no scope cuts" means every gap-listed file
   must be created with substantive content
3. Confirms you will run verify-m5-completeness.js before claiming any
   batch complete
4. Lists the rework batches in execution order

After acknowledgment, run the verification script and post your
R0-structural plan.
```

---

## Notes for the operator

- This prompt is written to make scope-cuts hard. The verification script is the gating mechanism — the new session can claim whatever they want, but if the script doesn't pass, the rework batch isn't done.

- If a rework batch is genuinely too large to fit in one sub-batch (10-file cap), the new session should split into Ra/Rb/Rc — that's allowed. What's NOT allowed is shipping fewer files than the rework plan lists.

- New session should treat `docs/runbooks/m5-rework-plan.md` as authoritative. If you discover a gap the plan didn't list, add it via a quick rework-plan amendment PR before doing the fix work.

- Estimated rework scope: ~15 sub-PRs, ~40-60 new files (helpers / routes / UI / tests), ~5 new migrations, ~3 new cron sweeps. This is genuine work, not boilerplate.

- The milestone branch is currently unmergeable to main. **Do not merge until rework completes.**
