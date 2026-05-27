# Next-session prompt (post-M6)

Generic fresh-session entry point for Air Action Sports work. Copy the [prompt block](#copy-paste-prompt) into a new Claude Code session. **Updated 2026-05-27 — M6 CLOSED; no in-flight milestone code work.**

---

## Production state at last close

| Metric | Value |
|---|---|
| `main` HEAD | `84c2478` (B11 merge) |
| Latest worker | `2ee51d5a-4702-4cca-b7a5-05d74100ec31` |
| Health | `https://airactionsport.com/api/health` → `{"ok":true,...}` |
| Tests | **2292 / 184 passing** |
| Group A + Group B regression | **138 / 138** (149/149 expanded) |
| Lint | 0 errors / ~462 warnings (CI-visible tree) |
| Build | clean |
| D1 migrations on remote | 0001–0058 |
| Email templates in prod | 34 |
| Open PRs | 0 (1 stale April config-rename — ignorable) |
| Cron sweeps | 8 at 03:00 UTC |

## What's done

| Milestone | Status |
|---|---|
| M1 — Test Infrastructure | ✓ closed 2026-05-06 |
| M2 — Shared Primitives | ✓ closed 2026-05-07 |
| M3 — Customers Schema | ✓ closed 2026-05-07 |
| M4 — Bookings + Detail Workspace + New Admin Shell | ✓ closed 2026-05-07 |
| M5 — Staff + Event-Day Mode | ✓ closed + deployed 2026-05-08 |
| M5.5 — Field Rentals | ✓ closed + deployed 2026-05-12 |
| M6 — Stripe Live + Damage Charge Option A + Vendor Templates + Email Drafts | ✓ **closed 2026-05-27** |

## What's left to do — choose your track

### Operator-only (gates M6 live verification)

5 items in [`docs/m6-operator-cutover-checklist.md`](m6-operator-cutover-checklist.md). All code is sandbox-tested + shipped to production; live e2e of B5/B6/B7/B9 waits for these:

1. `wrangler secret put STRIPE_SECRET_KEY` with live key
2. `wrangler secret put STRIPE_WEBHOOK_SECRET` with live whsec
3. Configure live Stripe webhook endpoint in Stripe dashboard
4. Verify DMARC + SPF + DKIM DNS records
5. `$1` live e2e test (book → confirm saved PM on Customer → refund)

Claude can guide through each item but cannot execute them (they require Stripe dashboard auth, Cloudflare DNS auth, or a real credit card).

### Track A — Native Marketing milestone (PLANNED, not started)

The natural next milestone. See [`memory/project_marketing_milestone.md`](../../.claude/projects/C--Users-bulle-OneDrive-Desktop-Claude-Code-Projects-action-air-sports/memory/project_marketing_milestone.md):

```
B1 Segments → B2 Campaigns → B3 Composer UI → B4 Tracking → B5 Automations → B6 Closing
```

Per-batch operating rules same as M6 (plan-mode-first, 8-file target, mandatory closing summary).

### Track B — HR coordinator role_preset (~5 min)

Three SQL statements give a future HR person `staff.invite` capability without code changes:

```sql
INSERT INTO role_presets (key, name) VALUES ('hr_coordinator', 'HR Coordinator');

INSERT INTO role_preset_capabilities (role_preset_key, capability_key) VALUES
    ('hr_coordinator', 'staff.invite'),
    ('hr_coordinator', 'staff.read'),
    ('hr_coordinator', 'staff.write');

UPDATE users SET role_preset_key='hr_coordinator' WHERE email='<hr-person-email>';
```

Run on remote via `npx wrangler d1 execute air-action-sports-db --remote --command "..."`.

### Track C — Past-games / event archive page (phase 1, ~6 files)

Public archive page surfacing past events with external video/photo links (YouTube embeds + Drive shared links). No R2 plumbing in phase 1. Discussed but deferred during the M5.5 wrap; ready when operator wants it.

Files (~6):
- `src/pages/GameArchive.jsx` — public listing
- `src/pages/GameArchive.css`
- `src/App.jsx` — route registration
- `worker/routes/admin/eventArchive.js` — admin endpoint to flag past events for archive
- `src/admin/AdminEventArchive.jsx` — admin manage page
- Optional: `migrations/0059_events_archive_links.sql` if storing video/photo links per event

Phase 2 (R2 hosting + bulk admin upload) deferred.

### Track D — Post-M5.5 polish backlog (Fork A — 6 items)

From `docs/runbooks/m55-baseline-coverage.txt`:

1. AES decryption surface for `business_tax_id` (EIN) + `business_billing_address`
2. Admin POST `/api/admin/customers` + create modal (phone-intake operator workflow)
3. Monthly `day_of_month` recurrence pattern in field-rental cron
4. `/status` route clears `lead_stale_at` on transition
5. UNIQUE constraint on `(recurrence_id, recurrence_instance_index)` for stronger cron idempotency
6. AdminScan + AdminRoster `?event=` deep-link parsing (~10 lines per file)

### Track E — Live cutover assist

Walk the operator through items 1–5 above. Claude can:
- Compose exact `wrangler secret put` commands (operator pastes the secret values when prompted)
- Explain Stripe dashboard webhook config screen-by-screen
- Verify DNS records via `dig` / Cloudflare API once paths are confirmed
- Wait for the operator to run the `$1` e2e and report back

---

## Copy-paste prompt

```
I'm resuming work on the Air Action Sports booking system. M6 is closed
(2026-05-27); production is stable at `main = 84c2478`, worker version
`2ee51d5a`, tests 2292/184 passing.

Read these in order:

  1. docs/next-session.md (this file) — current state + available
     tracks to work on next.
  2. HANDOFF.md top-of-doc — production state + M6 PRs shipped +
     baseline + history.
  3. CLAUDE.md Milestone 6 section — what M6 delivered + the
     cumulative-state table + DNT considerations.
  4. memory/project_m6_milestone.md (auto-surfaces) — final M6
     status board + carry-forward observations.

If the operator wants to:
  - "Continue M6" → respond: M6 is closed. Live cutover items 1-5
                     in docs/m6-operator-cutover-checklist.md are
                     operator-only. Offer to guide through them.
  - "Start the next milestone" → propose Native Marketing
                     (memory/project_marketing_milestone.md).
  - "Add HR access" → run the 3 SQL statements (Track B above).
  - "Build the past-games page" → scope Track C (~6 files,
                     phase 1 only).
  - "Pick up polish items" → Track D from docs/runbooks/
                     m55-baseline-coverage.txt.
  - "Live Stripe cutover" → walk through Track E.
  - "Find a bug" → /feedback skill OR direct triage.

Operating rules in effect (durable across milestones):
  - Plan-mode-first per batch. Present plan, get ack, then edit.
  - 8-file operating target, 10-file hard ceiling.
  - Mandatory 5-bullet closing summary between batches.
  - Conventional Commits with milestone-aware scope (e.g.
    `marketing(b1)`, `polish(...)`, etc.).
  - No --force ever on shared branches.
  - Browser-verify in Claude_in_Chrome after each deploy — admin
    pages need javascript_tool, not screenshot (per memory
    `feedback_browser_verification.md`).
  - Pre-migration spot-check mandatory before any table-touching
    batch (Lesson #7).
  - Claude Code can run `wrangler d1 migrations apply --remote`
    for schema migrations (operator authorized 2026-05-25).
    Live Stripe secrets remain operator-only.
```

---

## Resume checklist (do these first in every fresh session)

```bash
git checkout main && git pull origin main
npm install
npm test -- --run | tail -5            # expect 2292/184
npm run lint 2>&1 | tail -3            # expect 0 errors
npm run build 2>&1 | tail -3           # expect clean
curl -s https://airactionsport.com/api/health   # expect {"ok":true,...}
```

If any of these fail, that's the first thing to triage — the milestone history docs may have drifted from reality and need a sync.

---

## Key reference docs for any post-M6 session

| Path | Purpose |
|---|---|
| `HANDOFF.md` | Canonical session-start handoff (skim top section) |
| `CLAUDE.md` | Project memory + operating rules + milestone history |
| `docs/decisions.md` | Decision register — citable resolutions for design choices |
| `docs/audit/06-do-not-touch.md` | DNT list (critical/high/medium tiers) |
| `scripts/test-gate-mapping.json` | Test-gate map — which tests lock each gated path |
| `docs/runbooks/m6-{baseline-coverage.txt, deploy.md, rollback.md}` | M6 close runbooks |
| `docs/m6-batch-tracker.md` | M6 status board (final state) |
| `docs/m6-operator-cutover-checklist.md` | Operator action items for live verification |
| `docs/m6-discovery/spot-check-log.md` | D1 schema captures + pre-flight log |

---

## What to capture in the NEXT next-session.md update

Whenever a new milestone closes or a substantial track lands:

1. Add a row to the "What's done" table above
2. Update the "Production state at last close" snapshot
3. Remove or adjust tracks in "What's left" that have shipped or become irrelevant
4. Update the copy-paste prompt's date / SHA / version references
5. Commit the update as part of the closing batch (per-batch doc cadence)
