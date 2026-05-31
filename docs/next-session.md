# Next-session prompt — M7 in progress (Batch 11 next)

Fresh-session entry point for Air Action Sports work. **Updated 2026-05-31** — M7 Batches 0–10 merged to the milestone branch (Reports surface + audit-log FTS5 + virtualized tables + Resend bounce/complaint webhook consumer + admin visual baselines + bounce/complaint alert emails); **Batch 11 (reports polish + virtualization perf tuning) is next**.

Copy the [prompt block](#copy-paste-prompt-resume-at-m7-batch-11) into a new Claude Code session.

---

## Current state at a glance

| Metric | Value |
|---|---|
| **Active milestone** | **M7 — Reports + Audit Log FTS + Virtualized Tables** (in progress) |
| **Milestone branch** | `milestone/7-reports-search-virtualized` (off `main` at `1e6062b`) |
| **Last batch completed** | **Batch 10** (bounce/complaint admin alert emails) — merged 2026-05-31 |
| **Next batch** | **Batch 11** — reports polish + virtualization perf tuning (no migration) |
| **Milestone branch HEAD** | `443fdbc` (Merge #225 Batch 10) |
| **`main` HEAD** | `1e6062b` (Merge #208 Marketing B1) — **M7 NOT yet deployed to prod** |
| **Tests on milestone** | **2558 / 200 passing** (+ 6 admin visual baselines via Playwright, not vitest) |
| **Build** | clean (~270ms) |
| **Production health** | `https://airactionsport.com/api/health` → `{"ok":true,...}` (running pre-M7 `main`) |
| **D1 migrations on remote** | 0001–**0064** applied; **0065 + 0066 ship in-repo, operator-applies after M7→main** |
| **Open PRs** | 0 (all 11 M7 batches merged to milestone) |

> **M7 deploys to production at milestone close (Batch 12)** — the milestone branch accumulates batches; `milestone → main` (which Workers-Builds auto-deploys) happens once, at the end. Batches 0–10 are on the milestone branch only.

---

## M7 batch plan (12 batches; 11 done, 1 remaining)

| Batch | What | Migration | PR | Status |
|---|---|---|---|---|
| 0 | Pre-flight verification + reports scope | — | #212 | ✓ merged |
| 1a | Reports shell backend (caps + 16-endpoint stub + sidebar) | 0062 (applied) | #213 | ✓ merged |
| 1b | Reports shell UI (4-tab strip + base components) | — | #214 | ✓ merged |
| 2 | Owner reports (5: revenue/retention/refund-rate/repeat/AOV) | — | #216 | ✓ merged |
| 3 | Bookkeeper reports (payouts/tax-fee/period-comparison + 1099 link) | — | #217 | ✓ merged |
| 4 | Marketing reports (funnel/promo/cohorts/channel) | — | #218 | ✓ merged |
| 5 | Site Coordinator reports (field-rental rev/COI/lead-conv/recurrence) | — | #219 | ✓ merged |
| 6 | Audit-log full-text search (FTS5), flag-gated | 0063 + 0064 (applied) | #220 | ✓ merged |
| 7 | Virtualized admin tables (TanStack Virtual) | — | #221 | ✓ merged |
| 8 | Resend bounce/complaint webhook consumer (signed `/api/webhooks/resend`; `email_events`; auto-suppress) | 0065 | #223 | ✓ merged |
| 9 | Admin visual regression baselines (local-serve + Playwright route-mock; 6 baselines) | — | #224 | ✓ merged |
| 10 | Bounce/complaint admin alert emails (hard-bounce + complaint; self-alert guard) | 0066 | #225 | ✓ merged |
| **11** | **Reports polish + virtualization perf tuning** | — | — | **← NEXT** |
| 12 | Closing runbooks + baseline coverage + CLAUDE.md/HANDOFF.md flips + milestone→main | — | — | pending |

All 17 reports across 4 personas are live; audit-log FTS5 + virtualized tables + the full Resend deliverability loop (consumer → suppress → alert) are on the milestone branch.

---

## Operator actions pending

1. **At M7→main cutover (Batch 12):**
   - Apply migrations **0065** (email_events) + **0066** (bounce/complaint alert templates) to remote: `npx wrangler d1 migrations apply air-action-sports-db --remote`.
   - Flip the `audit_log_fts` flag on:
     ```sql
     UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';
     ```
   - **Batch 8 live cutover:** `wrangler secret put RESEND_WEBHOOK_SECRET`, then add the Resend dashboard webhook → `https://airactionsport.com/api/webhooks/resend` (subscribe `email.bounced` + `email.complained`). Until then `/resend` safely returns 500; once live, the Batch 10 alert emails fire end-to-end.
2. **Batch 7 visual verify (recommended):** browser-check the 4 virtualized lists — `/admin/events`, `/admin/promo-codes`, `/admin/roster?event=…`, `/admin/rentals/assignments` (columns align, smooth scroll, actions work).
3. **M6 live-Stripe cutover items 1–5** still pending (see [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md)) — land before M7 close.

---

## Copy-paste prompt (resume at M7 Batch 11)

```
I'm resuming the Air Action Sports admin overhaul at M7 Batch 11.

CURRENT STATE:
- Active milestone: M7 (Reports + Audit Log FTS + Virtualized Tables)
- Milestone branch: milestone/7-reports-search-virtualized (HEAD 443fdbc, Merge #225)
- main HEAD: 1e6062b — M7 NOT yet deployed to prod (deploys at Batch 12 close)
- Tests on milestone: 2558/200 passing (+ 6 admin visual baselines via Playwright)
- Migrations on remote: 0001-0064 applied; 0065 + 0066 ship in-repo (operator-applies after M7->main)

M7 BATCHES MERGED (to milestone): 0-10
  - 2-5: all 17 reports across 4 personas (Owner/Bookkeeper/Marketing/Site Coordinator)
  - 6: audit-log FTS5 search (flag-gated, LIKE fallback)
  - 7: virtualized tables (TanStack Virtual) on Roster/Events/PromoCodes/RentalAssignments
  - 8: Resend bounce/complaint webhook consumer (signed /api/webhooks/resend; email_events; auto-suppress marketing)
  - 9: admin visual regression baselines (local-serve + Playwright route-mock harness; 6 linux baselines)
  - 10: bounce/complaint admin alert emails (sendBounceAlert/sendComplaintAlert; hard-bounce + complaint; self-alert guard)

NEXT BATCH: Batch 11 — reports polish + virtualization perf tuning (no migration)
  This is a polish/tuning batch — scope it during planning. Candidate items:
    - Reports UX polish: loading/empty states, CSV export edge cases, date-range presets,
      number/currency formatting consistency across the 17 report cards
    - Virtualization perf: row-height measurement, overscan tuning, scroll smoothness on the
      4 virtualized lists (Roster/Events/PromoCodes/RentalAssignments)
    - Reports performance budget check (Phase 4 §6): first report <=800ms p50, all <=2s p50
    - Optional: a representative-data layer for the admin visual baselines (B9 shipped empty-state)
  CONFIRM the exact scope with the operator in plan mode before executing.

START WITH:
1. Read CLAUDE.md "Milestone 7" section + docs/next-session.md + memory m7_in_progress.md
2. git checkout milestone/7-reports-search-virtualized && git pull
3. npm install && npm test -- --run (expect 2558/200) && npm run build (clean)
4. Plan-mode-first for Batch 11 (8-file target, 10 ceiling). Present plan, await "proceed".

OPERATING RULES IN EFFECT (durable across M7):
- Plan-mode-first per batch. 8-file target / 10 ceiling. Conventional Commits m7-batch-N.
- Flat m7-batch-N-slug sub-branches; PR -> milestone branch; no direct commits to main/milestone.
- NO applying migrations to remote from Claude Code unless the operator explicitly authorizes it.
- NO wrangler deploy from Claude. milestone -> main only at Batch 12 close.
- DNT files (bookings.js / waivers.js / stripe.js / auth.js + existing emailSender senders +
  existing webhooks.js Stripe handlers/signature-verify) extended ADDITIVELY only.
- Mandatory between-batch 5-bullet closing summary; update docs/next-session.md + memory each batch.
- Every email_templates seed: id='tpl_<slug>' + slug + created_at=updated_at (Lesson #7).

D1 QUIRKS (CLAUDE.md): no TRANSACTION keyword; NOT NULL via column-rename; wrangler --json --file
emits UI chars + returns SUMMARY on --remote reads (use --command for reads); capabilities col is
`category` not `scope`. FTS5 + triggers confirmed working on D1 (Batch 6).
```

---

## Resume checklist (run first in a fresh session)

```bash
cd C:/Users/bulle/OneDrive/Desktop/Claude\ Code\ Projects/action-air-sports
git status                                             # clean except marketing/ + .PNG untracked
git checkout milestone/7-reports-search-virtualized
git pull origin milestone/7-reports-search-virtualized
npm install
npm test -- --run | tail -5                            # expect 2558 / 200
npm run build 2>&1 | tail -3                           # expect clean
curl -s https://airactionsport.com/api/health          # {"ok":true,...} (pre-M7 main)
```

> Admin visual suite (optional, needs Chromium): `npx playwright install chromium` then
> `npm run test:visual:admin` — compares the 6 admin baselines. Baselines are CI-generated (linux);
> don't commit local PNGs. See [docs/runbooks/visual-regression.md](runbooks/visual-regression.md).

---

## Key reference docs

| Path | Purpose |
|---|---|
| `docs/next-session.md` | THIS FILE — fresh-session resume entry point |
| `CLAUDE.md` | "Milestone 7" section — batch table + lessons (Batches 0–10 done) |
| `memory/m7_in_progress.md` (auto-memory) | live M7 state snapshot |
| `docs/m7-discovery/reports-scope.md` | the 17 reports' query shapes (Batches 2–5, done) |
| `docs/runbooks/visual-regression.md` | public + admin (B9) visual-regression harness |
| `docs/audit/06-do-not-touch.md` | DNT list |
| `scripts/test-gate-mapping.json` | test-gate map (reports/auditSearch/auditLog/resendWebhook/emailEvents + webhooks.js gated) |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 deferred live-Stripe items |
