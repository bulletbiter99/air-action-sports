# Next-session entry point — M7 CLOSED + DEPLOYED (post-M7)

Fresh-session entry point for Air Action Sports. **Updated 2026-05-31** — **Milestone 7 (Reports +
Audit-Log FTS + Virtualized Tables + Resend deliverability + admin visual baselines) is CLOSED +
DEPLOYED to production.** `milestone/7-reports-search-virtualized` merged to `main`; Workers Builds
auto-deployed. This file is the menu for what's next.

---

## ⚡ Post-M7 work-menu session (2026-05-31) — 11 PRs OPEN, awaiting merge

A session worked the post-M7 work menu (tracks 1–5). **11 PRs (#231–#241) are open + green**
(not yet merged). Track 3 (Marketing) is a 7-PR chain; the rest are independent off `main`.

| Track | Status | PRs |
|---|---|---|
| **1 — 11c Reports polish** | ✅ ready | [#231](https://github.com/bulletbiter99/air-action-sports/pull/231) — dateFormat util, CSV loading, friendly errors, shared compact money |
| **2 — representative-data visual baselines** | ✅ ready · **label `capture-baselines`** | [#232](https://github.com/bulletbiter99/air-action-sports/pull/232) — 4 populated virtualized-table baselines (visual-admin CI red until labeled) |
| **4 — M6 live-Stripe cutover** | ✅ audit done (cutover is operator-only) | [#233](https://github.com/bulletbiter99/air-action-sports/pull/233) — code-readiness audit; the 5 operator items remain |
| **3 — Marketing B2–B6** | ✅ code-complete (chain) | [#234](https://github.com/bulletbiter99/air-action-sports/pull/234) B2a→[#235](https://github.com/bulletbiter99/air-action-sports/pull/235) B2b→[#236](https://github.com/bulletbiter99/air-action-sports/pull/236) B3→[#237](https://github.com/bulletbiter99/air-action-sports/pull/237) B4→[#238](https://github.com/bulletbiter99/air-action-sports/pull/238) B5a→[#239](https://github.com/bulletbiter99/air-action-sports/pull/239) B5b→[#240](https://github.com/bulletbiter99/air-action-sports/pull/240) B6 |
| **5 — M8** | ◐ started | [#241](https://github.com/bulletbiter99/air-action-sports/pull/241) — a11y region pass on virtualized tables (1 of 3 M8 items) |

Tests on the marketing chain tip: **2656 / 208** (main is 2561). All PRs: build clean, 0 lint errors.

### Merge order (operator)
1. **#231, #233, #241** — independent, any order, straight to `main`.
2. **#232** — merge, then **label it `capture-baselines`** so CI seeds the 4 new admin PNGs (the `visual-admin` job is red until then — the documented B9 flow). Push an empty commit after the bot pushes baselines to re-trigger CI.
3. **Marketing chain in sequence:** #234 → #235 → #236 → #237 → #238 → #239 → #240. Each PR's base auto-retargets to `main` as the previous one merges; merge them in order.
4. No cross-PR conflicts (marketing is a self-contained chain; the other 4 touch disjoint files).

### Operator-pending added this session (on top of M7's 0065/0066 + RESEND_WEBHOOK_SECRET + `audit_log_fts` flag)
- **Apply migrations 0067–0070** (campaigns / tracking / automations / marketing caps) — see [docs/runbooks/marketing-deploy.md](runbooks/marketing-deploy.md). Routes degrade gracefully until applied.
- **Marketing send activation:** `MARKETING_POSTAL_ADDRESS` (CAN-SPAM, required) + Resend plan upgrade + (optional) marketing subdomain. The campaign/automation cron no-ops until set.
- **Resend webhook** now also feeds campaign tracking — subscribe `email.delivered`/`opened`/`clicked` too (B4).

### Deferred follow-ups (documented, intentional)
- **Marketing route capability swap** — segments/campaigns/automations stay `requireAuth`; the `requireCapability` swap is a follow-up to do AFTER 0070 is verified on remote (would 403 owners + break route tests otherwise; functionally identical today). Caps are seeded by 0070.
- **Marketing `date_relative` trigger** + **formal sidebar "Marketing" group** (cosmetic).
- **M8 remaining (track 5):** (a) full ARIA-grid cell roles on virtualized tables (needs a ~4-page cell refactor); (b) **sidebar consumes `/me` caps directly** (so site_coordinator sees Reports — currently the `CAPABILITY_TO_LEGACY_ROLE` stub; entangles with the marketing chain's sidebarConfig edits, so do it after the chain merges); (c) RTL test infra + JSX coverage backfill.
- **Admin visual baselines** for `/admin/campaigns` + `/admin/automations` (track-2 pattern).

---

## Current state at a glance

| Metric | Value |
|---|---|
| **Last milestone** | **M7 — ✓ CLOSED + DEPLOYED 2026-05-31** (milestone → main) |
| `main` HEAD | the `milestone → main` merge (see `git log --first-parent main`) |
| Tests | **2561 / 200** + 6 admin visual baselines + 7 public visual baselines |
| Build | clean (~260ms) |
| Production | `https://airactionsport.com/api/health` → `{"ok":true,...}` |
| Migrations on remote | 0001–**0064** applied; **0065 + 0066 in-repo, operator-applies** (see below) |
| Open milestone | none (M7 closed; next is operator-choice) |

---

## ⚠️ Operator-pending to fully activate M7's deferred features

M7 deployed **safely** — these steps activate features that are inert / use a fallback until done.
Full detail + commands: **[docs/runbooks/m7-deploy.md](runbooks/m7-deploy.md)**.

1. **Apply migrations 0065 (email_events) + 0066 (alert templates) to remote.**
2. **`wrangler secret put RESEND_WEBHOOK_SECRET`** + add the Resend dashboard webhook →
   `https://airactionsport.com/api/webhooks/resend` (subscribe `email.bounced` + `email.complained`).
3. **Flip the FTS flag on:** `UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';`
4. **Eyeball (no automated coverage):** the 4 virtualized lists' sticky headers (`/admin/events`,
   `/admin/roster?event=…`, `/admin/promo-codes`, `/admin/rentals/assignments`) + the Reports
   custom-range UI (`/admin/reports` → Period → Custom range).
- **Carried from M6:** live-Stripe cutover items 1–5 — [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md).

---

## What M7 shipped (Batches 0–11b)

- **Reports** — 17 reports across 4 personas (Owner / Bookkeeper / Marketing / Site Coordinator) at
  `/admin/reports`, capability-gated, CSV export, **custom date range** (11a).
- **Audit-log full-text search** (FTS5), flag-gated with a LIKE fallback (6).
- **Virtualized admin tables** (TanStack Virtual) on Roster / Events / PromoCodes / RentalAssignments,
  with **sticky scrollbar-aligned headers** (7 + 11b).
- **Resend bounce/complaint consumer** — signed `POST /api/webhooks/resend`: records `email_events`,
  auto-suppresses marketing on hard bounce/complaint, sends admin alert emails (8 + 10).
- **Admin visual-regression baselines** — local-serve + Playwright route-mock harness; `visual-admin`
  CI job (9).
- **Deferred:** 11c cosmetic Reports polish (see menu below).

---

## Post-M7 work menu (pick one for the next session)

| # | Track | Notes |
|---|---|---|
| 1 | **11c — cosmetic Reports polish** (deferred from M7) | Extract `src/utils/dateFormat.js` (OwnerReports duplicates MONTHS/monthLabel/dayLabel inline); CSV-export button loading state in `ReportLayout`; stop exposing raw `error.message` to users; reconcile compact-vs-full money formatting between charts and cards. ~6–8 files, low-risk. |
| 2 | **Representative-data admin visual baselines** | The Batch-9 baselines are empty-state only, so CI doesn't cover the populated virtualized tables (this is why 11b needed a manual eyeball). Add a few mocked rows + capture, so future virtualization/table changes are verified in CI. |
| 3 | **Marketing milestone B2+** | Segments shipped (B1, on main). B2–B6 remain (campaigns / sends). See memory `project_marketing_milestone.md`. |
| 4 | **M6 live-Stripe cutover** | The 5 deferred operator items (real $1 e2e, dispute test, saved-PM charge). `docs/m6-operator-cutover-checklist.md`. |
| 5 | **New milestone (M8)** | Candidates: RTL test infra + backfill JSX coverage (AdminReports, ReportLayout, older M3+ pages); sidebar consumes `/me` capabilities directly (so site_coordinator sees Reports); a11y pass on the virtualized tables. |

---

## Resume checklist (fresh session)

```bash
cd C:/Users/bulle/OneDrive/Desktop/Claude\ Code\ Projects/action-air-sports
git checkout main && git pull origin main     # M7 is merged + deployed
npm install
npm test -- --run | tail -5                    # expect 2561 / 200
npm run build 2>&1 | tail -3                    # expect clean
curl -s https://airactionsport.com/api/health   # {"ok":true,...}
```

---

## Key reference docs

| Path | Purpose |
|---|---|
| `docs/next-session.md` | THIS FILE — post-M7 entry point |
| `CLAUDE.md` "Milestone 7" section | M7 close state + lessons |
| `docs/runbooks/m7-deploy.md` | deploy sequence + **operator-pending steps** |
| `docs/runbooks/m7-rollback.md` | rollback decision tree |
| `docs/runbooks/m7-baseline-coverage.txt` | test/lint/build + gated-paths snapshot at close |
| `memory/m7_in_progress.md` (auto-memory) | M7 history (now closed) |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 deferred live-Stripe items |
