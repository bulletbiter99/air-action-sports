# Runbook — field-rental recurring series

**Audience:** operator. **Last updated:** Sprint 4 (admin-audit B4).

A recurring series (`field_rental_recurrences`) is a rule + template; the
nightly **03:00 UTC sweep** (`runRecurrenceGenerationSweep`) generates the
actual `field_rentals` instances out to a **90-day horizon**. Nothing appears
the moment a series is created — the first instances land on the next sweep.

## The UI path (Sprint 4)

- **Create:** open any live rental at `/admin/field-rentals/:id` → the
  **Recurring series** card → **↻ Make recurring**. The rental is the
  template (site, fields, times, engagement, fee); pick weekly weekdays or a
  monthly day-of-month, the window, and optional end date / max occurrences.
  Requires `field_rentals.recurrence_create`.
- **Pause / Resume:** on any generated instance's detail page, the series
  card shows **⏸ Pause** / **▶ Resume** (`field_rentals.recurrence_modify`).
  - **Resume never backfills the paused gap.** The cron generates from
    `recurrence_generated_through + 1`, so resume bumps that sentinel to
    *yesterday* — generation continues from today; dates skipped while
    paused stay skipped. Missed occurrences you DO want must be created as
    one-off rentals via the wizard.
- **End (permanent):** **✕ End series** deactivates the series, closes its
  window (`ends_on = today`) so resume can't revive it, and **cancels future
  instances still in a cancellable status** (lead/draft/sent/agreed).
  **Paid/completed instances are untouched** — money has moved; handle those
  through the per-rental cancel/refund flows with their deposit semantics.
  Requires `field_rentals.recurrence_end`.

## Semantics worth knowing

- **Time template is America/Denver wall clock.** `template_starts_local` /
  `template_ends_local` are `HH:MM` interpreted per-occurrence with the
  correct DST offset (`denverOffsetMinutes`). Same-day only — an overnight
  span would generate ends-before-starts and be skipped.
- **Weekly** uses a weekday bitmask: 1=Sun, 2=Mon, 4=Tue, 8=Wed, 16=Thu,
  32=Fri, 64=Sat (sum for multiple days — Tue+Thu = 20).
- **Monthly** supports `{"kind":"day_of_month","day":N}` (what the UI
  creates) and `{"kind":"nth_weekday","n":N,"weekday":W}` (API/SQL only).
- **Conflict handling:** the sweep runs each candidate through the event/
  rental conflict engine; conflicting occurrences are skipped and counted in
  the cron summary (`recurrenceGen.conflictCount`).
- **Idempotency:** `(recurrence_id, recurrence_instance_index)` is UNIQUE
  (migration 0060) — re-runs can't double-generate.

## SQL fallback recipes

Prefer the UI/API. If SQL is needed (e.g. a custom-dates series, which the
UI doesn't offer), follow the house pattern: write the SQL to `scripts/`,
apply with `wrangler d1 execute --remote --file`, commit the file as the
audit record.

**Inspect all series + their generation state:**

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT id, frequency, starts_on, ends_on, active, recurrence_generated_through FROM field_rental_recurrences ORDER BY created_at DESC"
```

**Create a custom-dates series** (UI covers weekly/monthly only):

```sql
INSERT INTO field_rental_recurrences (
  id, customer_id, site_id, frequency, custom_dates_json,
  starts_on, template_engagement_type, template_site_field_ids,
  template_starts_local, template_ends_local, template_site_fee_cents,
  active, created_at, updated_at
) VALUES (
  'frr_' || lower(hex(randomblob(6))), 'cus_XXX', 'site_XXX', 'custom',
  '["2026-09-05","2026-10-03","2026-11-07"]',
  '2026-09-05', 'corporate', 'fld_XXX',
  '18:00', '22:00', 50000,
  1, strftime('%s','now') * 1000, strftime('%s','now') * 1000
);
```

**Pause / resume / end** — use the API endpoints (they carry the
sentinel-bump and future-instance-cancel logic a bare UPDATE would miss):

```bash
# pause
curl -X POST https://airactionsport.com/api/admin/field-rental-recurrences/frr_XXX/pause -H "Cookie: <admin session>"
```

If SQL is unavoidable, mirror the endpoint behavior exactly:
pause = `SET active = 0`; resume = `SET active = 1, recurrence_generated_through = date('now', '-1 day')`;
end = `SET active = 0, ends_on = date('now')` **plus** cancelling future
cancellable instances yourself.
