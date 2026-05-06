# M1 Rollback Runbook

How to roll back milestone 1 (test infrastructure) if it's found broken on `main` after the milestone merge. Applies to whoever is on call when something starts failing post-deploy.

This runbook only covers rolling back **M1 itself**. For rolling back a single batch within the milestone (before milestone-merge), see the "Partial rollback during the milestone" section at the bottom.

---

## When to invoke this runbook

Trigger on any of:

- **CI red on `main`** for `Vitest + coverage (Node 20)` after the milestone merge — and rerunning doesn't fix it (i.e. it's not a flake).
- **`npm test` fails locally on `main`** when a fresh clone + `npm install` should produce 216 passing.
- **Cloudflare Workers Builds failing** on `main` after the merge with errors in `npm ci` or `npm run build` (build pulls in `@playwright/test` and could surface a packaging issue).
- **A customer-visible regression** that bisects to a milestone-merge commit on `main` (rare — M1 doesn't change source code, only adds tests + CI + docs, so this is unlikely).

If in doubt, **stop and ask** before reverting. Reverting a merge commit is a heavyweight git operation; a wrong revert can mask the real issue.

---

## Pre-rollback checks (60 seconds)

Before reverting anything, confirm the symptom is real and persistent.

```bash
# 1. Pull latest main and re-run tests locally on a fresh clone.
#    Rules out machine-state flakes.
git checkout main && git pull
npm ci
npm test

# 2. If npm test fails, capture the failure modes — first 3 failing tests
#    and any unhandled exceptions or stack frames pointing at the worker
#    source vs the tests themselves.

# 3. Re-run CI on main by pushing an empty commit (or by using gh):
gh workflow run ci.yml -r main    # if a manual trigger is set; otherwise:
git commit --allow-empty -m "chore: re-trigger CI to confirm regression"
# Push only with operator approval; this is technically a direct commit to main.
```

If both local and CI fail consistently, the regression is real and rollback is justified.

---

## Full rollback — revert the milestone merge

Use this when the entire milestone needs to come off `main`. This preserves the milestone branch's history (you can re-merge after fixing the issue) and creates a single revert commit that's easy to trace.

```bash
# 1. Find the milestone merge commit on main.
#    The merge subject will look like:
#      Merge pull request #NN from <author>/milestone-1-test-infrastructure
#    or the squashed equivalent if the merge happened as a squash (less likely
#    if m1-deploy.md's "merge commit, not squash" recommendation was followed).
git log --first-parent main --grep="milestone-1-test-infrastructure"
# Note the SHA. Call it $MERGE_SHA below.

# 2. Create a revert branch off the latest main.
git checkout -b revert/m1-merge main

# 3. Revert the merge.
#    -m 1 means "the first parent is the line of development to keep"
#    (i.e. main's prior state). The second parent (the milestone branch)
#    is the line being undone.
git revert -m 1 $MERGE_SHA

# 4. Push the revert branch and open a PR against main.
git push -u origin revert/m1-merge
gh pr create --base main --head revert/m1-merge \
  --title "revert: roll back milestone-1-test-infrastructure merge ($MERGE_SHA)" \
  --body "Rolling back the M1 milestone merge per docs/runbooks/m1-rollback.md. Reason: <fill in>. Keeps the milestone branch intact for re-merge after the issue is fixed."

# 5. Get the revert PR reviewed + merged. Don't squash — preserve the
#    revert commit so future archaeologists can find it via:
#      git log --grep="revert.*milestone-1-test-infrastructure"
```

---

## Partial rollback — revert a single sub-batch's squash commit

Use this when the milestone is mostly fine but one batch (e.g. B6 Playwright config has a typo, or B7 CI workflow has a bad branch glob) needs to come out. This is preferable to a full rollback because it preserves the rest of the milestone's work.

This applies BEFORE the milestone merges to main — i.e. rolling back a batch on the `milestone-1-test-infrastructure` branch itself.

```bash
# 1. Identify the squash commit to revert.
#    See CLAUDE.md's "Milestone 1 — Test Infrastructure" status table for
#    the per-batch SHAs. Examples:
#      B6 Playwright       → 4d19864
#      B7 CI workflow      → 37329ba
#      B8 Gate map + CLAUDE → b726104

# 2. Create a revert branch off the milestone tip.
git checkout -b m1-revert-bN milestone-1-test-infrastructure

# 3. Revert the offending squash commit. No -m flag; squash commits have
#    a single parent, so a plain revert works.
git revert <BATCH_SHA>

# 4. Push and open a PR against milestone-1-test-infrastructure.
git push -u origin m1-revert-bN
gh pr create --base milestone-1-test-infrastructure --head m1-revert-bN \
  --title "revert(m1): roll back batch B<N> (<short-name>)" \
  --body "Rolling back batch B<N> per docs/runbooks/m1-rollback.md. Reason: <fill in>. The corresponding fix-up batch will be opened as m1-batch-<N>-fix or absorbed into a later batch."

# 5. After this revert merges, the batch's content is effectively undone
#    on the milestone branch. Re-implement (with the fix) in a new batch.
```

---

## Verify the rollback

Whether full or partial, after the revert PR merges:

```bash
# Local verification.
git checkout main         # or milestone-1-test-infrastructure for partial
git pull
npm ci
npm test                  # full rollback: pre-M1 state has no tests, so this errors;
                          # partial rollback: 216 - <reverted-batch-tests> passing.
npm run test:coverage     # confirm coverage% returns to expected.

# CI verification.
gh run list --branch main --limit 5
# The latest run should be green and triggered by the revert merge.

# Production verification (full rollback only — only if main is auto-deployed
# via Cloudflare Workers Builds).
curl -fsSL https://air-action-sports.bulletbiter99.workers.dev/api/health
# Expect: HTTP 200 + {"ok":true,...}.

# Optional: operator-run smoke if Playwright is set up locally.
npm run test:e2e
```

---

## What NOT to do

- **Do NOT `git push --force` to `main`** — destroys other people's work.
- **Do NOT `git reset --hard` `main`** to "undo" the merge locally and re-push — same problem.
- **Do NOT delete the `milestone-1-test-infrastructure` branch** during rollback. We need it intact to re-merge after the issue is fixed.
- **Do NOT skip the revert PR** in favor of a direct push to `main`. CI on the revert PR is your sanity check.
- **Do NOT re-merge the milestone branch immediately after the revert** without first fixing the regression on the milestone branch (open a new `m1-batch-N-fix` PR there).

---

## Communication

After kicking off a rollback PR:

1. Note in the PR body which batch/commit is being reverted and why.
2. Update the **CLAUDE.md** "Milestone 1 — Test Infrastructure" status table to reflect the rollback (mark the affected row as "reverted — see docs/runbooks/m1-rollback.md").
3. If post-deploy customer impact: capture timing in [HANDOFF.md](../../HANDOFF.md) for the next session.
