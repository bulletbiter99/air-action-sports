# M5.5 deploy runbook

**Milestone:** Field Rentals (Surface 7 build)
**Long-lived branch:** `milestone/5.5-field-rentals`
**Status at close:** all 11 batches (B1 through B11) merged to milestone; closing milestone-to-main merge brings production up to M5.5 close.

This runbook captures the deploy sequence used to bring M5.5 live, including the per-batch rolling brings-up to main that operated throughout the milestone and the final cutover. Mirrors the M3 / M4 / M5 deploy doc patterns.

---

## Pre-merge checklist

Run on the milestone tip before opening the final milestone-to-main PR:

```bash
git checkout milestone/5.5-field-rentals
git pull origin milestone/5.5-field-rentals

npm install
npm test              # expect ~1997+ tests passing across ~161+ files
npm run lint          # expect 0 errors / ~440 warnings
npm run build         # expect clean
```

CI must be green on the milestone branch (Vitest + Playwright visual regression + Workers Builds).

---

## D1 migrations applied to remote during M5.5

Ten migrations were applied over the milestone, in order:

| Migration | Batch | What it does | Operator-applied |
|---|---|---|---|
| `0044_sites_schema.sql` | B1 | `sites` + `site_fields` + `site_blackouts` tables | ✓ 2026-05-11 (mid-milestone) |
| `0045_events_site_id.sql` | B2 | `events.site_id` column + backfill (parses events.location) | ✓ 2026-05-11 |
| `0046_customers_client_type.sql` | B3 | `customers.client_type` + 4 business_* cols (nullable) | ✓ 2026-05-11 |
| `0047_field_rentals_core.sql` | B4 | `field_rentals` + `field_rental_recurrences` + `customer_contacts` + `field_rental_contacts` (4 tables, ~50 cols on the workhorse) | ✓ 2026-05-11 |
| `0048_field_rentals_documents_payments.sql` | B5 | `site_use_agreement_documents` + `field_rental_documents` + `field_rental_payments` (3 tables) | ✓ 2026-05-11 |
| `0049_field_rentals_capabilities.sql` | B6 | 17 new caps + `site_coordinator` role_preset + 45 bindings | ✓ 2026-05-11 |
| `0050_customers_client_type_not_null.sql` | B9 | Column-rename to NOT NULL DEFAULT 'individual' (D1 quirk #2 pattern) | ✓ 2026-05-12 |
| `0051_cron_sentinels_and_business_caps.sql` | B10a | `field_rentals.lead_stale_at` column + `site_coordinator → customers.read.business_fields` binding | ✓ 2026-05-12 |
| `0052_field_rental_cron_email_templates.sql` | B10b | 4 cron email templates (coi_alert_60d/30d/7d + field_rental_lead_stale) | ✓ 2026-05-12 |
| `0053_inquiry_notification_email_template.sql` | B11 | 1 email template (inquiry_notification) for the public /contact pipeline | (queued — apply after merge) |

To apply remaining migration:

```bash
source .claude/.env  # or export CLOUDFLARE_API_TOKEN
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote
```

---

## Cron sweeps registered

After Workers Builds redeploys, the 03:00 UTC dispatch in `worker/index.js scheduled()` runs 8 sweeps (was 5 pre-M5.5; M5.5 added 3):

| Sweep | Source | Purpose |
|---|---|---|
| Customer-tags refresh | M3 B10 | Recompute system tags (vip / frequent / lapsed / new) |
| Cert expiration | M5 R8 | 60d/30d/7d staff cert renewal alerts |
| Event-staffing reminder | M5 R9 | Pre-event reminders to invited staff |
| Event-staffing auto-decline | M5 R9 | Auto-decline overdue invitations |
| Tax-year auto-lock | M5 R11 | Lock previous year + w9_reminder on March 1+ |
| **Recurrence generation** | **M5.5 B10a** | Generate child field_rentals from active recurrence series out to 90-day horizon |
| **COI expiration alerts** | **M5.5 B10b** | 60d/30d/7d COI alerts to site coordinator (fallback ADMIN_NOTIFY_EMAIL) |
| **Lead-stale alerts** | **M5.5 B10b** | 14-day staleness threshold + 7-day re-notify cadence on lead/draft rentals |

The 15-min cron (`*/15 * * * *`) is unchanged — it still runs reminder + abandon-pending + vendor sweeps only.

---

## Email templates seeded

5 new email templates landed in M5.5:

| Slug | Batch | Trigger |
|---|---|---|
| `coi_alert_60d` | B10b | Cron when rental's COI expires in (30d, 60d] window |
| `coi_alert_30d` | B10b | Cron when rental's COI expires in (7d, 30d] window |
| `coi_alert_7d` | B10b | Cron when rental's COI expires in (now, 7d] window (urgent) |
| `field_rental_lead_stale` | B10b | Cron when rental sits in lead/draft 14+ days |
| `inquiry_notification` | B11 | Public /contact form submission |

Verify after migration 0053 applies:

```bash
wrangler d1 execute air-action-sports-db --remote --command="SELECT slug FROM email_templates WHERE slug IN ('coi_alert_60d','coi_alert_30d','coi_alert_7d','field_rental_lead_stale','inquiry_notification')"
# expected: 5 rows
```

---

## Capability + role-preset additions

- **17 new capabilities** seeded in B6 (migration 0049): `events.override_conflict`, `field_rentals.send_quote / send_contract / email / export / archive / deposit_record / balance_record / recurrence_create / recurrence_modify / recurrence_end / documents.read / documents.upload / coi.read_pii / notes.read_sensitive / notes.write_sensitive`, `sites.blackout_create`.
- **1 new role_preset** seeded in B6: `site_coordinator` (tier 2, manager-level).
- **45 role-preset → capability bindings** seeded in B6 (owner + bookkeeper + compliance_reviewer + site_coordinator).
- **1 additional binding** seeded in B10a (migration 0051): `site_coordinator → customers.read.business_fields` (closes the gap from M5 0031).
- **2 caps already existed** from M5 0031 but missed bindings: `customers.read.business_fields` + `customers.write.business_fields` — completed by 0051 for the M5.5 personas.

Verify post-migration:

```bash
wrangler d1 execute air-action-sports-db --remote --command="SELECT role_preset_key FROM role_preset_capabilities WHERE capability_key='customers.read.business_fields' ORDER BY role_preset_key"
# expected: owner, event_director, booking_coordinator, bookkeeper, site_coordinator, compliance_reviewer
```

---

## Routes registered

11 new admin routes + 1 public route + 1 public mount-line change:

| Mount | Source | Endpoints |
|---|---|---|
| `/api/admin/sites` | B6.5 | 10 endpoints (list/detail/create/update/archive + fields + blackouts) |
| `/api/admin/field-rentals` | B7a | 8 endpoints (list/detail/create/update + status/cancel/archive/reschedule) |
| `/api/admin/field-rental-documents` | B7b | 5 endpoints (upload/list/detail/download/retire) |
| `/api/admin/field-rental-payments` | B7b | 4 endpoints (record/list/update/refund) |
| `/api/inquiry` | **B11** | **1 endpoint (POST)** — public /contact form target |

The admin routes are cookie-bearing + capability-gated; the public inquiry route uses RL_FEEDBACK rate-limit binding + honeypot.

---

## Frontend pages added / changed

| Path | Source | Notes |
|---|---|---|
| `/admin/sites` + `/admin/sites/:id` | B6.5 | Sites + Fields directory |
| `/admin/field-rentals` | B8 | List page with FilterBar + paginated table |
| `/admin/field-rentals/new` | B8 | Single-page 3-step wizard (Customer → Schedule → Terms) |
| `/admin/field-rentals/:id` | B8 | 2-column detail with 5 modals (status / cancel / upload / payment / refund) |
| `/admin/customers/:id` | B9 (edit) | Adds Business profile card + Field Rentals section |
| `/contact` | **B11** (edit) | Replaces `alert()` placeholder with real submission to /api/inquiry + honeypot + inline success/error/rate-limit states |

Sidebar gets two new items (`Sites`, `Field Rentals`) gated by capability stub `sites.read` and `field_rentals.read`.

---

## Final mid-milestone → main merge

After this PR (B11) merges to milestone:

```bash
# Switch to main and rebase / merge milestone
git checkout main
git pull origin main
git merge --no-ff milestone/5.5-field-rentals
git push origin main
```

Workers Builds auto-detects the push and redeploys. Verify `/api/health` returns OK within ~2 minutes.

---

## Post-deploy smoke

Run these as the operator after the milestone-to-main merge:

1. **Migration 0053 applied:**
   ```bash
   wrangler d1 execute air-action-sports-db --remote --command="SELECT slug FROM email_templates WHERE slug='inquiry_notification'"
   ```
   Expected: 1 row.

2. **Public /contact form submission (general inquiry):**
   - Visit https://airactionsport.com/contact
   - Fill out the form with subject='general'
   - Submit
   - Verify inline success message appears
   - Verify operator email arrives with subject `[General Inquiry] <name>`

3. **Public /contact form submission (field-rental lead):**
   - Visit /contact again
   - Fill out with subject='private-hire' or 'corporate'
   - Submit
   - Verify operator email arrives with subject `[Field Rental Inquiry] <name>`
   - Verify `/admin/customers` shows a new customer row with `clientType='individual'` (or 'business' if the operator manually flips it)
   - Verify `/admin/field-rentals?status=lead` shows a new lead with `engagement_type='private_skirmish'` or `'corporate'`
   - Click into the lead detail → confirm the inquiry message is in `notes`

4. **Cron sweep summary log:**
   - Wait for tonight's 03:00 UTC sweep OR trigger manually via wrangler
   - Inspect logs (Cloudflare dashboard → Workers → air-action-sports → Logs)
   - Expected summary keys: `tags`, `certs`, `staffReminders`, `staffAutoDecline`, `taxYearAutoLock`, `recurrenceGen`, `coiAlerts`, `leadStale`
   - With 0 active recurrences + 0 lead rentals today, all M5.5 sweeps return zero counts

5. **Honeypot guard:**
   - Send a POST to /api/inquiry with a non-empty `website` field via curl
   - Expected: 200 OK with `{ok:true}` but NO new audit_log row, NO new customer, NO new lead

6. **Rate limit:**
   - Submit /contact form 5+ times rapidly from same IP
   - Expected: 6th+ submission returns 429 "Too many requests" with inline rate-limit banner

---

## Final state at M5.5 close

- **Branches:** `milestone/5.5-field-rentals` merged to `main` as final commit
- **Tests:** ~1997+ across ~161+ files (counts grew through batches: 1634 baseline → 1979 B10b → ~2000+ B11)
- **Lint:** 0 errors, ~440 warnings (existing baseline; no new errors introduced)
- **Build:** clean
- **D1 migrations:** 0044-0053 (10 new migrations applied)
- **Cron sweeps:** 3 new (recurrence-generation, COI alerts, lead-stale alerts) joining the existing 5
- **Email templates:** 5 new (4 cron alerts + 1 public inquiry notification)
- **Public routes:** 1 new (`POST /api/inquiry`)
- **Admin routes:** ~27 new endpoints across 4 router files

---

## Known deferrals (not blocking close)

- **AES decryption surface** for `customers.business_tax_id` (EIN) + `customers.business_billing_address` — column storage exists; `customers.read.business_fields` capability + bindings exist; AdminCustomerDetail.jsx renders stub messages. A post-M5.5 polish batch ships the decrypt+render+edit-modal surface.
- **Admin POST /api/admin/customers** — public /contact creates customers; phone-intake / direct-admin-create gap remains. Queued for the same post-M5.5 polish batch.
- **Monthly day_of_month recurrence pattern** — schema accepts it via `monthly_pattern.kind='day_of_month'` but the cron generator only handles `kind='nth_weekday'`. Add when an operator use case appears.
- **/status route does not clear `lead_stale_at`** — revert from sent→draft has 7-day silence before re-alerting; acceptable but minor polish item.
- **CLAUDE.md + HANDOFF.md M5.5-close updates** — deferred to the post-merge docs PR (separate file count, doesn't affect deploy).
