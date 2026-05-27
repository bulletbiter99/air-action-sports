# Next-session prompt — M7 in progress (Batch 2 next)

Fresh-session entry point for Air Action Sports work. **Updated 2026-05-27** — M6 CLOSED + post-M6 polish session shipped (9 PRs merged); M7 in progress (Batches 0/1a/1b shipped, Batch 2 next).

Copy the [prompt block](#copy-paste-prompt-resume-at-m7-batch-2) into a new Claude Code session.

---

## Current state at a glance

| Metric | Value |
|---|---|
| **Active milestone** | **M7 — Reports + Audit Log FTS + Virtualized Tables** (in progress) |
| **Milestone branch** | `milestone/7-reports-search-virtualized` (off `main` at `1e6062b`) |
| **Last batch completed** | **Batch 1b** (Reports shell UI) — merged 2026-05-27 |
| **Next batch** | **Batch 2** — Owner reports backend + UI (5 reports, ~8 files at cap) |
| **`main` HEAD** | `1e6062b` (Merge #208 Marketing B1) |
| **Milestone branch HEAD** | `652276f` (Merge #214 Batch 1b) |
| **Tests on milestone** | **2437 / 193 passing** |
| **Tests on main** | **2424 / 192** (M6 baseline + 9 polish PRs) |
| **Build** | clean (~254-264ms) |
| **Production health** | `https://airactionsport.com/api/health` → `{"ok":true,...}` |
| **Latest worker** | `1e6062b` deploy (post-Marketing-B1; M7 work stays on milestone branch, not yet in prod) |
| **D1 migrations on remote** | 0001–0061 (M7's 0062 **PENDING operator-apply**) |
| **Open PRs** | 0 (all 3 M7 batches merged to milestone; this docs PR pending) |

---

## What's done

| Milestone | Status |
|---|---|
| M1 — Test Infrastructure | ✓ closed 2026-05-06 |
| M2 — Shared Primitives | ✓ closed 2026-05-07 |
| M3 — Customers Schema | ✓ closed 2026-05-07 |
| M4 — Bookings + Detail Workspace + New Admin Shell | ✓ closed 2026-05-07 |
| M5 — Staff + Event-Day Mode | ✓ closed + deployed 2026-05-08 |
| M5.5 — Field Rentals | ✓ closed + deployed 2026-05-12 |
| M6 — Stripe Live Flow + Damage Charge + Vendor Templates + Email Drafts | ✓ closed 2026-05-27 |
| **Post-M6 polish** — Tracks B/C/D + Marketing B1 + sidebar | ✓ **9 PRs merged 2026-05-27** (#202–#211 less #205-replaced-by-#211) |
| **M7 Batch 0** — Pre-flight verification + reports scope | ✓ merged to milestone (PR #212) |
| **M7 Batch 1a** — Reports shell backend (caps + route stub + sidebar) | ✓ merged to milestone (PR #213) — **operator needs to apply migration 0062** |
| **M7 Batch 1b** — Reports shell UI (persona-aware tabs + base components) | ✓ merged to milestone (PR #214) |

---

## M7 batch plan (12 batches; 3 done, 9 remaining)

| Batch | What | Migration | Files | Status |
|---|---|---|---|---|
| 0 | Pre-flight verification + reports scope summary | — | 2 | ✓ done |
| 1a | Reports shell backend (caps + 16-endpoint stub + sidebar) | **0062** (pending apply) | 6 | ✓ done |
| 1b | Reports shell UI (4-tab strip + ReportLayout/EmptyState/Filters + route) | — | 5 | ✓ done |
| **2** | **Owner reports backend + UI (5 reports)** | — | ~8 (at cap) | **← NEXT** |
| 3 | Bookkeeper reports (3 reports; 1099 thresholds links to existing M5 page) | — | ~5 | pending |
| 4 | Marketing reports (4 reports) | — | ~5 | pending |
| 5 | Site Coordinator reports (4 reports — new persona from M5.5) | — | ~5 | pending |
| 6 | Audit log full-text search (FTS5) | **0063** + **0064** flag | 7 | pending |
| 7 | Virtualized tables (TanStack Virtual on 4 admin lists) | — | 6-8 | pending |
| 8 | Resend bounce/complaint webhook consumer | **0065** | 8 (at cap) | pending |
| 9 | Admin visual regression baselines (M4 B11 deferral resolved) | — | 7 | pending |
| 10 | Email templates for bounce/complaint alerts | **0066** | 5 | pending |
| 11 | Reports polish + virtualization perf tuning | — | ~6 | pending |
| 12 | Closing runbooks + baseline coverage + CLAUDE.md/HANDOFF.md flips | — | 4-5 | pending |

**M7 migrations land at 0062–0066** (above polish session's 0059/0060/0061 which are now on main).

---

## Operator action pending (gates Batch 2 live verification but NOT dev work)

**Apply migration 0062 to remote D1:**

```bash
cd C:/Users/bulle/OneDrive/Desktop/Claude\ Code\ Projects/action-air-sports
git checkout milestone/7-reports-search-virtualized
git pull origin milestone/7-reports-search-virtualized
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote
```

**Spot-check after apply:**

```bash
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT COUNT(*) AS n FROM capabilities WHERE key LIKE 'reports.%'" --json
# Expected: n = 6

source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT COUNT(*) AS n FROM role_preset_capabilities WHERE capability_key LIKE 'reports.%'" --json
# Expected: n = 16
```

Until 0062 applies, the Reports tab UI shows "No reports available for your role" because `/me` won't return any `reports.*` capabilities. Batch 2 dev work (writing the 5 Owner reports) doesn't BLOCK on this — tests use mocks. Live smoke does require it.

---

## What's left to do — M6 operator items still pending

These were deferred from M6 close and remain operator-only. Do NOT block M7 work, but should land before M7 close (Batch 12):

1. `wrangler secret put STRIPE_SECRET_KEY` with live key
2. `wrangler secret put STRIPE_WEBHOOK_SECRET` with live whsec
3. Configure live Stripe webhook endpoint at `https://airactionsport.com/api/webhooks/stripe`
4. Verify DMARC + SPF + DKIM DNS records
5. `$1` live e2e test: book → confirm saved PM → refund

See [`docs/m6-operator-cutover-checklist.md`](m6-operator-cutover-checklist.md). Batch 12's deploy runbook bundles these as Section X.

---

## Copy-paste prompt (resume at M7 Batch 2)

```
I'm resuming the Air Action Sports admin overhaul at M7 Batch 2.

CURRENT STATE:
- Active milestone: M7 (Reports + Audit Log FTS + Virtualized Tables)
- Milestone branch: milestone/7-reports-search-virtualized
- Milestone branch HEAD: 652276f (Merge #214 Batch 1b)
- main HEAD: 1e6062b
- Tests on milestone: 2437/193 passing
- Production health: 200 OK
- Migrations on remote: 0001-0061 (M7's 0062 PENDING operator-apply)

M7 BATCHES COMPLETE (merged to milestone):
- Batch 0 (PR #212): Pre-flight verification + reports scope summary
- Batch 1a (PR #213): Reports shell backend (caps + 16-endpoint stub + sidebar)
- Batch 1b (PR #214): Reports shell UI (4-tab strip + base components)

NEXT BATCH: Batch 2 — Owner reports backend + UI (5 reports)
  Files target: ~8 (at cap per M7 prompt)
    - worker/routes/admin/reports.js (extend with 5 Owner endpoints)
    - worker/lib/reports.js (NEW: computeRevenueTrends, computeRetention,
      computeRefundRate, computeRepeatCustomers, computeAOVTrend)
    - src/admin/reports/OwnerReports.jsx (NEW)
    - src/admin/reports/charts/LineChart.jsx (NEW)
    - src/admin/reports/charts/BarChart.jsx (NEW)
    - src/admin/reports/charts/MetricCard.jsx (NEW)
    - tests/unit/lib/reports.test.js (NEW)
    - tests/unit/admin/reports/OwnerReports.test.jsx (NEW — defer if no RTL)
  Performance budget: ≤800ms p50 / ≤1.5s p95 first report visible

OPERATOR ACTION PENDING:
- Apply migration 0062 (reports capabilities) to remote D1 — needed for
  live smoke but NOT for Batch 2 dev work (tests use mocks).
- See "Operator action pending" section above for exact commands.

START WITH:
1. Read CLAUDE.md M7 section + this docs/next-session.md
2. Read docs/m7-pre-flight-verification.md + docs/m7-discovery/reports-scope.md
   for Batch 2's data sources + query shapes
3. Check git status — should be clean except marketing/ + logo .PNG untracked
4. git checkout milestone/7-reports-search-virtualized && git pull
5. Run pre-flight checks:
   - npm test (expect 2437/193)
   - npm run build (expect clean)
6. Plan-mode-first for Batch 2 (8-file target, 10 ceiling). Present plan,
   await "proceed".

OPERATING RULES IN EFFECT (durable across M7):
- Plan-mode-first per batch. Present plan, await ack, then edit.
- 8-file operating target / 10-file ceiling per PR. Split if larger.
- Conventional Commits with m7-<area> scope.
- Sub-branches: flat m7-batch-N-slug naming.
- No --force on shared branches. No direct commits to main or milestone.
- NO applying migrations to remote D1 from Claude Code (rule #7).
- NO wrangler deploy from Claude Code (rule #8).
- DNT files extended additively only (new functions/endpoints/branches —
  never modify existing).
- Mandatory between-batch 5-bullet closing summary.
- Browser-verify shells in Claude_in_Chrome where applicable; admin pages
  need javascript_tool not screenshot (per memory).
- Pre-migration spot-check mandatory before any table-touching batch.
- Every email_templates seed: id='tpl_<slug>' + slug='<slug>' + created_at=updated_at.

CRITICAL D1 QUIRKS (per CLAUDE.md):
1. No BEGIN/COMMIT keywords in migrations
2. NOT NULL via table-rebuild fails; use column-rename pattern
3. wrangler --json --file= emits UI chars before JSON; strip first [ or {
4. wrangler --json --file= returns SUMMARY on remote; use --command= for reads
5. capabilities table column is `category` NOT `scope` (post-M6 polish lesson)

DO-NOT-TOUCH (M7-specific):
- worker/routes/bookings.js (POST /checkout) — NOT modified
- worker/routes/waivers.js — NOT modified
- worker/lib/stripe.js — NOT modified
- worker/lib/auth.js — NOT modified
- Existing 10 email senders in worker/lib/emailSender.js — only append new ones

KEY DOCS TO READ FOR BATCH 2:
- docs/m7-pre-flight-verification.md (schema captures + Lesson #7 confirms)
- docs/m7-discovery/reports-scope.md (5 Owner reports + query shapes)
- worker/routes/admin/reports.js (existing 501 stub to extend)
- migrations/0062_reports_capabilities.sql (the cap shape)
```

---

## Resume checklist (do these first in every fresh session)

```bash
cd C:/Users/bulle/OneDrive/Desktop/Claude\ Code\ Projects/action-air-sports
git status                                             # expect clean (marketing/ + .PNG untracked)
git checkout milestone/7-reports-search-virtualized
git pull origin milestone/7-reports-search-virtualized
npm install
npm test -- --run | tail -5                            # expect 2437 / 193
npm run build 2>&1 | tail -3                           # expect clean
curl -s https://airactionsport.com/api/health          # expect {"ok":true,...}
```

If any of these fail, that's the first thing to triage. The milestone history docs may have drifted from reality and need a sync.

---

## Key reference docs

| Path | Purpose |
|---|---|
| `HANDOFF.md` | Top section flipped to M7 in progress (see "NEW SESSION" block) |
| `CLAUDE.md` | M7 section appended after M6 close (search "Milestone 7") |
| `docs/next-session.md` | THIS FILE — fresh-session resume entry point |
| `docs/m7-pre-flight-verification.md` | Batch 0 output — schema captures + M6 verification |
| `docs/m7-discovery/reports-scope.md` | Batch 0 output — 17 reports across 4 personas with query shapes |
| `migrations/0062_reports_capabilities.sql` | Reports capabilities + role bundles (Batch 1a) |
| `worker/routes/admin/reports.js` | 16-endpoint stub returning 501 (Batch 1a; extend in Batches 2-5) |
| `src/admin/AdminReports.jsx` | Persona-aware tab strip page (Batch 1b) |
| `src/admin/reports/` | Shared components: ReportLayout, ReportEmptyState, ReportFilters (Batch 1b) |
| `docs/audit/06-do-not-touch.md` | DNT list (critical/high/medium tiers) |
| `scripts/test-gate-mapping.json` | Test-gate map |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 deferred operator items (gate M7 close, not M7 dev) |

---

## What to capture in the NEXT next-session.md update

Whenever a new M7 batch closes:

1. Update "Last batch completed" + "Next batch" in the state table
2. Update batch plan status column (✓ done vs pending)
3. Update test/migration counts
4. Update the copy-paste prompt's date / SHA / file references
5. Add any new operator-action-pending items
6. Commit the update as part of the closing batch (per-batch doc cadence)

When M7 itself closes (Batch 12):
- Flip "Active milestone" to "M7 ✓ closed" + add M8 entry
- Move all M7 batches to "What's done" table
- Rewrite the copy-paste prompt for M8
