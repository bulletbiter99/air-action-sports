# M4 deploy runbook

What it took to ship Milestone 4 (Bookings + Detail Workspace + New Admin Shell + IA reorganization + Cmd+K Command Palette + flag rollout + closing) end-to-end. Captures the actual sequence used in the 2026-05-07 deploy session, including the operator-driven remote D1 ops that the per-batch protocol couldn't run from Claude. Mirrors the structure of `m3-deploy.md` but reflects M4's quirks: 4 D1 migrations + 2 SQL UPDATE flag-flip rounds + 1 SQL DELETE + a pre-batch role-scoped flag discovery.

## Pre-flight

Before any batch executes:

1. `git fetch origin --prune`
2. Confirm `milestone/4-bookings-ia-completion` tip matches what's in CLAUDE.md M4 batch table.
3. `npm test` should be 917/917 across 100 files at M4 close (vs 617 at M3 close; net +300 tests across +20 files).
4. `npm run lint` should be 0 errors / 287 warnings (M4 close baseline; net -6 from B7 baseline 293).
5. `npm run build` should be clean (~250ms).
6. `npx wrangler d1 migrations list air-action-sports-db --remote` should show migrations 0001–0029 applied.
7. `feature_flags` table should contain only `density_compact` (M2) — the 3 M4 flags were DELETEd post-B12b.

## Batch cadence used in M4

Same as M3 — every B-batch followed the same shape:

1. **Branch off `origin/milestone/4-bookings-ia-completion`** (sub-branch named `m4-batch-N-slug`, flat per the M1/M2/M3 ref-collision workaround).
2. **Plan-mode-first** — write plan to plan file, ExitPlanMode, get user approval.
3. **Write code + tests** (≤10 file cap; B1/B2/B3/B4/B12 splits as a/b/c/d/e/f sub-batches when needed).
4. **`npm test` + `npm run lint` + `npm run build`** locally before pushing.
5. **Push + open PR** to `milestone/4-bookings-ia-completion`.
6. **Wait CI** (Vitest + Visual regression + Workers Builds preview), then `gh pr merge --squash`.
7. **Open `milestone/4-bookings-ia-completion → main` PR** for mid-flight bring-up (rolling — each batch went live before the next started).
8. **Merge to main** (`--merge` to preserve per-batch SHAs as second-parent commits).
9. **Wait Workers Builds redeploy** on the main commit, verify `/api/health`.
10. **Repeat for next batch.**

Total M4: 16 batches over 2 days (B0 through B12c, with B10 collapsed and B11 deferred). Per-batch SHAs in CLAUDE.md M4 batch table.

## Operator-applied remote D1 ops

These steps had to run from a workstation with the Cloudflare API token. Source `.claude/.env` for the token first.

### Migrations

| When | Command | Risk |
|---|---|---|
| Post-B2a merge | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Adds `saved_views` table. Additive — no risk. |
| Post-B3a merge | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Adds 4 `bookings.refund_*` columns + email template seed. Additive. |
| Post-B4a merge | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Adds `users.persona` column + role-based backfill. Additive. |
| Post-B7 merge | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Inserts `command_palette` flag row, state=off. Additive. |

### Feature-flag rollout (state-level)

M4's 3 flags (`command_palette`, `customers_entity`, `new_admin_dashboard`) were rolled out across B8 + B9, with a pre-B8 discovery surfacing that `customers_entity` and `new_admin_dashboard` had been moved to `role_scoped='owner'` outside any documented batch. The actual sequence:

```sql
-- B8 (2026-05-07) — atomic ancillary flips (skipped intermediate dogfood
-- since the customer admin set is 4 owner users; role_scoped='owner' was
-- effectively 'on' for the current users):
UPDATE feature_flags
   SET state='on', role_scope=NULL,
       updated_at=strftime('%s','now')*1000
 WHERE key='command_palette';

UPDATE feature_flags
   SET state='on', role_scope=NULL,
       updated_at=strftime('%s','now')*1000
 WHERE key='customers_entity';

-- B9 (2026-05-07) — final new-shell flip; user_opt_in detour declined:
UPDATE feature_flags
   SET state='on', role_scope=NULL,
       updated_at=strftime('%s','now')*1000
 WHERE key='new_admin_dashboard';

-- B12b post-deploy (2026-05-07) — DELETE the 3 orphan rows after code
-- removed all useFeatureFlag(...) consumers:
DELETE FROM feature_flags
 WHERE key IN ('command_palette', 'customers_entity', 'new_admin_dashboard');
```

**Order matters for the DELETE**: code shipped first (B12b code change in PR #97); operator ran DELETE only AFTER the merge to main + Workers Builds redeploy. Running DELETE before code deployed would have left running prod code looking up missing flag rows → return false → UI breakage.

For state changes in future M-numbered milestones, prefer `wrangler d1 execute --remote --command="..."` for single-statement updates; for multi-statement files, prefer `--file scripts/<sql-file>` to avoid shell-quoting pitfalls (see `m3-deploy.md` D1 quirks).

## D1 quirks (carried forward from M3)

These still apply to any future D1 migration or wrangler `d1 execute --remote` command:

1. **`BEGIN TRANSACTION` / `COMMIT` rejected.** Even comments containing the word `TRANSACTION` trigger wrangler's parser. Use phrases like "transaction-control statements" instead.

2. **Standard SQLite NOT NULL table-rebuild fails on D1's migration-apply path** with `FOREIGN KEY constraint failed`. Use the SQLite 3.35+ column-rename pattern (see migration 0023 for the canonical example).

3. **`wrangler d1 execute --remote --file --json`** emits upload-progress UI characters to stdout BEFORE the JSON payload. Strip everything before the first `[` or `{` to recover (see `scripts/backfill-customers.js execWrangler` helper for the pattern).

## Verification post-each-batch

Hit production endpoints to confirm Worker is healthy:

```bash
curl -fsS https://airactionsport.com/api/health
curl -fsS https://airactionsport.com/api/events | head -c 200
```

For UI-touching batches (B2b, B3b, B4b–B4f, B5, B6, B7, B12a, B12b, B12c), additionally:
- Hard-refresh `/admin` (Ctrl+Shift+R).
- Verify persona dashboard renders (post-B9; AdminDashboardPersona is the sole code path post-B12a).
- Verify Cmd+K opens the command palette (post-B8; gate removed in B12b).
- Verify `/admin/customers` loads (post-B8; gate removed in B12b).
- Verify `/admin/bookings` + `/admin/bookings/:id` load (post-B2b/B3b).
- After B12c: verify `/admin/today` direct navigation renders the empty-state card (no event today is the realistic case for most days).

## Final post-M4 state (2026-05-07)

- **`main` tip after B12c**: closing-batch merge commit (`merge: M4 B12c → main`).
- **`milestone/4-bookings-ia-completion` tip**: B12c squash on milestone branch.
- **All 16 batches** (B0 through B12c, with B10 collapsed and B11 deferred) merged to both branches via per-batch rolling brings-up.
- **917 unit tests across 100 files** (+300 vs M3 close).
- **9 D1 migrations applied to remote across M3+M4**: 0021 (M2), 0022/0023/0024/0025 (M3), 0026/0027/0028/0029 (M4).
- **1 feature flag live**: `density_compact` (M2 user_opt_in). The 3 M4 flags (`command_palette`, `customers_entity`, `new_admin_dashboard`) were created in M3+M4 migrations, flipped to `on` in B8/B9, all consumers removed in B12a/B12b, and rows DELETEd in operator action post-B12b.
- **Lint**: 0 errors / 287 warnings (M4 close baseline; net -6 from B7 baseline 293 — B12a removed 12 JSX false-positives, B12c added 6 for AdminToday helpers).
- **9 decision-register entries** D01-D09 in `docs/decisions.md`.
- **28 gated paths** in `scripts/test-gate-mapping.json gates`.

## Rollback

See `m4-rollback.md` for the per-batch rollback recipes + the decision tree.
