# Next-session prompt — M7 in progress (Batch 8 next)

Fresh-session entry point for Air Action Sports work. **Updated 2026-05-31** — M7 Batches 0–7 merged to the milestone branch (Reports surface complete + audit-log FTS5 + virtualized tables); **Batch 8 (Resend bounce/complaint webhook) is next**.

Copy the [prompt block](#copy-paste-prompt-resume-at-m7-batch-8) into a new Claude Code session.

---

## Current state at a glance

| Metric | Value |
|---|---|
| **Active milestone** | **M7 — Reports + Audit Log FTS + Virtualized Tables** (in progress) |
| **Milestone branch** | `milestone/7-reports-search-virtualized` (off `main` at `1e6062b`) |
| **Last batch completed** | **Batch 7** (virtualized admin tables) — merged 2026-05-31 |
| **Next batch** | **Batch 8** — Resend bounce/complaint webhook consumer (migration 0065) |
| **Milestone branch HEAD** | `54e5bd4` (Merge #221 Batch 7) |
| **`main` HEAD** | `1e6062b` (Merge #208 Marketing B1) — **M7 NOT yet deployed to prod** |
| **Tests on milestone** | **2513 / 196 passing** |
| **Build** | clean (~270ms) |
| **Production health** | `https://airactionsport.com/api/health` → `{"ok":true,...}` (running pre-M7 `main`) |
| **D1 migrations on remote** | 0001–**0064** applied (0062 reports caps, 0063 FTS5 index, 0064 audit_log_fts flag — all applied + verified 2026-05-31) |
| **Open PRs** | 0 (all 7 M7 batches merged to milestone) |

> **M7 deploys to production at milestone close (Batch 12)** — the milestone branch accumulates batches; `milestone → main` (which Workers-Builds auto-deploys) happens once, at the end. Batches 0–7 are on the milestone branch only.

---

## M7 batch plan (12 batches; 8 done, 4 remaining)

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
| **8** | **Resend bounce/complaint webhook consumer** | **0065** | — | **← NEXT** |
| 9 | Admin visual regression baselines (resolves M4 B11 deferral) | — | — | pending |
| 10 | Email templates for bounce/complaint alerts | 0066 | — | pending |
| 11 | Reports polish + virtualization perf tuning | — | — | pending |
| 12 | Closing runbooks + baseline coverage + CLAUDE.md/HANDOFF.md flips + milestone→main | — | — | pending |

All 17 reports across 4 personas are **live on the milestone branch**; all 16 report endpoints implemented (no 501 stubs).

---

## Operator action pending

1. **Batch 7 visual verification (recommended before M7 close).** The 4 virtualized lists (`/admin/events`, `/admin/promo-codes`, `/admin/roster?event=…`, `/admin/rentals/assignments`) were build/lint/test-verified but **not** browser-verified (admin pages need an authenticated session). Eyeball: columns align with headers, smooth scroll, actions work. Events + RentalAssignments now use an inner bounded-height scroll (was page-scroll).
2. **Flip the `audit_log_fts` flag at M7→main cutover.** Migrations 0063/0064 are applied (index verified: fts rows = audit_log rows; `MATCH 'cron*'` → 2463 hits) but the flag is `state='off'` (prod still runs the pre-M7 audit route, which ignores it). When M7 reaches main, flip it on to enable FTS search:
   ```sql
   UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';
   ```
3. **M6 live-Stripe cutover items 1–5** still pending (see [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md)) — land before M7 close.

---

## Copy-paste prompt (resume at M7 Batch 8)

```
I'm resuming the Air Action Sports admin overhaul at M7 Batch 8.

CURRENT STATE:
- Active milestone: M7 (Reports + Audit Log FTS + Virtualized Tables)
- Milestone branch: milestone/7-reports-search-virtualized (HEAD 54e5bd4, Merge #221)
- main HEAD: 1e6062b — M7 NOT yet deployed to prod (deploys at Batch 12 close)
- Tests on milestone: 2513/196 passing
- Migrations on remote: 0001-0064 applied (0062 reports caps, 0063 FTS5, 0064 audit_log_fts flag — all verified; flag state 'off')

M7 BATCHES MERGED (to milestone): 0, 1a, 1b, 2, 3, 4, 5, 6, 7
  - 2-5: all 17 reports across 4 personas (Owner/Bookkeeper/Marketing/Site Coordinator); 16 endpoints live
  - 6: audit-log FTS5 search (flag-gated, LIKE fallback)
  - 7: virtualized tables (TanStack Virtual) on Roster/Events/PromoCodes/RentalAssignments

NEXT BATCH: Batch 8 — Resend bounce/complaint webhook consumer (migration 0065)
  Pattern: mirror M6's charge.dispute.created additive webhook consumer.
  Likely files (~8, at cap):
    - migrations/0065_email_events.sql (email_bounces / email_complaints tables; spot-check schema first)
    - worker/routes/webhooks.js — ADD `else if` branches for email.bounced + email.complained
      (additive only — Critical DNT; do NOT modify existing handlers/signature verify)
    - worker/lib/emailEvents.js (NEW pure helpers: idempotency key, payload shaping) + test
    - customer comm-prefs linkage (mark email_marketing=0 on hard bounce/complaint?) — confirm scope
    - route/admin surface to view bounces/complaints (Customer Detail Comms tab? confirm)
    - tests (lib + webhook consumer)
  NOTE: Resend webhook signing — verify how Resend signs webhooks (svix-style headers);
        add a verify step mirroring stripe.verifyWebhookSignature if Resend provides one.

START WITH:
1. Read CLAUDE.md "Milestone 7" section + docs/next-session.md + memory m7_in_progress.md
2. Spot-check production schema before authoring migration 0065 (Lesson #7 / D1 quirk #5):
   SELECT sql FROM sqlite_master WHERE name IN ('customers','audit_log','email_templates')
3. git checkout milestone/7-reports-search-virtualized && git pull
4. npm install && npm test -- --run (expect 2513/196) && npm run build (clean)
5. Plan-mode-first for Batch 8 (8-file target, 10 ceiling). Present plan, await "proceed".

OPERATING RULES IN EFFECT (durable across M7):
- Plan-mode-first per batch. 8-file target / 10 ceiling. Conventional Commits m7-batch-N.
- Flat m7-batch-N-slug sub-branches; PR -> milestone branch; no direct commits to main/milestone.
- NO applying migrations to remote from Claude Code unless the operator explicitly authorizes
  it that turn (they did so for 0062/0063/0064 this session).
- NO wrangler deploy from Claude. milestone -> main only at Batch 12 close.
- DNT files (bookings.js / waivers.js / stripe.js / auth.js + existing emailSender senders +
  existing webhooks.js handlers/signature-verify) extended ADDITIVELY only.
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
npm test -- --run | tail -5                            # expect 2513 / 196
npm run build 2>&1 | tail -3                           # expect clean
curl -s https://airactionsport.com/api/health          # {"ok":true,...} (pre-M7 main)
```

---

## Key reference docs

| Path | Purpose |
|---|---|
| `docs/next-session.md` | THIS FILE — fresh-session resume entry point |
| `CLAUDE.md` | "Milestone 7" section — batch table + lessons |
| `memory/m7_in_progress.md` (auto-memory) | live M7 state snapshot |
| `docs/m7-discovery/reports-scope.md` | the 17 reports' query shapes (Batches 2-5, done) |
| `docs/m7-pre-flight-verification.md` | schema captures (Batch 0) |
| `docs/audit/06-do-not-touch.md` | DNT list |
| `scripts/test-gate-mapping.json` | test-gate map (reports.js, auditSearch.js, auditLog.js gated) |
| `docs/m6-operator-cutover-checklist.md` | M6's 5 deferred live-Stripe items |
```
