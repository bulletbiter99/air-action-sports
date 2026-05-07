# M2 Rollback Runbook

How to roll back milestone 2 (shared primitives + cross-route fix) if it's found broken on `main` after the milestone merge. Applies to whoever is on call when something starts failing post-deploy.

This runbook covers rolling back **M2 itself**. For rolling back a single batch within the milestone (before milestone-merge), see "Partial rollback during the milestone" at the bottom.

---

## When to invoke this runbook

Trigger on any of:

- **CI red on `main`** for `Vitest + coverage (Node 20)` after the milestone merge, and rerunning doesn't fix it (i.e. it's not a flake).
- **`npm test` fails locally on `main`** when a fresh clone + `npm install` should produce 471 passing.
- **Cloudflare Workers Builds failing** on `main` after the merge (worker import errors, build errors).
- **A customer- or admin-visible regression** that bisects to a milestone-merge commit on `main`. M2 added shared helpers (`writeAudit`, money/email helpers, `findExistingValidWaiver` relocation) consumed by admin code, plus the feature-flag substrate. Most likely regression vectors:
  - Admin manual booking POST regressing tax/fee math (Group E parity guard would catch in CI, but verify production agrees).
  - Stripe webhook breaking after the `findExistingValidWaiver` import-path change (the function body is byte-identical to the pre-M2 version, so this is unlikely — but verify via `/api/webhooks/stripe` test event).
  - Density toggle interfering with admin layout for users who happened to be in `state='user_opt_in'` with `enabled=true`.
- **`/api/admin/feature-flags` returning 500s** in production logs (worker can't read tables — would only happen if the lib got broken, not the migration).

If in doubt, **stop and ask** before reverting.

---

## Pre-rollback checks (60 seconds)

Before reverting anything, confirm the symptom is real and persistent.

```bash
# 1. Pull latest main and re-run tests locally on a fresh clone.
git checkout main && git pull
npm ci
npm test
# Expect: 471 passing across 70 files (M2 baseline) — or whatever
# `docs/runbooks/m2-baseline-coverage.txt` recorded if a hotfix has
# raised the count post-M2.

# 2. If npm test fails, capture the failure modes — first 3 failing
#    tests and any unhandled exceptions or stack frames pointing at
#    M2-introduced files (worker/lib/{auditLog,money,email,featureFlags,
#    waiverLookup}.js, worker/routes/admin/featureFlags.js,
#    src/admin/useFeatureFlag.js, src/styles/tokens.css).

# 3. If CI red on main, re-run via the GitHub UI or a fresh empty commit
#    (operator-only — direct push to main).

# 4. Production sanity:
curl -fsSL https://airactionsport.com/api/health
# Expect: HTTP 200 + {"ok":true,...}

curl -fsSL https://airactionsport.com/api/events
# Expect: HTTP 200 + at least one event row.
```

If both local and CI fail consistently, the regression is real and rollback is justified.

---

## Full rollback — revert the milestone merge

Use this when the entire milestone needs to come off `main`. This preserves the milestone branch's history (you can re-merge after fixing the issue) and creates a single revert commit that's easy to trace.

```bash
# 1. Find the milestone merge commit on main. After the milestone merges,
#    the merge subject will look like:
#      Merge pull request #NN from <author>/milestone-2-shared-primitives
git log --first-parent main --grep="milestone-2-shared-primitives"
# Note the SHA. Call it $MERGE_SHA.

# 2. Create a revert branch off the latest main.
git checkout -b revert/m2-merge main

# 3. Revert the merge. -m 1 means "keep the first parent's line of
#    development" (main's prior state). The second parent (the
#    milestone branch) is the line being undone.
git revert -m 1 $MERGE_SHA

# 4. Push the revert branch and open a PR against main.
git push -u origin revert/m2-merge
gh pr create --base main --head revert/m2-merge \
  --title "revert: roll back milestone-2-shared-primitives merge ($MERGE_SHA)" \
  --body "Rolling back the M2 milestone merge per docs/runbooks/m2-rollback.md. Reason: <fill in>. Keeps the milestone branch intact for re-merge after the issue is fixed."

# 5. Get the revert PR reviewed + merged. Don't squash — preserve the
#    revert commit so future archaeologists can find it via:
#      git log --grep="revert.*milestone-2-shared-primitives"
```

After the revert PR merges, the worker auto-deploys via Cloudflare Workers Builds and main returns to its pre-M2 state.

---

## Migration 0021 reverse procedure (if it was applied)

**Important:** Migration `0021_feature_flags.sql` was applied by the operator AFTER the M2 milestone merged to main (per [m2-deploy.md](m2-deploy.md)). If a full rollback is needed AND the migration was applied, decide whether to:

### Option A: Leave the tables in place (recommended)

The reverted code (worker without M2) doesn't reference `feature_flags` or `feature_flag_user_overrides`, so the tables sit dormant. No customer- or admin-visible impact. **No data loss risk.**

This is the safer default. Only proceed to Option B if you're certain the tables themselves are causing the regression (extremely unlikely — the lib's reader functions catch "no such table" errors and return safe defaults; tables existing should never break anything).

### Option B: Drop the tables (only if Option A doesn't work)

```bash
# Safety: take a snapshot of the override rows first, in case any users
# already opted into density_compact and you want to restore later.
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote \
  --command "SELECT * FROM feature_flag_user_overrides;" > /tmp/m2-override-snapshot.txt

# Drop in reverse order (overrides has FK-style reference to flags by key,
# though no FK constraint enforced — drop overrides first to be safe).
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote \
  --command "DROP TABLE IF EXISTS feature_flag_user_overrides;"
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote \
  --command "DROP TABLE IF EXISTS feature_flags;"

# Verify both gone:
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'feature_flag%';"
# Expect: empty result set.
```

Note: the migration system records 0021 as "applied" in `d1_migrations`. Dropping the tables manually does NOT un-record the migration. If you later re-apply 0021 (e.g. after re-merging a fixed milestone), the migration will be a no-op (CREATE TABLE IF NOT EXISTS) — but the tables won't be re-created from the migration. To force a re-create, manually delete the migration row OR re-introduce the migration as `0022_feature_flags.sql` with a fresh filename.

---

## Partial rollback — revert a single sub-batch's squash commit

Use this when the milestone is mostly fine but one batch needs to come out. Preferred over a full rollback because it preserves the rest of the milestone's work.

This applies BEFORE the milestone merges to main — i.e. rolling back a batch on the `milestone-2-shared-primitives` branch itself.

```bash
# 1. Identify the squash commit to revert. See CLAUDE.md's "Milestone 2"
#    status table for the per-batch SHAs. Examples:
#      B1 FilterBar               → 658e95b
#      B2 writeAudit              → 2cf1485
#      B3a money helpers          → 1d3ed98
#      B3b email helpers          → f35a0ec
#      B4a waiverLookup relocate  → 683f4a6   [CRITICAL — see special note]
#      B4b waiverLookup re-target → 36fda2b   [CRITICAL — pair with 4a]
#      B5a feature-flag lib       → 5e1f568
#      B5b feature-flag route     → 95983f4
#      B5c density toggle UI      → a6ab6e9
#      B6 admin booking tests     → d40e099
#      B7 closing runbooks        → (this batch — TBD post-merge)

# 2. Create a revert branch off the milestone tip.
git checkout -b m2-revert-bN milestone-2-shared-primitives

# 3. Revert. No -m flag; squash commits have a single parent.
git revert <BATCH_SHA>

# 4. Push and open a PR against milestone-2-shared-primitives.
git push -u origin m2-revert-bN
gh pr create --base milestone-2-shared-primitives --head m2-revert-bN \
  --title "revert(m2): roll back batch B<N> (<short-name>)" \
  --body "Rolling back batch B<N> per docs/runbooks/m2-rollback.md. Reason: <fill in>."
```

### Special case: reverting B4a or B4b (`findExistingValidWaiver` relocation)

B4a and B4b are paired: 4a moved the function and added a re-export shim; 4b dropped the shim and re-targeted the test imports. **Reverting one without the other will break the build:**

- Revert B4b alone → code still references `worker/lib/waiverLookup.js`, but tests import from `worker/routes/webhooks.js` (where the function no longer exists) → test failures.
- Revert B4a alone → tests still import from `worker/lib/waiverLookup.js`, but the file no longer exists → test failures.

**To revert the waiverLookup move cleanly, revert both 4b AND 4a (in that order):**

```bash
git checkout -b m2-revert-b4 milestone-2-shared-primitives
git revert 36fda2b           # B4b first (drops shim)
git revert 683f4a6           # B4a second (un-moves the function)
git push -u origin m2-revert-b4
# ... PR + merge as above
```

---

## Verify the rollback

Whether full or partial, after the revert PR merges:

```bash
# Local verification.
git checkout main         # or milestone-2-shared-primitives for partial
git pull
npm ci
npm test                  # full rollback: pre-M2 state has 216 passing (M1 baseline);
                          # partial rollback: 471 - <reverted-batch-tests>.
npm run test:coverage     # confirm coverage% matches the relevant baseline.

# CI verification.
gh run list --branch main --limit 5
# Latest run should be green, triggered by the revert merge.

# Production verification (full rollback only — main auto-deploys via
# Cloudflare Workers Builds).
curl -fsSL https://airactionsport.com/api/health
curl -fsSL https://airactionsport.com/api/events

# Admin sanity (full rollback): /api/admin/feature-flags should return
# 404 (route no longer mounted).
curl -fsSL -H "Cookie: aas_session=..." https://airactionsport.com/api/admin/feature-flags
# Expect: 404 Not Found (route un-mounted by the revert).

# Optional: operator-run smoke.
npm run test:e2e
```

---

## What NOT to do

- **Do NOT `git push --force` to `main`** — destroys other people's work.
- **Do NOT `git reset --hard main`** to "undo" the merge locally and re-push — same problem.
- **Do NOT delete the `milestone-2-shared-primitives` branch** during rollback. It's needed intact to re-merge after the issue is fixed.
- **Do NOT skip the revert PR** in favor of a direct push to `main`. CI on the revert PR is the sanity check.
- **Do NOT re-merge the milestone branch immediately after the revert** without first fixing the regression on the milestone branch (open a new `m2-batch-N-fix` PR there).
- **Do NOT drop the `feature_flags` tables (Option B above) without first taking the snapshot in Option B's first step.** Override rows are user opt-in state — losing them is recoverable from the snapshot but annoying without it.

---

## Communication

After kicking off a rollback PR:

1. Note in the PR body which batch/commit is being reverted and why.
2. Update **CLAUDE.md**'s "Milestone 2" status table to reflect the rollback (mark the affected row as "reverted — see docs/runbooks/m2-rollback.md").
3. If post-deploy admin or customer impact: capture timing in [HANDOFF.md](../../HANDOFF.md) §13 (known issues) for the next session.
4. If migration 0021 was reversed (Option B above), update [HANDOFF.md](../../HANDOFF.md) §12 ("Current live data") to note the tables are gone.
