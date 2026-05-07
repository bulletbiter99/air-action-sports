# M4 Batch 0 — M3 Invariants Check

Captured 2026-05-07 at the M4 kickoff (worktree at `3e90d5a` = main HEAD = M3 close PR [#54](https://github.com/bulletbiter99/air-action-sports/pull/54)).

## Test count

```
Test Files  80 passed (80)
     Tests  617 passed (617)
   Duration  ~2.1s
```

✓ Matches M3 close baseline ([docs/runbooks/m3-baseline-coverage.txt](../runbooks/m3-baseline-coverage.txt) line 6: "617 unit tests across 80 files").

## Lint

```
✖ 270 problems (0 errors, 270 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

✓ 0 errors — matches M3 B0's blocking lint posture (audit pain-point #8 closed via D03).
✓ 270 warnings is unchanged from M3 close (deferred react-hooks + unused-vars cleanup; held to "no new warnings" by review).

## Coverage — gated paths vs M3 baseline

`npm run test:coverage` snapshot, gated paths only (per [scripts/test-gate-mapping.json](../../scripts/test-gate-mapping.json)):

| File | M3 baseline | Now | Δ |
|---|---|---|---|
| worker/lib/pricing.js | 98.84 | 98.84 | = |
| worker/lib/stripe.js | 93.93 | 93.93 | = |
| worker/routes/webhooks.js | 91.37 | 91.37 | = |
| worker/routes/waivers.js | 93.61 | 93.61 | = |
| worker/lib/waiverLookup.js | 100 | 100 | = |
| worker/routes/admin/bookings.js | ~71 (M2 closing) | 72.7 | +1.7 |
| worker/lib/customers.js | 100 | 100 | = |
| worker/lib/customerEmail.js | 100 | 100 | = |
| worker/lib/auth.js | 100 | 100 | = |
| worker/lib/password.js | 100 | 100 | = |
| worker/lib/vendorToken.js | 100 | 100 | = |
| worker/routes/admin/customers.js | 97.79 | 97.79 | = |
| worker/lib/customerTags.js | 99.2 | 99.2 | = |
| worker/lib/featureFlags.js | 100 | 100 | = |
| worker/routes/admin/featureFlags.js | 100 | 100 | = |

✓ All 15 gated paths at-or-above M3 baseline.

## Uncovered (carry-forward — informational)

Per [scripts/test-gate-mapping.json](../../scripts/test-gate-mapping.json) `uncovered` section:

| File | Coverage now | Audit groups | Plan |
|---|---|---|---|
| worker/index.js | 34.42 | G65–G70 + H71–H76 | **Batch 1 of M4** raises Group G coverage; Group H deferred to M5 |
| worker/routes/bookings.js | 10.2 | (public-side checkout) | M6 territory |
| worker/lib/emailSender.js | 51.95 | (B partial) | indirect coverage via webhook tests; no dedicated suite planned for M4 |
| worker/lib/formatters.js | 9.3 | (shared with public site) | indirect coverage; not on M4 punch list |

## Feature flags — remote D1 state

Verified via `wrangler d1 execute --remote --json` in pre-flight:

| key | state | role_scope | Notes |
|---|---|---|---|
| `density_compact` | `user_opt_in` | (null) | M2 B5c — owner can flip per-user from /admin/settings |
| `customers_entity` | `role_scoped` | `owner` | M3 B8a — owner-only until M4 Batch 9 flips to `on` |
| `new_admin_dashboard` | `role_scoped` | `owner` | M3 B9 — owner-only until M4 Batch 8 flips to `user_opt_in` then Batch 12 to `on` |

✓ All three exist and are in expected post-M3-close states.

## Customers entity state

- Schema present (migrations 0022 + 0023 applied; verified via `wrangler d1 migrations list --remote` shows "No migrations to apply").
- Two customers on remote (operator-confirmed in HANDOFF / pre-flight; both = operator's own test bookings).
- Tag refresh cron registered: `wrangler.toml` adds `"0 3 * * *"` (verified via `git log` of `wrangler.toml` showing M3 B10 commit).

## D1 quirks — CLAUDE.md treatment

Currently: one-paragraph mention in [CLAUDE.md](../../CLAUDE.md) within the "Milestone 3 — Customers Schema + Persona-Tailored AdminDashboard" section, around the closing-state inventory:

> **Three D1 quirks discovered + carried forward** in docs/runbooks/m3-deploy.md: BEGIN/COMMIT rejected (incl. in comments — wrangler keyword-scans), table-rebuild fails on FK enforcement (use column-rename pattern), wrangler --remote --json --file emits UI chars before JSON.

Verdict: **insufficient for M4.** Future batches with migrations (0026 saved_views, 0027 bookings_refund_external, 0028 command_palette flag) will write SQL files that touch all three pitfalls. The quirks need to be a discoverable subsection of CLAUDE.md, not nested inside the M3-specific batch table. **Action:** Batch 0 promotes the three quirks to a top-level "Carry-forward: D1 quirks" subsection right after the do-not-touch list and before the Milestone 1 section, so they sit alongside other always-applicable rules.

## Production endpoints (live verification, pre-flight)

- `GET https://airactionsport.com/api/health` → 200 `{"ok":true}`
- `GET https://airactionsport.com/api/events` → 200, returns Operation Nightfall ("Ghost Town II", 2026-05-09, $80/head, 350 slots, cover image set)

✓ Production live; M3 deploy clean.

## Feedback queue

`SELECT status, COUNT(*) FROM feedback GROUP BY status` (remote D1):
- `resolved`: 5
- `new` / `in-progress`: **0**

✓ Nothing to triage at M4 kickoff.

## No drift detected

Aside from the one CLAUDE.md treatment promotion (D1 quirks subsection), no actionable drift between handoff docs and live state. M3 invariants intact; M4 build batches can begin once Batch 0 docs land.
