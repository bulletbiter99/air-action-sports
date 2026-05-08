# M5 Rollback Runbook

When to roll back, what to roll back to, and how — for milestone 5.

## Decision tree

### Symptom: admin shell broken (login fails, /admin renders blank, etc.)

Most likely culprit: a frontend change in M5 (token swaps, new components, App.jsx route changes).

**Immediate action**: revert the most recent main merge.

```bash
git checkout main
git revert -m 1 <merge-sha-of-m5-close>
git push origin main
```

Workers Builds redeploys automatically. Admin shell returns to pre-M5 state. M5 D1 migrations stay applied (additive, no harm).

### Symptom: capability checks denying legitimate access

Most likely culprit: M5 B2 DB-backed capability replacement misconfigured for a user.

**Immediate action**: assign the user explicitly to the `owner` role preset (which holds all capabilities):

```sql
UPDATE users SET role_preset_key = 'owner' WHERE id = 'u_xxx';
```

If still broken: clear the role_preset_key (NULL falls back to legacy 5-cap mapping):

```sql
UPDATE users SET role_preset_key = NULL WHERE id = 'u_xxx';
```

The legacy fallback in `worker/lib/capabilities.js` matches M4 behavior verbatim.

### Symptom: portal magic link doesn't work

Most likely culprit: M5 B6a portal session implementation, or 0033 email template seed didn't apply.

**Diagnose**:
```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 execute air-action-sports-db --remote \
  --command="SELECT slug FROM email_templates WHERE slug = 'staff_portal_invite'"
```

If template missing: re-apply migration 0033.

If template present but link fails: check `portal_sessions` for the row. If `consumed_at` is set on a fresh link, the link is single-use (expected). Re-mint.

### Symptom: persons backfill produced wrong records

Most likely culprit: bug in `scripts/backfill-persons.js` or unexpected user data.

**Recovery**:
```sql
-- Inspect what was created
SELECT * FROM persons WHERE created_at > <m5_deploy_ms>;

-- If wholesale wrong:
DELETE FROM person_roles WHERE created_at > <m5_deploy_ms>;
DELETE FROM persons WHERE created_at > <m5_deploy_ms>;

-- Then re-run with corrected logic
node scripts/backfill-persons.js --remote
```

The script is idempotent: existing rows are detected by user_id and skipped on re-run.

## Per-batch revert references

| Batch | Branch | Merge SHA (record post-merge) | Hazard |
|---|---|---|---|
| 0-tokens | m5-batch-0-tokens | (record) | Low — additive tokens.css |
| 0-pages-1 | m5-batch-0-pages-1 | (record) | Low — token swap, semantic aliases |
| 0-pages-2 | m5-batch-0-pages-2 | (record) | Low |
| 0-sidebar | m5-batch-0-sidebar | (record) | Med — sidebar render path |
| 0a Surface 7 | m5-batch-0a-surface-7-docs | (record) | None — markdown only |
| 1 Staff schema | m5-batch-1-staff-foundation-schema | (record) | None — additive only |
| 2 Capabilities | m5-batch-2-capabilities-rbac | (record) | Med — capabilities.js replacement |
| 3 Persons backfill | m5-batch-3-persons-backfill | (record) | Med — runs against prod data |
| 4 Staff directory | m5-batch-4-staff-directory | (record) | Low — new pages |
| 5 Library + JD import | m5-batch-5-staff-library | (record) | Med — JD import is destructive on schema if 22 rows already exist |
| 6a Portal backend | m5-batch-6a-portal-backend | (record) | Low — new routes |
| 6b Portal frontend | m5-batch-6b-portal-frontend | (record) | Low — new pages |
| 7 Cron tests + cert schema | m5-batch-7-cron-and-certifications | (record) | None — tests + migration |
| 8 Certs UI + route | m5-batch-8-certifications-ui | (record) | Low |
| 9 Event staffing | m5-batch-9-event-staffing | (record) | Low — additive schema + route |
| 10 Labor log | m5-batch-10-labor-log | (record) | Low |
| 11 1099 thresholds | m5-batch-11-1099-thresholds | (record) | Low |
| 12 Event-day shell | m5-batch-12-event-day-shell | (record) | Low — kiosk separate from admin |
| 13-16 (combined) Event-day pages | m5-batch-13-checkin | (record) | Low — kiosk separate |
| 18 Closing | m5-batch-18-closing | (record) | None — docs |

## Schema rollback recipes

D1 migrations are forward-only by convention. To undo a schema change, write a NEW compensating migration (e.g., `0040_drop_certifications.sql`) — never delete or rename a previously-applied migration file.

Compensating migrations for M5:

```sql
-- Drop M5 tables (if needed; reverses all schema changes)
DROP TABLE IF EXISTS booking_charges;
DROP TABLE IF EXISTS charge_caps_config;
DROP TABLE IF EXISTS incidents;
DROP TABLE IF EXISTS incident_persons;
DROP TABLE IF EXISTS incident_attachments;
DROP TABLE IF EXISTS event_day_sessions;
DROP TABLE IF EXISTS labor_entries;
DROP TABLE IF EXISTS tax_year_locks;
DROP TABLE IF EXISTS event_staffing_reminders;
DROP TABLE IF EXISTS event_staffing;
DROP TABLE IF EXISTS role_required_certifications;
DROP TABLE IF EXISTS certifications;
DROP TABLE IF EXISTS portal_sessions;
DROP TABLE IF EXISTS person_documents;
DROP TABLE IF EXISTS staff_document_acknowledgments;
DROP TABLE IF EXISTS staff_document_roles;
DROP TABLE IF EXISTS staff_documents;
DROP TABLE IF EXISTS person_tags;
DROP TABLE IF EXISTS person_roles;
DROP TABLE IF EXISTS persons;
DROP TABLE IF EXISTS user_capability_overrides;
DROP TABLE IF EXISTS role_preset_capabilities;
DROP TABLE IF EXISTS role_presets;
DROP TABLE IF EXISTS capabilities;
DROP TABLE IF EXISTS roles;

-- D1 ALTER TABLE DROP COLUMN: SQLite 3.35+ supports it
ALTER TABLE users DROP COLUMN role_preset_key;

-- Drop the staff_portal_invite email template seed
DELETE FROM email_templates WHERE slug = 'staff_portal_invite';
```

This is a nuclear option — only run if the entire M5 stack needs unwinding (data loss for any persons / certifications / labor_entries / etc. created post-deploy).

## Recovery verification

After any rollback:
1. `curl https://airactionsport.com/api/health` → `{"ok":true}`
2. `npm test` (locally) → expected baseline passing
3. `/admin` UI loads cleanly
4. Owner can log in
5. Existing booking flow still works (unchanged in M5)
