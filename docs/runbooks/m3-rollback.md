# M3 rollback runbook

Rollback recipes for Milestone 3, ordered from cheapest (no redeploy needed) to most invasive. Mirrors the structure of `m2-rollback.md` but reflects M3's introduction of feature-flag-gated UI surfaces and customer-data migrations.

## Decision tree

| Symptom | Action |
|---|---|
| Customers UI looks wrong / breaking | Flip `customers_entity` flag to `off` (instant; no redeploy). |
| Persona dashboard looks wrong / breaking | Flip `new_admin_dashboard` flag to `off` (instant; no redeploy). |
| Tag cron writing nonsense tags | Stop the cron in wrangler dashboard OR delete the offending tags via SQL. |
| GDPR delete misfired on a real customer | Read recovery section below — the audit trail makes recovery possible but manual. |
| Customer data corrupt (rare) | Restore from D1 PITR (Cloudflare offers point-in-time recovery on Time Travel-enabled DBs). |
| Need to fully undo a B-batch | `git revert` the batch's squash commit on main, then redeploy. |

---

## Level 0 — Instant flag flip (zero redeploy)

Most M3 features are gated by feature flags. Flipping `state='off'` is the cheapest rollback:

```bash
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 execute air-action-sports-db --remote \
    --command="UPDATE feature_flags SET state='off' WHERE key='customers_entity'"

# OR for the persona dashboard:
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 execute air-action-sports-db --remote \
    --command="UPDATE feature_flags SET state='off' WHERE key='new_admin_dashboard'"
```

Effect: hidden client-side immediately on next page load. The backend routes still work (auth still required) — useful for ops triage even when end-users can't see the UI.

## Level 1 — Stop the nightly tag cron

If `runCustomerTagsSweep` is writing bad tags or pegging D1 capacity:

1. Cloudflare dashboard → Workers & Pages → air-action-sports → Triggers → Cron Triggers → temporarily remove `0 3 * * *`. The 15-min reminder cron is unaffected.
2. Or: edit `wrangler.toml` `[triggers]` to remove the schedule, deploy.
3. Or: clear all bad system tags via SQL — `DELETE FROM customer_tags WHERE tag_type='system'`. The next sweep will recompute.

The 15-min reminder cron is a separate `*/15 * * * *` schedule and is unaffected by removing the tag-refresh schedule.

## Level 2 — Revert a single B-batch

Each batch is a single squash commit on `main` (rolling brings-up). To revert:

```bash
git revert <batch-squash-sha> -m 1   # if it was a merge commit
# OR
git revert <batch-squash-sha>        # if it's a regular squash commit
```

The per-batch SHAs:
- B0: `3afbb4c` (lint config) — DON'T revert; CI depends on it
- B1: `aee3791` (local D1 setup) — safe to revert (operator scripts only)
- B2: `0cfd436` (customerEmail.js) — depends on backfill in B4; revert order matters
- B3: `0e06b85` (customers schema migration) — see "schema rollback" below
- B4: `a3bfcc5` (backfill script) — safe to revert (operator-runnable script)
- B5: `a4870f6` (dual-write code) — depends on schema; revert with caution
- B6: `4c2e87f` (NOT NULL migration) — see "schema rollback"
- B7: `b4bece9` (auth tests) — purely additive, always safe to revert
- B8a: `765f792` (customers route + 0024 flag)
- B8b: `203e640` (customers UI)
- B9: `d3891c5` (persona dashboard)
- B10: `1afb594` (tag cron)
- B11: `c7e5d33` (GDPR delete) — see "GDPR-specific" below
- B12: closing batch (this PR)

For UI/route batches (B8a, B8b, B9), the recommended rollback is **flag flip first**, **revert second**.

## Level 3 — Schema rollback

Migrations 0022 (customers schema) and 0023 (NOT NULL on customer_id) are both forward-only. Reversing them requires:

### 0023 → revert to nullable customer_id

Same column-rename pattern as 0023 itself, but renaming customer_id_old → customer_id and dropping NOT NULL:

```sql
-- Revert bookings.customer_id NOT NULL → nullable
ALTER TABLE bookings ADD COLUMN customer_id_revert TEXT REFERENCES customers(id);
UPDATE bookings SET customer_id_revert = customer_id;
ALTER TABLE bookings DROP COLUMN customer_id;
ALTER TABLE bookings RENAME COLUMN customer_id_revert TO customer_id;
DROP INDEX IF EXISTS idx_bookings_customer;
CREATE INDEX idx_bookings_customer ON bookings(customer_id);

-- Same for attendees
ALTER TABLE attendees ADD COLUMN customer_id_revert TEXT REFERENCES customers(id);
UPDATE attendees SET customer_id_revert = customer_id;
ALTER TABLE attendees DROP COLUMN customer_id;
ALTER TABLE attendees RENAME COLUMN customer_id_revert TO customer_id;
DROP INDEX IF EXISTS idx_attendees_customer;
CREATE INDEX idx_attendees_customer ON attendees(customer_id);
```

Skip the comment trigger words (`BEGIN`, `COMMIT`, `TRANSACTION`) per the wrangler parser quirk noted in `m3-deploy.md`.

### 0022 → drop customers infrastructure

Only do this if absolutely necessary — the backfilled customer rows + booking links would be lost. Far easier to leave the schema in place and just stop using it.

```sql
ALTER TABLE bookings DROP COLUMN customer_id;     -- post-0023-revert
ALTER TABLE attendees DROP COLUMN customer_id;    -- post-0023-revert
DROP TABLE IF EXISTS customer_tags;
DROP TABLE IF EXISTS gdpr_deletions;
DROP TABLE IF EXISTS segments;
DROP TABLE IF EXISTS customers;
-- Then revert d1_migrations table to mark 0022/0023/0024/0025 as un-applied
```

### Schema-rollback verification

Always run after schema rollback:

```bash
npx wrangler d1 execute air-action-sports-db --remote --json --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler d1 execute air-action-sports-db --remote --json --command="SELECT key, state FROM feature_flags ORDER BY key"
```

## Level 4 — Customer data corruption / GDPR delete misfire

If a `POST /:id/gdpr-delete` ran on the wrong customer:

1. The personal fields are gone (email, name, phone, notes nulled out). The audit trail is in `gdpr_deletions` (id, customer_id, requested_via, reason, deleted_by, deleted_at).
2. Bookings + attendees are still linked to the now-anonymized customer (NOT NULL on customer_id).
3. Recovery requires manually re-populating the customer row from external sources:
   - Booking confirmation emails (Resend dashboard) usually have the buyer's email + name.
   - Stripe customer records (if the booking went through Stripe) carry the original email.
4. Re-populate via SQL:
   ```sql
   UPDATE customers
      SET email = '<recovered>',
          email_normalized = '<recovered-normalized>',
          name = '<recovered>',
          phone = '<recovered or NULL>',
          archived_at = NULL,
          archived_reason = NULL,
          archived_by = NULL,
          updated_at = strftime('%s','now') * 1000
    WHERE id = '<cus_id>';
   ```
5. Optionally delete the spurious `gdpr_deletions` row (or leave it — it's defensive history of the mis-fire).

If multiple bookings have NULL customer_id orphans (impossible post-B6 but theoretically possible during a partial migration window), restore them via the backfill script which is idempotent.

## Level 5 — Full M3 revert

Don't. The 12 batches are heavily entangled (B5 depends on B3, B6 depends on B5, the UI batches all depend on B5+B8a, etc.) and the customer-data backfill is a one-way door without a fresh D1 PITR snapshot. Use Level 0 (flag flips) + Level 2 (per-batch reverts) instead.

---

## Pre-rollback checklist

1. Confirm exactly which batch / feature is misbehaving — don't over-rollback.
2. Capture current state for forensics:
   ```bash
   curl https://airactionsport.com/api/admin/customers/summary  # if endpoint exists
   npx wrangler d1 execute air-action-sports-db --remote --json --command="SELECT COUNT(*) FROM customers"
   ```
3. Pick the lowest level that addresses the symptom.
4. After rollback: re-run `npm test` against milestone tip; deploy any test-only changes that captured the regression.

## Post-rollback

- Update `docs/decisions.md` with the rollback rationale + symptom.
- File a Linear / TODO for re-shipping with the bug fixed.
- If a flag was flipped off mid-rollout, leave it off until the underlying bug is verified fixed in CI.
