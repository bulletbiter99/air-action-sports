# M2 Deploy Runbook — Merging the milestone branch into `main`

How to land `milestone-2-shared-primitives` on `main` after B7 closes the milestone. The merge itself is operator-driven (the Claude session that built the milestone can't push direct to `main`).

This runbook is the final action of M2. After completion, the `milestone-2-shared-primitives` branch is fully closed and `main` carries the shared primitives + cross-route waiver-lookup fix + feature-flag substrate.

---

## Pre-merge checklist

Run all of these on the `milestone-2-shared-primitives` branch tip before opening the merge PR.

```bash
git checkout milestone-2-shared-primitives
git pull origin milestone-2-shared-primitives

# 1. Vitest baseline matches the captured snapshot.
npm ci
npm test
# Expect: Test Files 70 passed (70), Tests 471 passed (471).

# 2. Coverage matches the baseline runbook.
npm run test:coverage 2>&1 | tail -60
# Compare the table against docs/runbooks/m2-baseline-coverage.txt.
# Gated paths (the 6 entries in scripts/test-gate-mapping.json `gates`)
# must show their baseline %Stmts:
#   pricing.js                  98.84
#   stripe.js                   93.93
#   webhooks.js                 91.17
#   waivers.js                  93.61
#   waiverLookup.js             100   (NEW gate, B4a/4b)
#   admin/bookings.js           71.11 (NEW gate, B6)
# A decrease > 1% on any gated path means a test went missing — investigate
# before merging.

# 3. CI is green on the milestone tip (in GitHub Actions).
gh run list --branch milestone-2-shared-primitives --limit 1
# Latest run should show "Vitest + coverage (Node 20)" green.

# 4. No uncommitted work in the worktree.
git status
# Expect: nothing to commit, working tree clean.

# 5. The do-not-touch list is unchanged. Diff against main:
git diff main -- docs/audit/06-do-not-touch.md
# Expect: no output (file unchanged) or only docs/comment-style changes.
```

If any of these fail, **stop and ask** — don't proceed with the merge.

---

## Merge strategy: merge commit, NOT squash

The `milestone-2-shared-primitives` branch is the long-lived integration branch for 11 batches (B1, B2, B3a, B3b, B4a, B4b, B5a, B5b, B5c, B6, B7) of shared-primitives + cross-route fix work. Each batch has a meaningful squash commit on the milestone branch with its own audit map and rationale in the commit message.

**Recommendation: use a merge commit, not squash.** Same reasons as M1:

- Per-batch squash commits are first-class history. `git log --first-parent main` after the merge will show them as second-parent commits — searchable, bisectable, and self-explanatory.
- A milestone-wide squash would collapse 11 valuable commit messages into one, losing the audit-map traceability.
- Future M3+ work referencing M2 SHAs (e.g. `findExistingValidWaiver` history) needs the per-batch SHAs intact.

If GitHub branch-protection rules require squash on `main`, the operator can override per-PR (admin override) or temporarily relax the rule for this merge. Document the override reason in the PR description.

---

## Open the merge PR

```bash
gh pr create --base main --head milestone-2-shared-primitives \
  --title "milestone: M2 shared primitives + cross-route fix (471 tests, 70 files)" \
  --body "$(cat <<'EOF'
## Summary

Merges milestone-2-shared-primitives into main. Lands shared admin
primitives (FilterBar, writeAudit, money/email helpers), the
findExistingValidWaiver cross-route relocation (audit §08 #7 fix),
the feature-flag substrate + admin route + density toggle UI, and
audit-prescribed Group E characterization tests for admin manual
booking.

## What this brings to main

- **+255 vitest unit tests across +16 new files** (216 M1 baseline → 471).
  Six new gated paths in scripts/test-gate-mapping.json:
    worker/lib/featureFlags.js               100% (B5a, 27 + 7 readiness tests)
    worker/lib/waiverLookup.js               100% (B4a relocation, 25 tests retargeted)
    worker/routes/admin/featureFlags.js      100% (B5b, 7 route tests)
    worker/routes/admin/bookings.js         71.11% (B6, 7 Group E + 1 sibling)
  Plus expanded coverage on pre-existing gates (stripe.js 56% → 93.93%,
  pricing.js 95.95% → 98.84%).
- **6 new shared primitives** ready for M3+ admin-overhaul reuse:
    src/components/admin/FilterBar.jsx       (B1) — chip-based filter
    worker/lib/auditLog.js writeAudit()      (B2) — audit-row helper
    worker/lib/money.js + src/utils/money.js (B3a) — dual-target money math
    worker/lib/email.js + src/utils/email.js (B3b) — email validation
    worker/lib/waiverLookup.js               (B4a) — relocated cross-route fn
    worker/lib/featureFlags.js               (B5a) — flag substrate
- **Feature flag substrate (B5a) + admin route (B5b) + density toggle UI (B5c)**:
    migration 0021_feature_flags.sql in repo (operator-applies-remote — see below)
    GET /api/admin/feature-flags + PUT /:key/override
    src/admin/useFeatureFlag.js hook with module-level cache
    /admin/settings density toggle (Normal/Compact)
- **Audit cross-route smell §08 #7 fully closed (B4a/4b)** — findExistingValidWaiver
  moved from worker/routes/webhooks.js to worker/lib/waiverLookup.js,
  function body byte-identical, no behavior change.
- **docs/runbooks/m2-{rollback,deploy,baseline-coverage}.{md,txt}** —
  closing runbooks for the milestone and any future M2 rollback.

## Per-batch SHAs (preserved as second-parent commits via merge commit)

See CLAUDE.md "Milestone 2 — Shared Primitives" status table on this branch.

## Conflict notes

CLAUDE.md and HANDOFF.md will conflict with main's existing M2 sections
(commit 8de7541 from PR #23 "docs(m2-checkpoint)") which captured M2
mid-flight state. The milestone branch's versions (post-B7) are strictly
newer — they have all 11 batches marked merged with squash SHAs.
**Resolution: take the milestone branch's versions.** See "Resolving
conflicts" section below.

## Test plan

- [x] vitest 471/471 passing on milestone tip (per docs/runbooks/m2-baseline-coverage.txt)
- [x] Coverage matches baseline on all 6 gated paths
- [x] CI green on milestone tip
- [ ] Reviewer confirms merge-commit strategy (not squash) — preserves
       per-batch SHAs for future bisect
- [ ] After merge: CI runs on main and is green
- [ ] After merge: Cloudflare Workers Builds rebuilds main cleanly
- [ ] After merge + Workers deploy: operator applies migration 0021 to
       remote D1 (see "Post-merge ops" section below)
- [ ] After migration applied: density toggle visible at /admin/settings;
       /api/admin/feature-flags returns the seeded density_compact flag

## Post-merge follow-ups (NOT in this PR)

- Operator: apply migration 0021_feature_flags.sql to remote D1
       (see m2-deploy.md).
- Operator: small CLAUDE.md/HANDOFF.md follow-up to fill in the
       milestone-merge SHA (see m2-deploy.md).
- Future milestone (M3+): admin overhaul builds on these primitives.
- Future test work: audit Groups F/G/H still uncovered (see
       scripts/test-gate-mapping.json `uncovered`).
EOF
)"
```

---

## Resolving the CLAUDE.md / HANDOFF.md merge conflict

When the merge attempt opens the PR, GitHub will flag conflicts in `CLAUDE.md` and `HANDOFF.md` between:

- **`main`'s versions** (commit `8de7541` "docs(m2-checkpoint): capture in-flight M2 state for fresh-session resume" — PR #23) — captured M2 mid-flight (B1-B5a merged, B5b/B5c/B6/B7 pending).
- **The milestone branch's versions** (commit `<TBD-B7-squash-SHA>` from B7 closing) — all 11 batches marked merged with squash SHAs, M2 status flipped to "closed".

**Resolution: take the milestone branch's versions.** Reasons:

- The milestone versions are strictly newer (post-B7 includes B5b/B5c/B6/B7 squash SHAs and the closed-status flip).
- They will be made post-merge-correct by a small follow-up commit on main (just fill in the milestone-merge SHA — see "Post-merge SHA fill-in" below).

Resolution steps for the operator:

```bash
# After running git merge milestone-2-shared-primitives on main and hitting
# the conflict (or after GitHub's UI shows the conflict on the merge PR):

# Option 1 — Local resolution (recommended):
git checkout milestone-2-shared-primitives -- CLAUDE.md HANDOFF.md
git add CLAUDE.md HANDOFF.md
git commit
# Then push.

# Option 2 — GitHub web UI:
# In the PR's conflict resolver, paste the milestone branch's
# CLAUDE.md and HANDOFF.md contents and mark resolved.
```

---

## Post-merge ops

After the merge commit lands on `main` and Cloudflare Workers Builds successfully redeploys:

### 1. Apply migration 0021 to remote D1

The migration is **in repo only** until this step; the worker handles missing tables gracefully (`featureFlags.js` reader functions return `false`/`[]` on `no such table` errors). The density toggle UI in `/admin/settings` stays hidden until the migration applies (because `flag.exists` is false until `feature_flags` is queryable).

```bash
# Load the Cloudflare API token from .claude/.env (gitignored).
source .claude/.env

# Apply pending migrations — 0021_feature_flags.sql will be the only
# pending one (assuming 0020_drop_admin_sessions has been applied; if
# not, it goes first — both are no-data-risk).
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 migrations apply air-action-sports-db --remote

# Verify the tables exist + the seed row landed.
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 execute air-action-sports-db --remote \
    --command "SELECT key, state, user_opt_in_default FROM feature_flags;"
# Expect: 1 row → density_compact / user_opt_in / 0
```

### 2. Verify density toggle visible end-to-end

Log in to `/admin` (any authed admin), navigate to `/admin/settings`, confirm:

- "Display Density" section appears above the cards grid
- Two buttons: Normal (active by default) and Compact
- Click Compact → button becomes active, `[data-density="compact"]` appears on `.admin-shell--with-sidebar`, padding tightens
- Click Normal → reverts cleanly
- Hard-refresh — preference persists (loads from `feature_flag_user_overrides`)

If the section doesn't appear:

```bash
# Check the GET endpoint as a logged-in admin:
curl -fsSL -H "Cookie: aas_session=<paste-from-browser>" \
  https://airactionsport.com/api/admin/feature-flags
# Expect: {"flags":[{"key":"density_compact",...,"enabled":false}]}
```

If `flags` is empty: migration didn't apply correctly. Re-run step 1.

### 3. Post-merge SHA fill-in (small follow-up PR)

The B7 batch shipped CLAUDE.md/HANDOFF.md updates marking M2 "ready to merge to main", with a placeholder for the milestone-merge SHA. After the merge lands and conflicts are resolved per above, open a small follow-up PR on `main`:

```bash
git checkout -b docs/m2-merge-sha main
# Edit CLAUDE.md and HANDOFF.md to fill in the M2 milestone-merge SHA
# (the merge commit on main, viewable via:
#   git log --first-parent main --grep="milestone-2-shared-primitives" --oneline
# Look for "Merge pull request #NN ..." or the merge commit subject.

# Replace the "<TBD-after-milestone-merge>" placeholders with the SHA.
git add CLAUDE.md HANDOFF.md
git commit -m "docs(m2-merged): fill in milestone-2 → main merge SHA"
git push -u origin docs/m2-merge-sha
gh pr create --base main --head docs/m2-merge-sha \
  --title "docs(m2-merged): fill in M2 milestone-merge SHA" \
  --body "Mechanical follow-up to the M2 milestone merge per docs/runbooks/m2-deploy.md. Replaces TBD placeholder with the actual merge commit SHA on main."
```

---

## Post-merge verification

```bash
# 1. CI on main runs and passes.
gh run list --branch main --limit 1
# Expect: green Vitest + coverage run.

# 2. Local re-verification on a fresh clone.
git clone https://github.com/bulletbiter99/air-action-sports
cd air-action-sports
npm ci
npm test
# Expect: 471 passing.

# 3. Cloudflare Workers Builds rebuild main.
# Check the dashboard — there should be a new build triggered by the
# merge to main. It should pass (npm run build && npx wrangler deploy).

# 4. Production smoke (operator).
curl -fsSL https://airactionsport.com/api/health
# Expect: HTTP 200, {"ok":true,...}.

# 5. (After post-merge ops step 1) Density toggle smoke.
# Log in to /admin, navigate to /admin/settings, confirm toggle works.
# Detailed verification in "Verify density toggle" above.

# 6. Operator-triggered Playwright smoke (regression check).
npm run test:e2e
# Expect: same pass/skip pattern as M1.
```

If any of (1)-(4) fails, invoke [m2-rollback.md](m2-rollback.md). If (5) fails after (1)-(4) pass, see "Verify density toggle" above for diagnosis. If (6) fails, that's a separate issue — Playwright smoke or production may have a real regression. Investigate before declaring rollback.

---

## After merge: cleanup

```bash
# Delete the milestone branch on origin (kept until merge for safety).
git push origin --delete milestone-2-shared-primitives

# Local cleanup.
git branch -d milestone-2-shared-primitives
git fetch --prune
```

The milestone branch is no longer needed once main has the merge commit. Per-batch SHAs remain in the merge commit's second-parent line and are accessible via `git log --first-parent main` and per-PR history on GitHub.

---

## Definition of done

M2 is closed when ALL of these are true:

- [ ] `milestone-2-shared-primitives` is merged to `main` via a merge commit (per the recommendation above)
- [ ] CLAUDE.md/HANDOFF.md merge conflicts resolved with milestone branch's versions
- [ ] CI on `main` is green
- [ ] Cloudflare Workers Builds successfully rebuilt `main` post-merge
- [ ] Migration `0021_feature_flags.sql` applied to remote D1 (operator step above)
- [ ] Density toggle verified visible + functional at `/admin/settings`
- [ ] Small follow-up PR landed on main with the milestone-merge SHA filled in
- [ ] `milestone-2-shared-primitives` branch is deleted on origin
- [ ] Pre-launch operational items (separate from M2) tracked in HANDOFF.md — DMARC/DKIM, Cloudflare HTTPS toggle, Stripe sandbox→live cutover, second admin invite, comp-ticket dry run.
