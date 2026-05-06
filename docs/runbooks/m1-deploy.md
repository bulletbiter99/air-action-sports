# M1 Deploy Runbook — Merging the milestone branch into `main`

How to land `milestone-1-test-infrastructure` on `main` after B9 closes the milestone. The merge itself is operator-driven (the Claude session that built the milestone can't push direct to `main`).

This runbook is the final action of M1. After completion, the `milestone-1-test-infrastructure` branch is fully closed and the project's `main` branch has the test infrastructure.

---

## Pre-merge checklist

Run all of these on the `milestone-1-test-infrastructure` branch tip before opening the merge PR.

```bash
git checkout milestone-1-test-infrastructure
git pull origin milestone-1-test-infrastructure

# 1. Vitest baseline matches the captured snapshot.
npm ci
npm test
# Expect: Test Files 54 passed (54), Tests 216 passed (216).

# 2. Coverage matches the baseline runbook.
npm run test:coverage 2>&1 | tail -50
# Compare the table against docs/runbooks/m1-baseline-coverage.txt.
# Gated paths (pricing.js, stripe.js, webhooks.js, waivers.js) must show
# the same %Stmts as the baseline (95.95 / 56.06 / 91.08 / 93.61).
# A decrease > 1% on any gated path means a test went missing — investigate
# before merging.

# 3. CI is green on the milestone tip (in GitHub Actions).
gh run list --branch milestone-1-test-infrastructure --limit 1
# The latest run should show "Vitest + coverage (Node 20)" green.

# 4. No uncommitted work in the worktree.
git status
# Expect: nothing to commit, working tree clean.

# 5. The do-not-touch list is unchanged. Run a diff against the audit
#    branch's version to confirm:
git diff audit/phase-1 -- docs/audit/06-do-not-touch.md
# Expect: no output (file unchanged) or only docs/comment-style changes.
```

If any of these fail, **stop and ask** — don't proceed with the merge.

---

## Merge strategy: merge commit, NOT squash

The `milestone-1-test-infrastructure` branch is the long-lived integration branch for nine batches (PRs #2 through #N) of test work. Each batch has a meaningful squash commit on the milestone branch with its own audit map and rationale in the commit message.

**Recommendation: use a merge commit, not squash.** Reasons:

- The per-batch squash commits are first-class history. `git log --first-parent main` after the merge will show them as second-parent commits — searchable, bisectable, and self-explanatory via their commit messages.
- A milestone-wide squash would collapse 11+ valuable commit messages into one, losing the audit-map traceability that future regressions can use to bisect.
- Future post-M1 work (Groups E/F/G/H per the audit) will reference these per-batch SHAs by hash. Squashing breaks those references.

If GitHub branch-protection rules require squash on `main`, the operator can override on a per-PR basis (admin override) or temporarily relax the rule for this single merge. Document the override reason in the PR description.

---

## Open the merge PR

```bash
gh pr create --base main --head milestone-1-test-infrastructure \
  --title "milestone: M1 test infrastructure (216 unit + 7 smoke tests)" \
  --body "$(cat <<'EOF'
## Summary

Merges milestone-1-test-infrastructure into main. Lands the audit-prescribed
characterization tests (Groups A, B, C, D), Playwright smoke scaffold (Group I),
CI workflow, contributor guide, test-gate map, and closing runbooks.

## What this brings to main

- **216 vitest unit tests across 54 files** locking the four critical-tier
  source paths in scripts/test-gate-mapping.json:
    worker/lib/pricing.js        95.95% lines  (Group A — 79 tests)
    worker/lib/stripe.js         56.06% lines  (Group B signature subset — 25 tests)
    worker/routes/webhooks.js    91.08% lines  (Group B + D — 34 + 25 tests)
    worker/routes/waivers.js     93.61% lines  (Group C — 50 tests)
- **7 Playwright smoke tests scaffolded** under tests/e2e/, operator-triggered
  via npm run test:e2e (NOT in CI by default).
- **CI workflow** at .github/workflows/ci.yml running vitest + coverage on
  every PR to main or milestone-* branches.
- **CONTRIBUTING.md** + .github/PULL_REQUEST_TEMPLATE.md codifying the
  M1 operating rules.
- **scripts/test-gate-mapping.json** mapping do-not-touch paths to the
  test paths that lock them (4 gates + 7 uncovered punch-list entries).
- **docs/runbooks/** with m1-baseline-coverage.txt, m1-rollback.md, m1-deploy.md.

## Per-batch SHAs (preserved as second-parent commits via merge commit)

See CLAUDE.md "Milestone 1 — Test Infrastructure" status table on this branch.

## Conflict notes

CLAUDE.md will conflict with main's existing M1 section (commit 0eb7d91 on
main vs the newer one ported in m1-batch-8). Resolution: take this
branch's version — it has the up-to-date status table and the new
"Test gate enforcement" subsection.

## Test plan

- [x] vitest 216/216 passing on milestone tip (per docs/runbooks/m1-baseline-coverage.txt)
- [x] Coverage matches baseline on all 4 gated paths
- [x] CI green on milestone tip
- [ ] Reviewer confirms merge-commit strategy (not squash) — preserves
       per-batch SHAs for future bisect
- [ ] After merge: CI runs on main and is green
- [ ] After merge: Cloudflare Workers Builds rebuilds main cleanly
- [ ] Operator runs `npm run test:e2e` against production once after
       deploy (Group I smoke check)

## Post-merge follow-ups (NOT in this PR)

- Operator: install Playwright Chromium binary (one-time):
       npx playwright install chromium
- Operator: fix the broken eslint config (audit pain-point #8) so lint
       can become a blocking CI step.
- Future milestone: implement audit Groups E/F/G/H tests
       (admin manual booking, auth, worker-level, cron) per the
       uncovered section of scripts/test-gate-mapping.json.
EOF
)"
```

---

## Resolving the CLAUDE.md merge conflict

When the merge attempt opens the PR, GitHub will flag a conflict in `CLAUDE.md` between:

- **`main`'s version** (commit `0eb7d91` "docs: M1 test-infrastructure progress + session-resume signposts") — has an older M1 status table from when only B1-B3b were merged.
- **The milestone branch's version** (commit `b726104` from m1-batch-8) — has the up-to-date M1 status table covering B1-B7 merged, B8 in flight, B9 pending.

**Resolution:** take the milestone branch's version. Reasons:

- It's strictly newer information (B1-B7 merged status, gate-enforcement subsection added, refreshed bash test block).
- It will be made post-merge-correct by a small follow-up (just update "B8 in flight" → "B8 merged" with its squash SHA, and "B9 pending" → "B9 merged" with its SHA).

Resolution steps for the operator:

```bash
# After running git merge milestone-1-test-infrastructure on main and hitting
# the conflict (or after GitHub's UI shows the conflict on the merge PR):

# Option 1 — Local resolution (recommended):
git checkout milestone-1-test-infrastructure -- CLAUDE.md
git add CLAUDE.md
git commit
# Then push.

# Option 2 — GitHub web UI:
# In the PR's conflict resolver, paste the milestone branch's CLAUDE.md
# content (the one that includes the "Milestone 1 — Test Infrastructure"
# section with the full status table) and mark resolved.
```

After the merge lands, open a small follow-up PR against `main` to update the M1 status table:

- Replace "B8 in flight" → "B8 ✓ merged | <squash-SHA-of-B8-on-milestone>"
- Replace "B9 pending" → "B9 ✓ merged | <squash-SHA-of-B9-on-milestone>"
- Optionally: add a "milestone closed" line at the top of the section.

---

## Post-merge verification

After the merge commit lands on `main`:

```bash
# 1. CI on main runs and passes.
gh run list --branch main --limit 1
# Expect: green Vitest + coverage run, ~25 seconds.

# 2. Local re-verification on a fresh clone.
git clone https://github.com/bulletbiter99/air-action-sports
cd air-action-sports
npm ci
npm test
# Expect: 216 passing.

# 3. Cloudflare Workers Builds rebuild main.
# Check the dashboard — there should be a new build triggered by the
# merge to main. It should pass (npm ci + npm run build, no test step).

# 4. Production smoke (operator).
curl -fsSL https://air-action-sports.bulletbiter99.workers.dev/api/health
# Expect: HTTP 200, {"ok":true,...}.

# 5. Operator-triggered Playwright smoke (one-time).
npx playwright install chromium    # one-time setup
npm run test:e2e                    # 6/7 tests run; #79 skipped without E2E_TEST_EVENT_SLUG
# Expect: all non-skipped tests pass.
```

If any of (1) - (4) fails, invoke [m1-rollback.md](m1-rollback.md). If (5) fails, that's a separate issue — the smoke test itself may need fixing or production may have a real regression. Investigate before declaring rollback.

---

## After merge: cleanup

```bash
# Delete the milestone branch on origin (kept until merge for safety).
git push origin --delete milestone-1-test-infrastructure

# Local cleanup.
git branch -d milestone-1-test-infrastructure
git fetch --prune
```

The milestone branch is no longer needed once main has the merge commit. Per-batch SHAs remain in the merge commit's second-parent line and are accessible via `git log --first-parent main` and per-PR history on GitHub.

---

## Definition of done

M1 is closed when ALL of these are true:

- [ ] `milestone-1-test-infrastructure` is merged to `main` via a merge commit (per the recommendation above)
- [ ] CI on `main` is green
- [ ] Cloudflare Workers Builds successfully rebuilt `main` post-merge
- [ ] CLAUDE.md on `main` has the updated M1 status table marking B8 + B9 ✓ merged with their squash SHAs
- [ ] `milestone-1-test-infrastructure` branch is deleted on origin
- [ ] Operator has run `npx playwright install chromium` and `npm run test:e2e` against production at least once (smoke check)
- [ ] Pre-launch operational items (separate from M1) tracked in HANDOFF.md — DMARC/DKIM, Cloudflare HTTPS toggle, Stripe sandbox→live cutover, migration 0020 apply, second admin invite, comp-ticket dry run.
