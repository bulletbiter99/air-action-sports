# M4 rollback runbook

Rollback recipes for Milestone 4, ordered from cheapest (no redeploy needed) to most invasive. Mirrors the structure of `m3-rollback.md` but reflects M4's specifics: 3 feature flags rolled out then DELETEd, legacy AdminDashboardLegacy + NAV_SECTIONS removed in B12a, flag-check call sites removed in B12b, /admin/today page activated in B12c.

## Decision tree

| Symptom | Action |
|---|---|
| Persona dashboard or new sidebar broken | Revert B12a + B12b together (re-INSERTing flag rows alone won't help — the legacy code paths are deleted). |
| Cmd+K palette broken / not opening | Revert B12b. The listener is unconditional post-B12b; if broken, the bug is in CommandPalette or the listener wiring. |
| `/admin/customers` page broken | Revert B12b (page guard removed there). |
| `/admin/today` blank / 404 | Revert B12c. `/admin/today` route lives in B12c only. Sidebar Today entry will still render (B5) but click 404s — minor UX regression, not data-affecting. |
| Bookings list `/admin/bookings` broken | Revert B2b / B3a / B3b individually depending on which path's broken. |
| New booking walk-up speed wins broken | Revert B6 (CheckInBanner / CustomerTypeahead / recall) OR B12b (which removed the gating). |
| Need to re-INSERT a flag row for triage | See "Level 0" below — restoration is symbolic only (no consumer code remains). |
| Need to fully undo a B-batch | `git revert` the batch's squash commit on main, then redeploy. |

---

## Level 0 — Re-INSERT a flag row (mostly symbolic)

After B12b, all 3 M4 flags have no consumer code. Re-INSERTing the row doesn't restore any feature gate; it just makes the row visible in `/api/admin/feature-flags` for future reference. Useful if a future migration reads the row's existence.

```bash
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 execute air-action-sports-db --remote \
  --command="INSERT INTO feature_flags (key, description, state, user_opt_in_default, created_at, updated_at) VALUES ('command_palette', 'Cmd+K palette', 'on', 0, strftime('%s','now')*1000, strftime('%s','now')*1000), ('customers_entity', 'Customers UI', 'on', 0, strftime('%s','now')*1000, strftime('%s','now')*1000), ('new_admin_dashboard', 'Persona dashboard', 'on', 0, strftime('%s','now')*1000, strftime('%s','now')*1000);"
```

If you also `git revert` B12b in the same incident, restoration order is: re-INSERT flag rows FIRST, then revert B12b code change. The reverted code's `useFeatureFlag(...)` lookups need the rows present.

## Level 1 — Revert a single B-batch

Each batch is a single squash commit on `main` (rolling brings-up). To revert:

```bash
git revert <batch-squash-sha> -m 1   # merge commit on main
# OR
git revert <batch-squash-sha>        # squash commit
```

The per-batch SHAs (squash on milestone → main commit via merge):

| Batch | Squash on milestone | Main merge commit | Notes |
|---|---|---|---|
| B0 | `fca7e2b` | (rolled into milestone) | Decisions + lint config; safe to revert if needed |
| B1a | `44908cf` | (PR #58) | Group G worker-level tests; purely additive |
| B1b | `e72cd97` | (PR #60) | Visual regression suite + 7 baselines |
| B2a | `d92cb3b` | (PR #62) | saved_views D1 + migration 0026 — see schema rollback |
| B2b | `e2dbc6c` | (PR #64) | /admin/bookings list + filter API + bulk + CSV |
| B3a | `961d12a` | (PR #66) | Booking detail backend + migration 0027 — see schema rollback |
| B3b | `955ffbb` | (PR #68) | /admin/bookings/:id detail workspace |
| B3c | `79f535d` | main `661e19f` (PR #70) | Docs handoff refresh |
| B4a | `497e808` | main `de0e05d` (PR #72) | users.persona migration 0028 — see schema rollback |
| B4b | `44b3fa8` | main `301f30e` (PR #74) | useWidgetData + personaLayouts foundation |
| B4c | `b5efb8c` | main `5dc1a7e` (PR #76) | BC widgets |
| B4d | `b649dac` | main `971d42f` (PR #78) | Owner widgets + endpoints + ?period=mtd |
| B4e | `875fb7f` | main `2f1ea13` (PR #80) | Marketing widgets + /analytics/funnel |
| B4f | `6aa7fa3` | main `73eb30b` (PR #82) | Bookkeeper widgets + tax/fee totals |
| B5 | `0a7c5c3` | main `69f3e83` (PR #84) | Sidebar IA reorg |
| B6 | `7bddaca` | main `1c0806b` (PR #86) | Walk-up speed wins |
| B7 | `f2c2d1e` | main `59aaa4d` (PR #88) | Cmd+K palette + migration 0029 |
| B7c | `e95ff1a` | main `55be926` (PR #90) | Handoff refresh |
| B8 | `4b0260c` | main `6eaa3e5` (PR #92) | Atomic flag rollout (`command_palette`+`customers_entity` to on) |
| B9 | `beec625` | main `159142a` (PR #94) | `new_admin_dashboard` to on |
| B12a | `356347c` | main `cd4749c` (PR #96) | Legacy AdminDashboardLegacy + NAV_SECTIONS removal |
| B12b | `1152ca3` | main `5c71b03` (PR #98) | Flag-check call sites removed; flag rows DELETEd post-deploy |
| B12c | (this batch) | (this batch) | /admin/today page + closing runbooks |

**Revert hazards**:
- **B12a + B12b together**: reverting just B12b leaves dead-code branches in (legacy returns nothing because legacy was deleted in B12a). Revert both, OR re-INSERT flag rows AND revert B12b alone (the legacy code is gone either way).
- **B2a, B3a, B4a, B7**: each ships a migration (0026-0029). Reverting the code without rolling back the migration is mostly fine (D1 columns/tables stay; just unused). See "Level 2" for true rollback.
- **B0**: don't revert; lint config makes CI fail otherwise.
- **B12c**: safe to revert in isolation — no DB or flag changes. `/admin/today` route disappears; sidebar Today entry continues to render but clicks 404 (mild UX regression).

## Level 2 — Migration rollback

M4 introduced 4 forward-only migrations: 0026 (saved_views), 0027 (bookings_refund_external + email template seed), 0028 (users.persona), 0029 (command_palette flag).

### 0026 → drop saved_views table

Only do this if absolutely necessary — operators may have saved view definitions:

```sql
DROP TABLE IF EXISTS saved_views;
-- Then update d1_migrations to mark 0026 as un-applied.
```

### 0027 → drop bookings.refund_* columns + remove email template seed

```sql
-- Use SQLite 3.35+ column-drop pattern:
ALTER TABLE bookings DROP COLUMN refund_method;
ALTER TABLE bookings DROP COLUMN refund_recorded_at;
ALTER TABLE bookings DROP COLUMN refund_recorded_by;
ALTER TABLE bookings DROP COLUMN refund_recorded_amount_cents;

-- Remove email template seed:
DELETE FROM email_templates WHERE template_id='refund_recorded_external';
```

### 0028 → drop users.persona column + reverse backfill

```sql
ALTER TABLE users DROP COLUMN persona;
```

The backfill was `role → persona` derivation; nothing to reverse on the data side (role column unchanged).

### 0029 → re-DELETE the command_palette flag row

This already happened in B12b. If the row was re-INSERTed for triage (Level 0), re-DELETE:

```sql
DELETE FROM feature_flags WHERE key='command_palette';
```

### Schema rollback verification

Always run after schema rollback:

```bash
npx wrangler d1 execute air-action-sports-db --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

## Level 3 — Deep-link param parsing (NOT a rollback condition)

Known minor limitation as of M4 close: `AdminScan` + `AdminRoster` do not parse the `?event=evt_xyz` query param emitted by:
- `CheckInBanner` (B6 — "Open scan →" button)
- `TodayCheckIns` persona widget (B4c)
- `/admin/today` quick-action tiles (B12c)

The deep-links navigate to the destination but don't pre-select the event in the dropdown picker. The pages still function — operator can manually pick the event from the dropdown. This is not a rollback condition; it's M5+ polish work (~10 lines per file using `useSearchParams()`).

## D1 quirks (carry these forward from M3)

The 3 quirks discovered in M3 still apply if any future incident requires a migration:

1. **`BEGIN TRANSACTION` / `COMMIT` rejected.**
2. **Standard SQLite NOT NULL table-rebuild fails on D1's migration-apply path** — use SQLite 3.35+ column-rename pattern.
3. **`wrangler d1 execute --remote --file --json`** emits non-JSON UI characters before the payload — strip them.

See `m3-deploy.md` for the full quirks reference.
