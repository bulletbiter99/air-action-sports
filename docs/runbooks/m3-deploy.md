# M3 deploy runbook

What it took to ship Milestone 3 (customers schema + persona-tailored AdminDashboard) end-to-end. Captures the actual sequence used in the 2026-05-07 deploy session, including the operator-driven remote D1 ops that the per-batch protocol couldn't run from Claude. Mirrors the structure of `m2-deploy.md` but reflects the changes M3 introduced (multiple migrations, mid-flight `milestone → main` brings-up, two feature flags, a discovered D1 quirk on transaction-control statements).

## Pre-flight

Before any batch executes:

1. `git fetch origin --prune`
2. Confirm `milestone/3-customers` tip matches what's in CLAUDE.md M3 batch table.
3. `npm test` should be 617/617 across 80 files at M3 close.
4. `npm run lint` should be 0 errors (M3 B0 made lint blocking).
5. `npx wrangler d1 migrations list air-action-sports-db --remote` should show migrations 0001–0025 applied.

## Batch cadence used in M3

Every B-batch followed the same shape:

1. **Branch off `origin/milestone/3-customers`** (sub-branch named `m3-batch-N-slug`, flat per the M1/M2 ref-collision workaround).
2. **Plan-mode-first** — short prose plan in the response, then proceed.
3. **Write code + tests** (≤10 file cap; B3/B4/B5/B8 splits as a/b sub-batches when needed).
4. **`npm test` + `npm run lint` + `npm run build`** locally before pushing.
5. **Push + open PR** to `milestone/3-customers`.
6. **Wait CI** (Vitest + Workers Builds preview), then `gh pr merge --squash --delete-branch`.
7. **Open `milestone/3-customers → main` PR** for mid-flight bring-up (NOT the final close — M3 used rolling brings-up so each batch went live).
8. **Merge to main** (`--merge` to preserve per-batch SHAs as second-parent commits).
9. **Wait Workers Builds redeploy** on the main commit, verify `/api/health`.
10. **Repeat for next batch.**

## Operator-applied remote D1 ops

These steps had to run from a workstation with the Cloudflare API token (Claude can't apply remote D1 changes per the M3 stop-and-ask rules). Source `.claude/.env` for the token first.

### Migrations

| When | Command | Risk |
|---|---|---|
| Post-B3 merge | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Adds customers/customer_tags/segments/gdpr_deletions tables + nullable customer_id columns. Additive — no risk. |
| Post-B5 deploy + spot-check zero NULL customer_ids | `node scripts/backfill-customers.js --remote` | Populates customer_id on every existing booking + attendee. Idempotent. Per-customer audit row emitted. |
| Post-backfill spot-check | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Applies 0023 NOT NULL via column-rename. Reversible only by hand. |
| Post-B8a merge | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Inserts `customers_entity` flag, state=off. Additive. |
| Post-B9 merge | `npx wrangler d1 migrations apply air-action-sports-db --remote` | Inserts `new_admin_dashboard` flag, state=off. Additive. |

### Feature-flag flips (state-level)

There's currently **no admin UI** for state-level flag changes (only per-user opt-in via `/admin/settings`). State changes require either a SQL UPDATE or a future `/admin/settings/feature-flags` page (deferred).

```sql
-- Scope to owner first (recommended rollout pattern):
UPDATE feature_flags
   SET state = 'role_scoped',
       role_scope = 'owner',
       updated_at = strftime('%s','now') * 1000
 WHERE key IN ('customers_entity', 'new_admin_dashboard');

-- Expand to manager (Phase 2 of rollout):
UPDATE feature_flags
   SET role_scope = 'owner,manager',
       updated_at = strftime('%s','now') * 1000
 WHERE key IN ('customers_entity', 'new_admin_dashboard');

-- Full rollout:
UPDATE feature_flags
   SET state = 'on',
       role_scope = NULL,
       updated_at = strftime('%s','now') * 1000
 WHERE key IN ('customers_entity', 'new_admin_dashboard');

-- Rollback:
UPDATE feature_flags
   SET state = 'off',
       role_scope = NULL,
       updated_at = strftime('%s','now') * 1000
 WHERE key IN ('customers_entity', 'new_admin_dashboard');
```

The reference flip script lives at [scripts/flip-flags-owner-scope.sql](../../scripts/flip-flags-owner-scope.sql) and was used in this milestone to scope both flags to owner for staged rollout. For state changes, prefer `wrangler d1 execute --remote --file scripts/<sql-file>` over `--command` to avoid shell-quoting pitfalls.

## D1 quirks discovered during M3 (carry these forward)

1. **`BEGIN TRANSACTION` / `COMMIT` rejected.** D1's wrangler execute / migrations-apply path returns `"To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead..."`. Local SQLite (via `wrangler dev --local`) accepts them, which masked the issue during B4 development. Never include those keywords in a migration file or in SQL that the backfill script generates. **Even comments containing the word `TRANSACTION` trigger wrangler's parser** (false-positive heuristic). Use phrases like "transaction-control statements" instead in comments.

2. **Standard SQLite NOT NULL table-rebuild fails on D1's migration-apply path** with `FOREIGN KEY constraint failed`. D1 enforces FKs during `DROP TABLE` even though runtime has them off by default. Use the SQLite 3.35+ column-rename pattern (`ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT ... / DROP COLUMN / RENAME COLUMN`) instead — see migration 0023 for the canonical example.

3. **`wrangler d1 execute --remote --file --json`** emits upload-progress UI characters to stdout BEFORE the JSON payload. JSON.parse fails on the leading non-JSON characters. The backfill script's `execWrangler` helper strips everything before the first `[` or `{` to recover. Pattern reusable for any future Node CLI that shells out to wrangler.

## Verification post-each-batch

Hit production endpoints to confirm Worker is healthy:

```bash
curl -fsS https://airactionsport.com/api/health
curl -fsS https://airactionsport.com/api/events | head -c 200
```

For UI batches (B8a/B8b/B9), additionally:
- Log in as owner (`bulletbiter99@gmail.com`).
- Hard-refresh `/admin` (Ctrl+Shift+R).
- Verify legacy AdminDashboard renders unchanged (with flags off).
- Optionally flip flags to `role_scoped owner` (per "Feature-flag flips" above) to test the new UI surfaces.

## Final post-M3 state (2026-05-07)

- **`main` tip after B12**: closing-batch merge commit (will be the latest `merge: M3 B12 → main` PR).
- **`milestone/3-customers` tip**: B12 squash on milestone branch.
- All 12 batches (B0–B12) merged to both branches via per-batch rolling brings-up.
- 617 unit tests across 80 files.
- 5 D1 migrations applied to remote: 0021 (M2 feature_flags), 0022 (M3 customers schema), 0023 (M3 NOT NULL), 0024 (customers_entity flag), 0025 (new_admin_dashboard flag).
- 3 feature flags live: `density_compact` (M2), `customers_entity` (M3 B8a), `new_admin_dashboard` (M3 B9). M3-era flags are `role_scoped owner` per the staged rollout.

## Rollback

See `m3-rollback.md` for the per-batch rollback recipes.
