# M5 Deploy — fresh session prompt (HISTORICAL — M5 deployed 2026-05-08)

> **STATUS: HISTORICAL.** This prompt drove the M5 deploy through Phases 2-6 in a fresh session on 2026-05-08. Production now runs M5 at `main` SHA `82fc839`; all 14 M5 D1 migrations (0030-0043) applied to remote; latest Workers deployment `fb1d535b-d6ca-4cd0-ae98-c49601b27ab8` at 2026-05-08T22:50 UTC.
>
> **Phase 4 surfaced an email_templates schema gap** — the initial migration apply failed at `0033` with `NOT NULL constraint failed: email_templates.created_at` because the M5 seed migrations omitted required `id` + `created_at` columns. Hotfix PR [#143](https://github.com/bulletbiter99/air-action-sports/pull/143) added them to migrations 0033/0039/0040/0041/0043; re-apply landed all 14 cleanly. The durable lesson is captured as Lesson #7 in HANDOFF.md and CLAUDE.md M5 section.
>
> **For new sessions doing post-M5 work**: use the generic resumption prompt at the bottom of HANDOFF.md.

---

The block below is the original deploy prompt; preserved for reference.

---

```
You are continuing M5 (Staff Management + Event-Day Mode) on the
Air Action Sports project. The 16-batch rework session shipped all
PRs (#122-#140) to milestone/5-staff-event-day. The previous session
completed Phase 1 (all PRs merged to milestone branch); your job is
Phases 2-6 (deploy to production).

Production currently runs M4 close at SHA 7594d9a. None of M5's 14
D1 migrations (0030-0043) are applied to remote D1 yet. The
milestone branch is code-complete + verify-m5 green; main is not.

═══════════════════════════════════════════════════════════════════════
NON-NEGOTIABLE OPERATING RULES
═══════════════════════════════════════════════════════════════════════

1. Read these documents end-to-end BEFORE any irreversible action:
   - HANDOFF.md (§NEW SESSION at the top)
   - CLAUDE.md (Milestone 5 section + the D1 quirks subsection)
   - docs/runbooks/m5-baseline-coverage.txt (current gated paths)

2. Verify milestone/5 BEFORE merging to main:
     git checkout milestone/5-staff-event-day
     git pull
     npm install
     npm test                           # expect 1538 passed across 146 files
     npm run lint                       # expect 0 errors / ~391 warnings
     npm run build                      # expect clean (~250ms)
     node scripts/verify-m5-completeness.js   # expect 15/15 · 95/95

   If any of these fails, STOP and report. Do NOT proceed to Phase 3.

3. Check open PRs on milestone/5 before opening the milestone-to-main
   PR. Should be 0:
     gh pr list --state open --base milestone/5-staff-event-day

4. The four irreversible actions, in order:
   - Phase 3: Open + merge milestone/5 → main PR (revert is possible
     but disruptive)
   - Phase 4: Apply 14 D1 migrations to remote (FORWARD-ONLY by
     convention; no rollback)
   - Phase 5: Workers Builds auto-redeploys on push to main; verify
     it succeeded
   - Phase 6: Smoke-test production endpoints

   Run them sequentially. Do not parallelize.

5. Apply migrations BEFORE the deploy. The new code references tables
   from migrations 0030-0043 — if the deploy lands first, every M5
   route will throw on the missing-table queries.

   Wait — actually, all M5 routes DEFENSIVELY catch missing-table
   errors and return graceful fallbacks (per the M5 lib pattern), so
   technically deploy-before-migrate would not break production. But
   the cleaner sequence is migrate → deploy.

6. Stop and ask if:
   - npm test fails on milestone/5 (do NOT merge to main)
   - verify-m5 reports anything other than 15/15 · 95/95
   - migration apply errors on any of 0030-0043 (forward-only — must
     resolve before continuing)
   - smoke-test fails after deploy (revert main if needed)

═══════════════════════════════════════════════════════════════════════
PHASE-BY-PHASE PUNCH LIST
═══════════════════════════════════════════════════════════════════════

**Phase 2 — Verify milestone/5 (read-only):**

  git fetch origin
  git checkout milestone/5-staff-event-day
  git pull origin milestone/5-staff-event-day
  npm install
  npm test                           # 1538 passed across 146 files
  npm run lint                       # 0 errors
  npm run build                      # clean
  node scripts/verify-m5-completeness.js   # 15/15 · 95/95

  All green → continue. Any red → STOP.

**Phase 3 — Open + merge milestone/5 → main PR:**

  gh pr create --base main --head milestone/5-staff-event-day \
    --title "M5: Staff Management + Event-Day Mode" \
    --body-file docs/runbooks/m5-deploy.md

  Wait for CI green, then merge:

  gh pr view <PR#> --json mergeable,mergeStateStatus
  # Confirm CLEAN + MERGEABLE
  gh pr merge <PR#> --merge

  Note: this triggers Workers Builds auto-redeploy on the merge to
  main. The deploy starts ~30s after merge; takes ~2-3min.

**Phase 4 — Apply 14 D1 migrations to remote:**

  source .claude/.env
  npx wrangler d1 migrations list air-action-sports-db --remote
  # Confirm 0030-0043 are unapplied (they should all be in the
  # "Migrations to be applied" list if the prior session never ran them)

  CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 migrations apply air-action-sports-db --remote
  # Wrangler applies in ascending order. Confirm each succeeds.

  npx wrangler d1 migrations list air-action-sports-db --remote
  # Confirm all migrations now in "Already-applied" list.

  If any migration fails: D1 quirks remind you that BEGIN/COMMIT
  keywords cannot appear (CLAUDE.md D1-quirks subsection). The
  migrations were authored to avoid this — but if a transient D1
  error occurs, retry; the migrations are idempotent in the sense
  that wrangler tracks applied state.

**Phase 5 — Verify Workers Builds redeploy:**

  Wait ~3min after Phase 3 merge. Check:

  curl -s https://airactionsport.com/api/health
  # Expect: {"ok":true,"ts":<recent-epoch-ms>}

  curl -s https://airactionsport.com/api/health | jq -r '.ts' | \
    awk '{print ($0/1000) " " (systime() - 60)}'
  # Expect ts to be within ~60s of now (proving recent deploy)

  Cloudflare dashboard:
  https://dash.cloudflare.com/workers/services/view/air-action-sports
  Check the "Deployments" tab — most recent deployment should be
  from the milestone-to-main merge commit.

**Phase 6 — Smoke-test production:**

  curl -s https://airactionsport.com/api/health
  # → {"ok":true,...}

  curl -s -I -L https://airactionsport.com/admin/users
  # Expect 200 then redirect (frontend route) — but the actual
  # /admin/users → /admin/staff redirect happens client-side via
  # React Router <Navigate>. Test in browser:
  #   Open https://airactionsport.com/admin/users in browser
  #   → should land at /admin/staff after sign-in

  curl -s https://airactionsport.com/event
  # Expect: SPA HTML (event-day shell renders client-side).
  # Test in browser to confirm high-contrast palette + 64px tap
  # targets (R12 CSS).

  Manual smoke-test (browser):
  1. /admin/users → 302/redirect to /admin/staff (R17)
  2. /event → kiosk shell loads with black bg, white text, orange
     accents, 64px tap targets (R12)
  3. /admin/booking-charges → admin queue page renders (R16)
  4. /admin/staff/1099-thresholds → bookkeeper rollup page renders
     (R11)

  If a live event is upcoming + scheduled: create a test event
  via /admin/events and verify checklists auto-instantiate at
  /event/checklist (R15 hook).

═══════════════════════════════════════════════════════════════════════
POST-DEPLOY (what you do AFTER all 6 phases pass)
═══════════════════════════════════════════════════════════════════════

1. Update HANDOFF.md §NEW SESSION:
   - Replace "⚠ NEW SESSION — finish M5 deploy" with
     "✓ M5 deployed to production (date)"
   - Move the rework + lessons + deploy summary into a
     historical section
   - Clear the "Phases remaining" punch list

2. Update CLAUDE.md M5 section heading:
   - Change "✓ CODE COMPLETE 2026-05-08; awaits deploy" to
     "✓ CLOSED + DEPLOYED <date>"

3. Mark docs/m5-deploy-prompt.md (this file) as historical with a
   header comment noting M5 was deployed on <date>.

4. Mark docs/m5-rework-prompt.md as historical similarly.

5. Optional follow-ups (M5+ polish, deferred during rework):
   - Stripe Checkout integration for damage-charge payment links
     (R16 left this M6 territory)
   - personHasCapability lib extraction (R13 hardcoded role
     allow-list works for now)
   - AdminScan + AdminRoster ?event= deep-link parameter parsing
     (M4 known polish item)
   - Audit Group H cron tests (M5 deferred this; H71-H76)

═══════════════════════════════════════════════════════════════════════
CRITICAL CONTEXT FOR THE NEW SESSION
═══════════════════════════════════════════════════════════════════════

- Production data state: NO M5 schema applied. The 14 migrations
  0030-0043 must apply BEFORE any operator does anything M5-feature-
  related (creating staff, viewing /admin/staff, event creation
  triggering checklist auto-instantiate, etc.).

- Deploy credentials: .claude/.env contains CLOUDFLARE_API_TOKEN.
  The deploy-air-action-sports skill is available if manual deploy
  is needed (Workers Builds typically auto-deploys on push).

- The 3 new cron sweeps (cert expiration, event-staffing reminder +
  auto-decline, tax-year auto-lock) auto-register on the next
  Workers Builds redeploy. They join the existing 03:00 UTC trigger.
  First execution: the next 03:00 UTC after the deploy completes.
  Cert expiration sweep needs migration 0039 applied; staffing
  sweeps need 0040; auto-lock sweep needs 0041.

- Custom bookings_confirmation template: migration 0043 uses
  `INSERT OR IGNORE` so an operator's custom version is preserved.
  If the operator wants to re-baseline, they can delete the
  existing row first, then re-run the migration.

- Workers Builds deployment URL pattern: the merge commit SHA is
  visible in dash.cloudflare.com/workers/services/view/
  air-action-sports under Deployments. Confirm there's a deployment
  whose source is the milestone-to-main merge commit.

═══════════════════════════════════════════════════════════════════════
ACKNOWLEDGMENT
═══════════════════════════════════════════════════════════════════════

Before doing anything else, respond with a one-paragraph
acknowledgment that explicitly:

1. Confirms you have read this prompt + HANDOFF.md §NEW SESSION +
   CLAUDE.md Milestone 5 section
2. Confirms you understand the migrations are FORWARD-ONLY and the
   sequence is verify → milestone-merge → migrate → verify-deploy →
   smoke-test
3. Confirms you will run `npm test` and `verify-m5-completeness.js`
   on milestone/5 BEFORE proposing any merge
4. Lists what you'll do in Phases 2-6 in order

Then run Phase 2's verification. Wait for "proceed" before opening
the milestone-to-main PR.
```

---

## Notes for the operator

- This prompt is engineered with the same "stop and ask" gating that the rework prompt used. The verify gate before the milestone-to-main merge is the most important checkpoint.

- If the migration apply fails on a specific migration, **stop and check what's already applied**. Wrangler tracks applied state per-database; partial application is recoverable but you need to know which migrations are in-flight.

- After deploy succeeds, run the post-deploy doc updates (HANDOFF.md, CLAUDE.md heading, this file's status). That clean-up makes the NEXT session see "M5 deployed" instead of "M5 ready to deploy".

- The full rework history lives in the merged PR descriptions (#122-#140) and in `docs/runbooks/m5-{rework-plan,baseline-coverage,deploy,rollback}.md`. The deploy session shouldn't need to re-derive any of that context.
