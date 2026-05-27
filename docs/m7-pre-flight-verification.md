# M7 Pre-flight Verification (Batch 0)

**Captured:** 2026-05-27 against production D1 (`d72ea71b-f12f-4684-93a2-52fbe9037527`).
**Branch:** `milestone/7-reports-search-virtualized` off main `1e6062b`.

This document fulfills Batch 0 Tasks 0a + 0b per the M7 prompt — M6 verification and pre-migration schema spot-checks for every table M7 will touch.

---

## Task 0a — M6 verification

| Check | Result |
|---|---|
| `npm test` on main | **2424 / 192 passing** (M6 baseline 2292 + 132 from polish PRs #202-#211) |
| `npm run build` | clean (~264ms) |
| Production health | `{"ok":true,...}` 200 OK |
| `email_templates` row count | **34** ✓ |
| `dispute_received` template | exists with `slug='dispute_received'`, `status='published'` ✓ |
| `booking_confirmation` body | includes "Heads-up — Additional Charges May Apply" ✓ |
| Migrations on remote | 0001-0061 applied ✓ (M6 ended at 0058; post-M6 polish session added 0059/0060/0061) |
| Main HEAD | `1e6062b` (Merge #208 Marketing B1) |

**Note on test count vs M7 prompt's "2292":** The M7 prompt was written immediately after M6 close. Since then, 9 polish PRs landed (Tracks B/D/C + Marketing B1 + sidebar + docs), bringing the actual M7 starting baseline to **2424 / 192**. M7's DoD criterion `Test count ≥ 2412` is already satisfied at the starting line; M7 must add tests on top.

---

## Task 0b — Pre-migration schema spot-checks (per Lesson #7)

All schemas captured via `SELECT sql FROM sqlite_master WHERE name='X'` (the `.schema` sqlite3 shell command does NOT work via wrangler — per M6 B0 Lesson #1).

### `email_templates`

```sql
CREATE TABLE email_templates (
    id              TEXT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    subject         TEXT NOT NULL,
    body_html       TEXT NOT NULL,
    body_text       TEXT,
    variables_json  TEXT,
    updated_by      TEXT REFERENCES users(id),
    updated_at      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'published'   -- added in 0056 (M6 B3)
)
```

**M7 impact:** Lesson #7 confirmed — `id TEXT PRIMARY KEY` + `created_at INTEGER NOT NULL`. **No `name` column** (CLAUDE.md uses "name" informally; the actual column is `slug`). All M7 `email_templates` seeds must include `id='tpl_<slug>'`, `slug='<slug>'`, `created_at=updated_at`.

**ID convention divergence note:** Most templates use `tpl_<slug>` (booking_confirmation, dispute_received, etc.). Vendor-related ones use `et_<slug>` (vendor_package_sent, vendor_signature_requested, etc.) — set in M5/M5.5. **M7 will use `tpl_<slug>` per the dominant convention** (matches Lesson #7).

### `audit_log`

```sql
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    meta_json   TEXT,
    ip_address  TEXT,
    created_at  INTEGER NOT NULL
)
```

**M7 impact (Batch 6 — FTS5 search):**
- 7 columns total (matches M6's "audit log is 7-col, not 6" observation). The `meta_json` column is the FTS5 target for Batch 6's full-text search.
- `id` is INTEGER AUTOINCREMENT (not TEXT). Batch 6's FTS5 trigger must use `NEW.id` to track.
- `INSERT-only` per design (no UPDATE / DELETE triggers needed for FTS sync).
- `writeAudit()` helper in `worker/lib/auditLog.js` writes to this table — used by all M2+ audit emissions. Existing INSERT pattern is `(user_id, action, target_type, target_id, meta_json, ip_address?, created_at)`.

### `customers`

```sql
CREATE TABLE customers (
    id                       TEXT PRIMARY KEY,            -- cus_*
    email                    TEXT,
    email_normalized         TEXT,
    name                     TEXT,
    phone                    TEXT,
    total_bookings           INTEGER NOT NULL DEFAULT 0,
    total_attendees          INTEGER NOT NULL DEFAULT 0,
    lifetime_value_cents     INTEGER NOT NULL DEFAULT 0,
    refund_count             INTEGER NOT NULL DEFAULT 0,
    first_booking_at         INTEGER,
    last_booking_at          INTEGER,
    email_transactional      INTEGER NOT NULL DEFAULT 1 CHECK (email_transactional IN (0, 1)),
    email_marketing          INTEGER NOT NULL DEFAULT 1 CHECK (email_marketing IN (0, 1)),
    sms_transactional        INTEGER NOT NULL DEFAULT 0 CHECK (sms_transactional IN (0, 1)),
    sms_marketing            INTEGER NOT NULL DEFAULT 0 CHECK (sms_marketing IN (0, 1)),
    notes                    TEXT,
    notes_sensitive          TEXT,
    archived_at              INTEGER,
    archived_reason          TEXT,
    archived_by              TEXT REFERENCES users(id),
    merged_into              TEXT REFERENCES customers(id),
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    business_name            TEXT,                                       -- M5.5 B3
    business_tax_id          TEXT,                                       -- M5.5 B3 (AES-encrypted)
    business_billing_address TEXT,                                       -- M5.5 B3 (AES-encrypted)
    business_website         TEXT,                                       -- M5.5 B3
    client_type              TEXT NOT NULL DEFAULT 'individual'
                             CHECK (client_type IN ('individual', 'business'))   -- M5.5 B9 NOT NULL
)
```

**M7 impact (Batch 8 — email metrics, customer_id linkage):**
- `customers.id` is `TEXT PRIMARY KEY` with `cus_*` prefix.
- Email metrics tables (`email_bounces`, `email_complaints`) will reference `customers.id` (nullable when bounce email doesn't match any customer).
- For Customer Detail Communications tab extension: aggregate email metrics via JOIN on `customer_id`.

### `bookings`

```sql
CREATE TABLE bookings (
    id                         TEXT PRIMARY KEY,
    event_id                   TEXT NOT NULL REFERENCES events(id),
    full_name                  TEXT NOT NULL,
    email                      TEXT NOT NULL,
    phone                      TEXT NOT NULL,
    player_count               INTEGER NOT NULL,
    line_items_json            TEXT NOT NULL,
    subtotal_cents             INTEGER NOT NULL,
    tax_cents                  INTEGER NOT NULL DEFAULT 0,
    total_cents                INTEGER NOT NULL,
    stripe_session_id          TEXT,
    stripe_payment_intent      TEXT,                                       -- NOT stripe_payment_intent_id (M6 lesson)
    status                     TEXT NOT NULL DEFAULT 'pending',
    notes                      TEXT,
    referral                   TEXT,
    created_at                 INTEGER NOT NULL,
    paid_at                    INTEGER,
    refunded_at                INTEGER,
    cancelled_at               INTEGER,
    discount_cents             INTEGER NOT NULL DEFAULT 0,
    promo_code_id              TEXT,
    fee_cents                  INTEGER NOT NULL DEFAULT 0,
    pending_attendees_json     TEXT,
    reminder_sent_at           INTEGER,
    reminder_1hr_sent_at       INTEGER,
    payment_method             TEXT,
    customer_id                TEXT NOT NULL DEFAULT '__needs_backfill__',  -- M3 B5
    refund_external            INTEGER NOT NULL DEFAULT 0,
    refund_external_method     TEXT,
    refund_external_reference  TEXT,
    refund_requested_at        INTEGER
)
```

**M7 impact (Batch 2 — Owner reports + Batch 3 Bookkeeper):**
- Owner revenue trends: aggregate `total_cents` / `paid_at` by period
- Refund rate: `COUNT(refunded_at IS NOT NULL) / COUNT(*)` by period
- Repeat customers: `customer_id` GROUP BY with HAVING COUNT > 1
- AOV: `AVG(total_cents)` per booking
- Bookkeeper tax/fee summary: `SUM(tax_cents)`, `SUM(fee_cents)` by period
- **Stripe field name:** `stripe_payment_intent` (NOT `_id` suffix). M7 reports queries should reference this exact name.
- **Backfill sentinel:** `customer_id = '__needs_backfill__'` rows exist (pre-M3 bookings without customer link). M7 reports should filter `WHERE customer_id != '__needs_backfill__'` for customer-aggregating reports.

### `attendees`

```sql
CREATE TABLE attendees (
    id                  TEXT PRIMARY KEY,
    booking_id          TEXT NOT NULL REFERENCES bookings(id),
    ticket_type_id      TEXT NOT NULL REFERENCES ticket_types(id),
    first_name          TEXT NOT NULL,
    last_name           TEXT,
    email               TEXT,
    phone               TEXT,
    qr_token            TEXT NOT NULL UNIQUE,
    waiver_id           TEXT,
    checked_in_at       INTEGER,
    checked_in_by       TEXT REFERENCES users(id),
    cancelled_at        INTEGER,
    created_at          INTEGER NOT NULL,
    custom_answers_json TEXT,
    customer_id         TEXT NOT NULL DEFAULT '__needs_backfill__'   -- M3 B5
)
```

**M7 impact (Batch 4 — Marketing reports):**
- Conversion funnel: pending → paid → checked-in counts per event. checked-in count via `attendees.checked_in_at IS NOT NULL`.
- Marketing customer cohorts: GROUP BY first_booking acquisition month via `customers.first_booking_at`.

### `field_rentals`

Confirmed: schema has all M5.5 B4/B7/B10 columns plus the post-M5.5 polish `lead_stale_at INTEGER` column. Key fields for M7 Batch 5 (Site Coordinator reports):

- `site_id` FK → sites table (revenue-by-site grouping)
- `client_type` joins to customers
- `engagement_type` (paintball, tactical_training, etc.)
- `status` enum (lead/draft/sent/agreed/paid/completed/cancelled/refunded) — funnel
- `total_cents`, `site_fee_cents`, `tax_cents` — revenue components
- `coi_status` ('not_required', 'pending', 'received', 'expired'), `coi_expires_at` — compliance
- `recurrence_id` + `recurrence_instance_index` — recurrence retention queries
- `created_at`, `status_changed_at` — funnel progression timestamps
- `archived_at`, `cancelled_at` — exclusion filters

### `field_rental_payments`

```sql
CREATE TABLE field_rental_payments (
  id                  TEXT PRIMARY KEY,
  rental_id           TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  recurrence_id       TEXT REFERENCES field_rental_recurrences(id),
  payment_kind        TEXT NOT NULL CHECK (payment_kind IN
                        ('deposit','balance','full','damage','refund','other')),
  payment_method      TEXT NOT NULL CHECK (payment_method IN
                        ('cash','check','venmo','ach','card_offplatform','stripe_invoice')),
  reference           TEXT,
  stripe_invoice_id   TEXT,
  amount_cents        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                        ('pending','received','refunded','void')),
  due_at              INTEGER,
  received_at         INTEGER,
  refunded_at         INTEGER,
  refund_amount_cents INTEGER,
  refund_reason       TEXT,
  refund_method       TEXT CHECK (refund_method IS NULL OR refund_method IN
                        ('cash','check','venmo','ach','card_offplatform','stripe_invoice')),
  received_by_user_id TEXT REFERENCES users(id),
  notes               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
)
```

**M7 impact:** Bookkeeper payouts summary aggregates here. Site Coordinator field rental revenue groups by `field_rentals.site_id` joined to this table for paid totals.

---

## Schema mismatches flagged (none blocking)

No column-name mismatches between local fixture and production were found that would break M7's planned report queries.

**Informational notes:**
- `customers.notes_sensitive` and `customers.notes` are both TEXT (Marketing reports won't query these; informational).
- Several columns have `'__needs_backfill__'` default values from M3 migrations — M7 report queries should filter these out for accurate customer-aggregating metrics.
- `email_templates` lacks a `name` column (CLAUDE.md uses "name" informally for `slug`).

---

## Sign-off for Batch 1 readiness

- ✅ M6 production state matches expectations
- ✅ All 7 M7-relevant tables spot-checked
- ✅ No schema mismatches that would block M7 report queries
- ✅ Lesson #7 confirmed: M7 email_templates seeds (Batch 10) must include `id='tpl_<slug>'` + `slug='<slug>'` + `created_at=updated_at`
- ✅ Migration 0062 (reports_capabilities — first M7 migration) is safe to author
- ✅ Tests baseline: 2424 / 192 (need ≥ 2412 per DoD; satisfied at start)

**Ready to proceed to Batch 1** (Reports infrastructure + persona-aware navigation + capabilities migration 0062). Plan-mode-first per batch operating rule still applies.
