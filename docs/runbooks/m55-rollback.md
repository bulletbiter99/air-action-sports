# M5.5 rollback runbook

**Milestone:** Field Rentals
**Scope:** decision tree for partial / full rollback of M5.5, including per-batch revert procedures.

The M5.5 deploy was incremental — batches B1 through B11 rolled into milestone individually, with mid-milestone main merges. This rollback runbook honors that structure: most issues can be recovered by reverting one batch's squash commit on main, leaving the others in place.

---

## Decision tree

### Level 1 — Hot rollback (within minutes of deploy)

**Trigger:** a user-visible regression on the public site (e.g. /contact form is broken; admin pages 500).

**Action:** revert the most recent merge commit on `main` via the GitHub UI (PR → "Revert"). Push triggers Workers Builds redeploy automatically. Time-to-live: ~2 minutes.

If multiple recent merges may be implicated, revert each in reverse order until the regression clears.

```bash
# Manual local-shell version
git checkout main
git pull origin main
git revert -m 1 <merge-sha>  # e.g. final M5.5-close merge
git push origin main
```

### Level 2 — Per-batch revert (within hours)

**Trigger:** isolated functional defect in one batch's code that didn't break health-check / smoke gates but is misbehaving (e.g. cron crashes nightly with no data effect; admin page renders blank).

**Action:** revert the specific batch's squash commit. Each M5.5 batch has a single squash SHA on main (or on milestone) — see the per-batch table below.

### Level 3 — Schema rollback (within hours / days)

**Trigger:** a migration causes incorrect data + the dataset is significant.

**Action:** apply the inverse migration. M5.5 schema migrations are all additive (no destructive table-rebuild) except 0050 which uses the column-rename pattern. See per-migration rollback recipes below.

### Level 4 — Full milestone rollback (within days)

**Trigger:** widespread compounding issues with no clear single source.

**Action:** revert the final milestone-to-main merge commit, then apply inverse migrations 0053 → 0044 in reverse order. Coordinate with the operator since this is invasive.

---

## Per-batch revert SHAs + hazards

Squash SHAs on `milestone/5.5-field-rentals` (look them up via `git log --first-parent origin/milestone/5.5-field-rentals` for the merge commits, or `git log --oneline | grep m55-batch` for the squashed feature SHAs).

| Batch | Squash SHA (milestone) | PR | What reverting undoes | Hazard |
|---|---|---|---|---|
| B1 | `cd501e8` | [#145](https://github.com/bulletbiter99/air-action-sports/pull/145) | sites schema migration 0044 + inquiry-form audit doc | Revert leaves AdminSites + field_rentals references hanging. **Don't revert in isolation** — revert B2 through B11 first (or do full milestone rollback). |
| B2 | `c20bb1b` (+ `52fb5bf` hotfix) | [#146](https://github.com/bulletbiter99/air-action-sports/pull/146), [#147](https://github.com/bulletbiter99/air-action-sports/pull/147) | events.site_id migration 0045 + seed-sites + backfill scripts + D1 quirk #4 doc | `events.site_id` column drops; conflict-detection lib will treat missing site_id as no conflict (degraded, not broken). Safe partial revert. |
| B3 | `a61b66c` | [#148](https://github.com/bulletbiter99/air-action-sports/pull/148) | customers business_* extension migration 0046 + conflict-detection lib | AdminEvents conflict banner stops surfacing event-vs-event conflicts. Migration 0050 (B9) referenced these columns — revert B9 first if B3 needs to come out. |
| B4 | `890f4d8` | [#149](https://github.com/bulletbiter99/air-action-sports/pull/149) | field_rentals + recurrences + contacts schema (migration 0047) | **Heavy revert** — drops the workhorse table. B5-B11 all depend on this. Revert B5-B11 first or do full milestone rollback. |
| B5 | `575d42b` | [#150](https://github.com/bulletbiter99/air-action-sports/pull/150) | documents + payments + SUA schema (migration 0048) | B7b routes consume these. Revert B7b first or do full revert. |
| B6 | `efbe243` | [#151](https://github.com/bulletbiter99/air-action-sports/pull/151) | capabilities seed + site_coordinator role_preset (migration 0049) | Existing users with site_coordinator role lose role_preset binding. Defaulted to legacy fallback (owner-tier UI surface). Low blast radius. |
| B6.5 | `f1aff32` | [#152](https://github.com/bulletbiter99/air-action-sports/pull/152) | AdminSites CRUD UI (frontend + worker route) | /admin/sites route 404s; sidebar entry stays (bug — file a follow-up). B2-B4 sites data remains in DB unchanged. |
| B7a | `5b828b2` | [#155](https://github.com/bulletbiter99/air-action-sports/pull/155) | admin field-rentals route + lib + eventConflicts excludeFieldRentalId | AdminFieldRentals.jsx fails its API calls. B7b/B8 depend on B7a. Revert B7b + B8 first. |
| B7b | `47b5735` | [#156](https://github.com/bulletbiter99/air-action-sports/pull/156) | documents + payments routes + gate map | Detail page document/payment modals fail. Test gate map loses 4 entries. |
| B8 | `50b90b7` | [#157](https://github.com/bulletbiter99/air-action-sports/pull/157) | field-rentals frontend (list/detail/new + sidebar entry + /me capabilities surface) | Frontend pages 404. Backend routes still available via direct curl. AdminFieldRentalNew step-1 hint references customers page (B9 doesn't add a create UI either). |
| B9 | `0d75c9a` | [#158](https://github.com/bulletbiter99/air-action-sports/pull/158) | client_type NOT NULL migration 0050 + customer detail FR section + formatCustomer business fields | Booking-flow auto-create still works (DEFAULT 'individual' on column). Inverse migration NOT trivial — see schema rollback below. |
| B10a | `1493d66` | [#159](https://github.com/bulletbiter99/air-action-sports/pull/159) | recurrence cron + lead_stale_at column + business cap binding | Recurrence sweep stops running. 03:00 UTC summary log drops `recurrenceGen` key. With 0 active recurrences today, no data lost. |
| B10b | `8cf1364` | [#160](https://github.com/bulletbiter99/air-action-sports/pull/160) | COI + lead-stale crons + 4 email templates + 2 senders | COI / lead-stale alerts stop firing. Sentinel columns from B4/B10a remain (no data loss). |
| B11 | (this PR) | TBD | /api/inquiry route + Contact.jsx update + inquiry email template + closing runbooks | /contact form falls back to broken state (no submission). Operator can email replacement banner. Customer + lead INSERTs from prior submissions remain in DB. |

---

## Per-migration schema rollback recipes

Apply against remote D1 via `wrangler d1 execute --remote --command=...`.

### Migration 0053 (B11 — inquiry_notification template)

```sql
DELETE FROM email_templates WHERE slug = 'inquiry_notification';
```

### Migration 0052 (B10b — cron email templates)

```sql
DELETE FROM email_templates
  WHERE slug IN ('coi_alert_60d', 'coi_alert_30d', 'coi_alert_7d', 'field_rental_lead_stale');
```

### Migration 0051 (B10a — sentinel column + business cap binding)

```sql
-- Remove the site_coordinator binding
DELETE FROM role_preset_capabilities
  WHERE role_preset_key = 'site_coordinator'
    AND capability_key = 'customers.read.business_fields';

-- Drop the lead_stale_at column. SQLite ALTER TABLE DROP COLUMN works in
-- D1 (SQLite 3.45+). Indexes referencing the column auto-drop.
ALTER TABLE field_rentals DROP COLUMN lead_stale_at;
```

### Migration 0050 (B9 — client_type NOT NULL)

This used the column-rename pattern. To rollback, reverse the pattern:

```sql
-- New nullable column to receive the data
ALTER TABLE customers ADD COLUMN client_type_old TEXT
  CHECK (client_type_old IS NULL OR client_type_old IN ('individual', 'business'));

-- Copy values across
UPDATE customers SET client_type_old = client_type;

-- Drop the NOT NULL column
DROP INDEX IF EXISTS idx_customers_client_type;
ALTER TABLE customers DROP COLUMN client_type;
ALTER TABLE customers RENAME COLUMN client_type_old TO client_type;
CREATE INDEX idx_customers_client_type ON customers(client_type);
```

### Migration 0049 (B6 — capabilities seed + site_coordinator role)

```sql
-- Delete the 45 role_preset_capabilities bindings + 17 capabilities + role_preset
DELETE FROM role_preset_capabilities WHERE role_preset_key = 'site_coordinator';
DELETE FROM role_preset_capabilities WHERE capability_key IN (
  'events.override_conflict','field_rentals.send_quote','field_rentals.send_contract',
  'field_rentals.email','field_rentals.export','field_rentals.archive',
  'field_rentals.deposit_record','field_rentals.balance_record',
  'field_rentals.recurrence_create','field_rentals.recurrence_modify','field_rentals.recurrence_end',
  'field_rentals.documents.read','field_rentals.documents.upload','field_rentals.coi.read_pii',
  'field_rentals.notes.read_sensitive','field_rentals.notes.write_sensitive',
  'sites.blackout_create'
);
DELETE FROM capabilities WHERE key IN (
  'events.override_conflict','field_rentals.send_quote','field_rentals.send_contract',
  'field_rentals.email','field_rentals.export','field_rentals.archive',
  'field_rentals.deposit_record','field_rentals.balance_record',
  'field_rentals.recurrence_create','field_rentals.recurrence_modify','field_rentals.recurrence_end',
  'field_rentals.documents.read','field_rentals.documents.upload','field_rentals.coi.read_pii',
  'field_rentals.notes.read_sensitive','field_rentals.notes.write_sensitive',
  'sites.blackout_create'
);
DELETE FROM role_presets WHERE key = 'site_coordinator';
```

### Migration 0048 (B5 — documents/payments/SUA schema)

```sql
DROP TABLE field_rental_payments;
DROP TABLE field_rental_documents;
DROP TABLE site_use_agreement_documents;
```

### Migration 0047 (B4 — field_rentals core schema)

```sql
-- Order matters: dependent tables first
DROP TABLE field_rental_contacts;
DROP TABLE field_rentals;
DROP TABLE field_rental_recurrences;
DROP TABLE customer_contacts;
```

### Migration 0046 (B3 — customers business extension)

```sql
DROP INDEX IF EXISTS idx_customers_client_type;
ALTER TABLE customers DROP COLUMN client_type;
ALTER TABLE customers DROP COLUMN business_name;
ALTER TABLE customers DROP COLUMN business_tax_id;
ALTER TABLE customers DROP COLUMN business_billing_address;
ALTER TABLE customers DROP COLUMN business_website;
```

### Migration 0045 (B2 — events.site_id)

```sql
DROP INDEX IF EXISTS idx_events_site_id;
ALTER TABLE events DROP COLUMN site_id;
```

### Migration 0044 (B1 — sites schema)

```sql
-- Drop dependent FK first if a future migration referenced sites.id
DROP TABLE site_blackouts;
DROP TABLE site_fields;
DROP TABLE sites;
```

---

## Recovery scenarios

### Scenario A — operator notices /contact submissions stop arriving in their inbox

**Diagnosis:** template missing OR `ADMIN_NOTIFY_EMAIL` env unset OR Resend API key rotated.

**Steps:**
1. Check `audit_log` for `inquiry.email_failed` rows in the last 24h.
2. Inspect the `meta_json` field — reason will be `template_missing` / `no_admin_email` / `send_failed`.
3. If `template_missing`: re-apply migration 0053.
4. If `no_admin_email`: verify `wrangler.toml` `[vars] ADMIN_NOTIFY_EMAIL` is set, redeploy.
5. If `send_failed`: check Resend dashboard for API key validity + DKIM/SPF status.

**No data is lost** — the inquiry submission itself (audit + customer + lead) still completes; only the operator notification fails.

### Scenario B — cron runs every night but no COI/lead-stale alerts fire when expected

**Diagnosis:** sentinel columns may not have been reset OR template missing OR no qualifying rentals.

**Steps:**
1. Inspect 03:00 UTC summary log (Cloudflare → Workers → air-action-sports → Logs).
2. Check `coiAlerts: { sent60: N, sent30: N, sent7: N, failed: N }` and `leadStale: { alerted: N, ... }` values.
3. If `failed > 0`: check `audit_log` for `field_rental.coi_alert_template_missing` / `field_rental.coi_alert_no_recipient`.
4. If all zero but you expected alerts: verify the data — `SELECT id, coi_status, coi_expires_at, coi_alert_60d_sent_at FROM field_rentals WHERE coi_status='received'` to confirm a candidate exists.

### Scenario C — recurrence cron generates duplicate rentals

**Diagnosis:** the SELECT-then-INSERT idempotency check has a race window if the cron is somehow invoked twice in parallel. With CF's single-region scheduled() handler this shouldn't happen, but if it does:

**Steps:**
1. Identify duplicates: `SELECT recurrence_id, recurrence_instance_index, COUNT(*) FROM field_rentals GROUP BY recurrence_id, recurrence_instance_index HAVING COUNT(*) > 1`.
2. Manually delete the newer duplicate (higher `created_at`).
3. Re-run sweep — won't recreate because the older row's instance_index is still claimed.

**Long-term fix:** add a UNIQUE constraint on `(recurrence_id, recurrence_instance_index)`. Deferred — would require column-rename pattern.

### Scenario D — public /contact form spammed by bots that defeat the honeypot

**Diagnosis:** honeypot is cheap — assume real spam will eventually try.

**Steps:**
1. Inspect `audit_log` for `inquiry.submitted` rows clustering by IP.
2. If clear pattern: tighten `RL_FEEDBACK` limits in wrangler.toml (default is generous for public forms).
3. Mid-term: add Cloudflare Turnstile (free CAPTCHA) to the /contact form. Out of M5.5 scope.

---

## Smoke tests after any rollback

Whatever rollback level you ran, verify these green before declaring resolved:

```bash
# Health check
curl https://airactionsport.com/api/health
# expected: {"ok":true,...}

# Public booking page still loads
curl -s -o /dev/null -w "%{http_code}" https://airactionsport.com/events/operation-nightfall
# expected: 200

# Admin login still works (manual: hit /admin/login, log in, land on /admin)
```

If any of these fail, escalate to L4 (full milestone rollback). Production data is safe — D1 + R2 + DBs retain content; only behavior changes per rollback level.
