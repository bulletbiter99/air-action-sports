# M6 deploy runbook

Operator reference for the M6 milestone deploy sequence. Every batch was a separate PR → merge → auto-deploy via Workers Builds; this doc captures the order, the migrations applied, and the post-deploy verification steps.

**Milestone:** M6 — Stripe live flow + damage charge Option A + vendor templates + email drafts
**Closed:** 2026-05-27
**Final main HEAD:** see git log (`m6(b11): closing runbooks` merge commit)
**Final production worker:** see `npx wrangler deployments list --name air-action-sports | tail -8`

---

## Deploy sequence (cumulative)

| Batch | PR | Merge SHA | Deploy version | Migration | Notes |
|---|---|---|---|---|---|
| B0 | [#188](https://github.com/bulletbiter99/air-action-sports/pull/188) | `0206120` | post-B0 | — | Cutover runbook draft + spot-check scaffold + staff labeling polish |
| B0-followup | [#191](https://github.com/bulletbiter99/air-action-sports/pull/191) | `9da716a` | docs-only | — | Spot-check log populated; runbook column-name fix |
| B1 | [#189](https://github.com/bulletbiter99/air-action-sports/pull/189) | `f0cd431` | post-B1 | — | Vendor templates list/create/soft-delete |
| B2 | [#190](https://github.com/bulletbiter99/air-action-sports/pull/190) | `fd1e3ba` | `a6c147db` | — | Vendor templates composer + clone-to-event |
| B3 | [#193](https://github.com/bulletbiter99/air-action-sports/pull/193) | `65a6c83` | (with B4) | **0056** | email_templates.status column + loadTemplate filter |
| B4 | [#194](https://github.com/bulletbiter99/air-action-sports/pull/194) | `f3b845f` | `09c58ed1` | — | Admin UI: status toggle, filter chips, preview-with-real-data |
| B5 | [#195](https://github.com/bulletbiter99/air-action-sports/pull/195) | `8a9d3dd` | `ba6545c2` | — | Stripe `setup_future_usage: 'off_session'` |
| B6 | [#196](https://github.com/bulletbiter99/air-action-sports/pull/196) | `db7e7b8` | `518af64a` | **0057** | charge.dispute.created consumer + admin alert template |
| B10 | [#197](https://github.com/bulletbiter99/air-action-sports/pull/197) | `6e6ce25` | `954964c3` | **0058** | booking_confirmation "additional charges may apply" copy |
| B7 | [#198](https://github.com/bulletbiter99/air-action-sports/pull/198) | `<merge>` | (with B8) | — | Damage charge Option A — off-session capture |
| B8 | [#199](https://github.com/bulletbiter99/air-action-sports/pull/199) | `<merge>` | `c02d00fc` | — | Admin UI for "Charge card" + confirm modal + outcome banners |
| B9 | [#200](https://github.com/bulletbiter99/air-action-sports/pull/200) | `<merge>` | `e8372102` | — | Admin remove-saved-PM (privacy) |
| B11 | this PR | `<merge>` | `<deploy>` | — | Closing runbooks + decision register |

---

## D1 migrations applied during M6 (in order)

All applied to remote via:

```bash
source .claude/.env
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote
```

| Migration | Applied | What |
|---|---|---|
| `0056_email_templates_status.sql` | 2026-05-26 | `ALTER TABLE email_templates ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`. Existing 33 rows backfilled to `'published'`. |
| `0057_dispute_received_email_template.sql` | 2026-05-26 | `INSERT` seed for `tpl_dispute_received` template — admin alert for charge.dispute.created. |
| `0058_booking_confirmation_charges_notice.sql` | 2026-05-26 | `UPDATE` on the existing `booking_confirmation` template's body_html + body_text to add "Heads-up — Additional Charges May Apply" section. |

**No D1 quirks hit during M6.** All migrations additive or content-only; no table rebuilds.

---

## Pre-deploy verification (per batch)

Each batch's PR description includes a `Test plan` checklist hit before merge:

- [x] `npm test` — full suite passing (count grows per batch)
- [x] `npm run lint` — 0 errors
- [x] `npm run build` — clean
- [x] Group A (pricing 79) + Group B (webhook 59) regression — 138/138 preserved
- [x] Migration applied to remote D1 (if applicable) + verified rows
- [x] PR opened + CI green (Vitest + Visual regression + Workers Builds)

---

## Post-deploy verification

| Surface | Check | Notes |
|---|---|---|
| `/api/health` | Returns `{"ok":true}` | `curl https://airactionsport.com/api/health` |
| Workers Builds deploy version | New version listed in `wrangler deployments list` within ~60s of merge | Versions logged in tracker |
| Browser smoke (Claude_in_Chrome) | Navigate affected admin page; confirm new UI renders | Admin pages: use `javascript_tool` because `useWidgetData` cadence prevents `document_idle` |

### Batch-specific post-deploy checks

**B3/B4** — Email template draft state
- `/admin/settings/email-templates` shows: filter chips (All / Published / Drafts) with counts, Status column with badges
- Editor modal has Status toggle (Published/Draft); booking-flavored templates have "Preview with real data" section
- Real `bk_XXX` ID renders the real booking's data in the iframe

**B5** — `setup_future_usage`
- `/booking` page still loads + checkout flow unchanged
- Stripe sandbox booking → sandbox Customer auto-created with saved PM
- Live verification: pending operator cutover items 1–5

**B6** — Dispute webhook
- Sandbox: `stripe trigger charge.dispute.created --override 'dispute:payment_intent=<pi>'` against a sandbox booking PI
- D1: `SELECT * FROM audit_log WHERE action='dispute.received' ORDER BY id DESC LIMIT 1`
- Inbox: admin alert email arrives
- Live verification: first real disputed payment

**B7/B8** — Damage charge Option A
- `/admin/booking-charges` shows the new "Charge card" button (success-green) on pending/sent rows
- Confirm modal opens with customer / reason / amount summary
- Sandbox booking with damage charge → click "Charge card" → success banner shows amount + new PI id
- Live verification: pending operator cutover

**B9** — Remove saved PM
- `/admin/bookings/:id` (owner only) shows "Privacy controls" subsection on bookings with real Stripe intent
- "Remove saved card" button opens confirm modal
- Click "Remove saved card" → Stripe detach → audit row written
- Live verification: pending operator cutover

**B10** — booking_confirmation copy
- Admin email-template preview shows the new "Heads-up" section
- Real customer's next booking email includes the new copy

---

## Rollback decision tree

See [`docs/runbooks/m6-rollback.md`](m6-rollback.md). Short version:

| Severity | Action |
|---|---|
| Single batch broken | Revert the batch's merge commit (`git revert -m 1 <merge_sha>`). Migrations stay applied — they're additive. |
| Multiple batches broken | Cascade-revert in reverse merge order. |
| Migration data corruption | Restore D1 from Cloudflare automated backup (24h granularity). Operator-driven only. |

---

## Operator-only cutover items (gates B5/B6/B7/B9 live verification)

5 items in [`docs/m6-operator-cutover-checklist.md`](../m6-operator-cutover-checklist.md):

1. `wrangler secret put STRIPE_SECRET_KEY` with live key
2. `wrangler secret put STRIPE_WEBHOOK_SECRET` with live whsec
3. Configure live Stripe webhook endpoint
4. Verify DMARC + SPF + DKIM DNS records
5. `$1` live e2e test

Until items 1–5 complete, production runs B5+B6+B7+B9 code against Stripe **sandbox** keys. All payment-flow behavior works sandbox-side; live verification is the final gate.

---

## Useful commands

```bash
# Check latest deploy
source .claude/.env
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deployments list --name air-action-sports | tail -10

# Confirm production health
curl -s https://airactionsport.com/api/health

# Check D1 schema (post-migration)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT sql FROM sqlite_master WHERE tbl_name='email_templates' AND type='table'"

# Count templates by status
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT status, COUNT(*) FROM email_templates GROUP BY status"

# Recent disputes audit (post-B6)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT id, target_id, meta_json, created_at FROM audit_log WHERE action='dispute.received' ORDER BY id DESC LIMIT 10"

# Recent off-session charges (post-B7)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT id, target_id, meta_json, created_at FROM audit_log WHERE action IN ('charge.off_session_succeeded', 'charge.off_session_failed') ORDER BY id DESC LIMIT 10"

# Recent PM detachments (post-B9)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command "SELECT id, target_id, meta_json, created_at FROM audit_log WHERE action IN ('booking.saved_pm_detached', 'booking.saved_pm_detach_noop') ORDER BY id DESC LIMIT 10"
```
