# M7 Rollback Runbook

M7 deployed to `main` 2026-05-31. Decision tree, least → most invasive. M7 touched **no Critical-DNT
surface destructively** (the `/stripe` webhook, `verifyWebhookSignature`, pricing, bookings/checkout,
waivers, auth are byte-untouched), so the blast radius of a bad M7 deploy is the **new admin
Reports/FTS/virtualization UI** plus the **Resend route (inert without its secret)**. A full M7 revert
is low-risk.

## Level 0 — flag / secret (no code change, instant)
- **FTS search misbehaving** → the flag is `off` by default (LIKE fallback). If it was flipped on and
  is problematic: `UPDATE feature_flags SET state='off' WHERE key='audit_log_fts';`
- **Resend consumer misbehaving** → `wrangler secret delete RESEND_WEBHOOK_SECRET` → `/resend` returns
  500, the consumer is inert. Existing production is unaffected.

## Level 1 — revert one batch on main
Each batch is a merge commit on main (after the milestone→main merge). To revert just one (e.g. 11b
sticky headers if the populated lists render wrong):
```bash
git checkout main && git pull
git revert -m 1 <batch-merge-commit>      # find via: git log --oneline --first-parent main
# → branch → PR → main → Workers Builds redeploys
```
Representative milestone SHAs (confirm on main after the M7 merge): 11b `e50a748`, 11a `e66ab50`,
10 `613a236`, 8 (resend) the #223 merge, 7 (virtualized) `ba1d8ef`.

## Level 2 — revert the whole M7 merge on main
```bash
git revert -m 1 <milestone→main merge commit>   # → PR → main → redeploys pre-M7
```
Schema note: migrations 0062–0064 stay applied — they're additive (reports caps, an FTS5 mirror table
+ triggers, one `feature_flags` row) and harmless to pre-M7 code (simply unused). 0065/0066 only matter
if they were applied.

## Schema rollback (only if truly necessary)
- **0062 reports caps:** `DELETE FROM role_preset_capabilities WHERE capability_key LIKE 'reports.%';`
  then `DELETE FROM capabilities WHERE key LIKE 'reports.%';`
- **0063/0064 FTS:** `DROP TABLE audit_log_fts;` + drop its 3 triggers; `DELETE FROM feature_flags WHERE key='audit_log_fts';`
- **0065 email_events:** `DROP TABLE email_events;` (only if applied)
- **0066 templates:** `DELETE FROM email_templates WHERE slug IN ('bounce_alert','complaint_alert');` (only if applied)
- D1 has 24-hour automated backups at Cloudflare for a point-in-time restore if needed.

## Most likely real-world scenario
The unverified surface is 11b's sticky headers on the 4 populated admin list pages. If the operator's
eyeball finds a CSS issue, prefer a **forward hotfix** to `src/admin/VirtualizedList.jsx` (adjust the
sticky `background` token / `z-index` / `scrollbar-gutter`) over a revert — the change is isolated to
one shared component.
