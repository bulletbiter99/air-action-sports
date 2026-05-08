# M5 Deploy Runbook

Closing-state deploy sequence for milestone 5 (staff management + event-day mode).

## Prerequisites

- Cloudflare API token in `.claude/.env`
- `wrangler` available (`npx wrangler --version` works)
- D1 database ID matches what's in wrangler.toml
- Operator approval (per Phase 4 acknowledgment) for remote D1 mutations

## Sequence

### 1. Confirm M5 milestone branch is up to date with main

```bash
git checkout milestone/5-staff-event-day
git pull origin milestone/5-staff-event-day
git merge --no-ff main  # if any main changes need pulling in
git push origin milestone/5-staff-event-day
```

### 2. Apply the 9 M5 migrations to remote D1

These migrations must apply in order. Each one is additive; no rollback expected to be needed unless schema corruption.

```bash
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 migrations apply air-action-sports-db --remote
```

This single command applies whichever migrations are pending. After apply, verify with:

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 execute air-action-sports-db --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected new tables:
- roles, persons, person_roles, person_tags
- staff_documents, staff_document_roles, staff_document_acknowledgments
- person_documents, portal_sessions
- capabilities, role_presets, role_preset_capabilities, user_capability_overrides
- certifications, role_required_certifications
- event_staffing, event_staffing_reminders
- labor_entries, tax_year_locks
- event_day_sessions
- incidents, incident_persons, incident_attachments
- booking_charges, charge_caps_config

Plus extended `users.role_preset_key` column.

### 3. Run backfill scripts

Order: persons backfill first (depends on migrations 0030 + 0031 + 0032), then JD import (depends on persons + role catalog).

```bash
# 1. Persons backfill (creates persons rows + person_roles primary
#    role assignments for every existing user)
node scripts/backfill-persons.js --remote

# Expected output: 4 persons created (matching the 4 admin users),
# all mapped to role_event_director (since all are role='owner').

# 2. JD import (22 staff_documents v1.0 rows)
node scripts/import-job-descriptions.js --remote

# Expected output: 22 JDs imported, 0 skipped, 0 flagged.
```

### 4. Migrate users to explicit role presets

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 execute air-action-sports-db --remote \
  --command="UPDATE users SET role_preset_key = 'event_director' WHERE role_preset_key IS NULL AND role = 'owner'"
```

(Adjust per-user via SQL if specific users should map to non-default presets.)

### 5. Merge milestone branch to main

After verifying tests + lint + build still green on the milestone branch:

```bash
git checkout main
git pull origin main
git merge --no-ff milestone/5-staff-event-day -m "Merge pull request M5 — Staff Management + Event-Day Mode"
git push origin main
```

Workers Builds auto-deploys on push to main.

### 6. Smoke checks

- `curl https://airactionsport.com/api/health` → `{"ok":true,...}`
- `curl https://airactionsport.com/api/admin/staff` (with admin cookie) → 200 with persons list (4 rows expected)
- `curl https://airactionsport.com/api/admin/staff-documents?kind=jd` → 200 with 22 docs
- `/admin/staff` UI loads + renders directory
- `/admin/staff/:id` UI loads with 8 tabs
- `/admin/staff/library` UI loads with 22 JDs
- Portal smoke: invite a test person, click magic link from email, verify /portal landing
- Event-day smoke: navigate /event with active event today; verify tile grid renders

## Operator-actionable rollouts post-deploy

These flips/exposures happen after deploy is confirmed stable:

1. Promote select Tier-1 admins to non-owner role presets (e.g., bookkeeper, marketing) via SQL UPDATE on `users.role_preset_key`.
2. Invite Tier-3 staff to the portal via `/admin/staff/:id` -> Invite. Each invite sends an email and creates a 24-hour magic link.
3. Tag staff documents to roles via SQL or future B5b admin UI. Required policy acks gate event work.

## Known deferred items (post-M5 follow-ups)

- Cron sweep for cert expiration alerts (60d/30d/7d email windows)
- Cron sweep for event-staffing reminders (7d/3d/1d windows + day-of)
- Backend routes for incidents, booking_charges, walk-up booking, event_checklists
- AdminUsersLegacy decommission (Batch 17 deferred — operator can manually delete when ready)
- Schedule & Pay tab on AdminStaffDetail (UI for labor_entries)
- Visual regression baselines for admin pages
- Portal-side document role tagging admin UI

These do not block M5 close; the schema substrate is in place for each.
