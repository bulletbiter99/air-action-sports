# M6 rollback runbook

Operator reference for rolling back M6 changes if something goes wrong post-deploy. Pattern mirrors the M5.5 / M5 / M4 rollback runbooks.

**Last reviewed:** 2026-05-27 (B11 close)

---

## Decision tree

```
Issue surfaced after a M6 deploy?
│
├─ Is the issue with a SPECIFIC batch?
│  └─ Yes → revert that batch's merge commit (Level 1).
│     Migrations are additive; they stay. Worker reverts cleanly.
│
├─ Multiple batches misbehaving?
│  └─ Revert in REVERSE merge order (Level 2). Latest first.
│     Each revert is a separate merge commit on main.
│
├─ Stripe live-cutover regression?
│  └─ Operator: rotate keys back to sandbox via wrangler secret put.
│     Webhook endpoint can be disabled in Stripe dashboard (don't
│     delete — disable). B5/B6/B7/B9 code still works against sandbox.
│
├─ D1 schema corruption (e.g., 0058's UPDATE wiped booking_confirmation
│  body and you need the old version back)?
│  └─ Restore D1 from Cloudflare automated backup (24h granularity).
│     Operator-driven; cannot be Claude-Coded.
│
└─ Production worker entirely broken?
   └─ wrangler rollback to a known-good version via deployments list.
      Bypasses git entirely; gets you live in seconds.
```

---

## Level 1 — single-batch revert

```bash
git checkout main
git pull origin main

# Find the merge commit:
git log --oneline | grep "m6(b<N>)"

# Revert the merge (use -m 1 for the first-parent main):
git revert -m 1 <merge_sha>

# CI runs; once green, merge the revert PR.
gh pr create --base main --title "Revert m6(b<N>): <reason>" --body "..."
```

After Workers Builds redeploys (~30-60 sec), the worker is back to pre-batch behavior.

### What stays in place after a revert

- **Migrations**: every M6 migration is additive (column add / row insert / row update). Reverting the code does NOT roll back the migration. If you need to undo the migration, see Level 4 below.
- **Email template seeds** (0057, 0058): if the code that uses them is reverted but the templates remain, the templates just sit unused. Harmless.

### Per-batch revert hazards

| Batch | Hazard if reverted | Mitigation |
|---|---|---|
| B3 | `email_templates.status` column still exists; reverted code ignores it. Drafts created via B4 would now go live since the loadTemplate filter is gone. | Combine with B4 revert. Or: SQL UPDATE `email_templates SET status='published' WHERE status='draft'` first. |
| B4 | UI for status toggle gone but B3's `status` column + worker filter still active. New drafts can only be created via direct DB write. | Acceptable as a temporary measure. |
| B5 | New bookings stop receiving `setup_future_usage`. Existing bookings keep their saved PM (Stripe retains it on the Customer). B7/B9 still work against pre-revert bookings. | Acceptable if backout is brief. |
| B6 | New disputes silently no-op (back to pre-B6 behavior). Operator misses the alert email — must monitor Stripe dashboard directly. | Tolerable for a short window. |
| B7 | `POST /:id/charge-card` returns 404 — operator falls back to Approve (email link) or Mark paid (Venmo/cash). | No data loss. |
| B8 | "Charge card" button disappears from /admin/booking-charges. Endpoint from B7 still callable via curl. | Tolerable. |
| B9 | "Remove saved card" button + endpoint disappear. Existing saved PMs remain re-chargeable. | No data loss. |
| B10 | booking_confirmation body reverts to text WITHOUT "Heads-up" section. New email sends use the old copy. Past confirmations unaffected. | Pure cosmetic regression. |

---

## Level 2 — cascade revert

For multiple-batch issues, revert in REVERSE merge order. Each revert is its own PR + commit on main.

```
Revert B11 → CI → merge
Revert B9  → CI → merge
Revert B8  → CI → merge
Revert B7  → CI → merge
Revert B10 → CI → merge
Revert B6  → CI → merge
Revert B5  → CI → merge
Revert B4  → CI → merge
Revert B3  → CI → merge
Revert B2  → CI → merge
Revert B1  → CI → merge
Revert B0  → CI → merge
```

After each step, Workers Builds redeploys. You can stop at any depth.

**Faster alternative:** `wrangler rollback` to a pre-M6 worker version. Skips git entirely. Re-deploying from current `main` re-applies M6 immediately, so this is a "back out, look at logs, decide whether to re-deploy" pattern.

---

## Level 3 — wrangler rollback to a known-good version

```bash
source .claude/.env

# List versions:
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deployments list --name air-action-sports

# Pick a pre-M6 version (e.g. M5.5 close: see docs/runbooks/m55-baseline-coverage.txt)
# Then:
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler rollback --name air-action-sports <version-id>
```

This is the FASTEST recovery — under 30 seconds. The git tree is unchanged; re-running `wrangler deploy` brings M6 back.

---

## Level 4 — schema rollback (last resort)

Each M6 migration's inverse:

### 0056 — drop the status column

```sql
-- D1 quirks: SQLite supports DROP COLUMN since 3.35; D1 is 3.45+. Single ALTER works.
ALTER TABLE email_templates DROP COLUMN status;
```

Run via:
```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "ALTER TABLE email_templates DROP COLUMN status"
```

After dropping: B3+B4 code that references `status` will fail. Must combine with B3+B4 revert.

### 0057 — remove dispute_received template

```sql
DELETE FROM email_templates WHERE id = 'tpl_dispute_received';
```

Safe to run independently. B6 code returns `{skipped: 'template_missing'}` after this. Dispute events still get audit-logged but no admin email fires.

### 0058 — restore old booking_confirmation copy

This is the trickiest because the migration was an UPDATE on the existing row. No automatic undo. Options:

1. **Restore from D1 automated backup** (24h granularity) — operator-driven via Cloudflare dashboard.
2. **Manually edit the template via `/admin/settings/email-templates`** — paste the pre-0058 body_html + body_text. The pre-0058 content is captured in migration `0058_booking_confirmation_charges_notice.sql` git history (the diff shows the prior state).

---

## Stripe live-cutover rollback

If the operator did the live cutover and something breaks:

1. **Roll keys back to sandbox** via `wrangler secret put STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` with the old test keys.
2. **Disable the live webhook endpoint** in Stripe dashboard (don't delete — disable so it can be re-enabled later).
3. Customers paying during the window between cutover and rollback may have made real charges that need to be manually managed in the Stripe dashboard. Refund them as needed.

The B5+B6+B7+B9 code works against EITHER sandbox or live keys — no code change is required to roll back the cutover. The cutover is purely about which keys + endpoint the worker talks to.

---

## Pre-revert checklist

Before any revert:

- [ ] Capture the current production worker version (`wrangler deployments list`) so you can `wrangler rollback` back to it if the revert makes things worse.
- [ ] Capture the current main HEAD SHA so you have a reference point.
- [ ] If schema is involved: capture a D1 export of the affected table.
- [ ] Confirm the issue is actually from the batch you're reverting (look at the merge SHA in git log + the deploy version in Workers Builds).
- [ ] If unsure, prefer `wrangler rollback` over git revert — faster, reversible.

---

## Useful queries during incident

```bash
source .claude/.env

# Current production version
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deployments list --name air-action-sports | tail -8

# Are emails being sent? (Resend dashboard, not D1)
# Recent dispute audit rows
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT id, target_id, created_at FROM audit_log WHERE action='dispute.received' ORDER BY id DESC LIMIT 5"

# Recent off-session charges (B7)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT id, action, target_id, meta_json, created_at FROM audit_log WHERE action LIKE 'charge.off_session%' ORDER BY id DESC LIMIT 10"

# Recent PM detachments (B9)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT id, action, target_id, meta_json, created_at FROM audit_log WHERE action LIKE 'booking.saved_pm%' ORDER BY id DESC LIMIT 10"

# Worker logs (Cloudflare dashboard or wrangler tail)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler tail air-action-sports
```
