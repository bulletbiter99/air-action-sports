# M7 Deploy Runbook

M7 (Reports + Audit-Log FTS + Virtualized Tables + Resend deliverability + admin visual baselines)
**closed + deployed 2026-05-31**. `milestone/7-reports-search-virtualized` → `main` via PR; Cloudflare
Workers Builds auto-deploys on push to `main`.

## What shipped (Batches 0–11b)
- **Reports** — 17 reports across 4 personas (Owner / Bookkeeper / Marketing / Site Coordinator) at
  `/admin/reports`, capability-gated, CSV export, **custom date range** (11a). Shared client query
  layer `src/admin/reports/reportData.js`.
- **Audit-log full-text search** (FTS5) — flag-gated (`audit_log_fts`) with a LIKE fallback.
- **Virtualized admin tables** (TanStack Virtual) on Roster / Events / PromoCodes / RentalAssignments,
  with **sticky, scrollbar-aligned headers** (11b) via the shared `VirtualizedList`.
- **Resend bounce/complaint consumer** — signed `POST /api/webhooks/resend`: records `email_events`,
  auto-suppresses `customers.email_marketing` on hard bounce / complaint, sends admin alert emails.
- **Admin visual-regression baselines** — local-serve + Playwright route-mock harness; 6 surfaces; a
  `visual-admin` CI job (linux baselines).

## Deploy sequence (2026-05-31)
1. Batches 0–11b merged to milestone (PRs #212–#228).
2. **Batch 12** (this) — closing runbooks + doc flips merged to milestone.
3. **milestone → main** PR merged → Workers Builds deploy.
4. Verify: `curl https://airactionsport.com/api/health` → `{"ok":true,...}`.

## Deploy safety
Migrations **0062–0064 were applied to remote BEFORE deploy** (reports caps + FTS index + flag), so
Reports + FTS work immediately (FTS via LIKE fallback until the flag is flipped). **0065/0066 are NOT
applied, which is safe:** the only code paths that touch `email_events` / the alert templates are
behind `POST /api/webhooks/resend`, which returns **500 until `RESEND_WEBHOOK_SECRET` is set**. So the
new deliverability features are inert until the operator completes the steps below. **No Critical-DNT
surface changed** — the `/stripe` webhook handler, `verifyWebhookSignature`, pricing, bookings/checkout,
waivers, and auth are byte-untouched — so existing production behavior is unchanged.

## OPERATOR-PENDING (post-deploy, to activate the deferred features)
1. **Apply migrations 0065 + 0066 to remote:**
   ```bash
   source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
     npx wrangler d1 migrations apply air-action-sports-db --remote
   ```
2. **Resend webhooks** (activates the bounce/complaint consumer + alert emails):
   - `wrangler secret put RESEND_WEBHOOK_SECRET` — value = the signing secret from the Resend webhook.
   - In the Resend dashboard, add a webhook → `https://airactionsport.com/api/webhooks/resend`,
     subscribe to `email.bounced` + `email.complained`.
3. **Enable FTS audit search** (until then, the LIKE fallback is used):
   ```sql
   UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000 WHERE key='audit_log_fts';
   ```
4. **Eyeball (no automated coverage):**
   - the 4 virtualized lists' sticky headers — `/admin/events`, `/admin/roster?event=…`,
     `/admin/promo-codes`, `/admin/rentals/assignments` (columns aligned, header pinned, no jump).
   - the Reports custom date range — `/admin/reports` → Period → **Custom range** → From/To.

## Carried from M6 (still pending)
Live-Stripe cutover items 1–5 — [docs/m6-operator-cutover-checklist.md](../m6-operator-cutover-checklist.md).
