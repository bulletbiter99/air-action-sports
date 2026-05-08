# Surface 7 — Schema spec

Schema for the M5.5 Field Rentals build. All additive; no existing column renamed. Lives in migration `0043_field_rentals_schema.sql` (number assumes M5 ends at 0042; bump if otherwise).

Read alongside [surface-7-field-rentals.md](surface-7-field-rentals.md) for the surface intent and [surface-7-capabilities.md](surface-7-capabilities.md) for the access model.

---

## 1. New tables

### `sites`

Operating locations. Today AAS has Ghost Town + Foxtrot Fields; the table is general so additional sites can be added without migration.

```sql
CREATE TABLE sites (
  id              TEXT PRIMARY KEY,                    -- site_<random12>
  name            TEXT NOT NULL,                       -- "Ghost Town"
  slug            TEXT NOT NULL UNIQUE,                -- "ghost-town"
  display_address TEXT,                                -- "Hiawatha, UT 84545"
  timezone        TEXT NOT NULL DEFAULT 'America/Denver',
  default_pricing_model TEXT NOT NULL DEFAULT 'per_day' CHECK (default_pricing_model IN ('per_hour','per_day','flat_rate')),
  default_per_hour_cents  INTEGER,                     -- nullable; populated when model = per_hour
  default_per_day_cents   INTEGER,                     -- nullable; populated when model = per_day
  contact_email   TEXT,                                -- site lead's email (NOT a renter; the site operator)
  contact_phone   TEXT,
  notes           TEXT,                                -- internal notes (access codes, gate hours, etc.)
  active          INTEGER NOT NULL DEFAULT 1,
  archived_at     INTEGER,
  archived_reason TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_sites_slug ON sites(slug);
CREATE INDEX idx_sites_active ON sites(active);
```

### `site_fields`

Bookable units within a site. Each has its own calendar.

```sql
CREATE TABLE site_fields (
  id              TEXT PRIMARY KEY,                    -- fld_<random12>
  site_id         TEXT NOT NULL REFERENCES sites(id),
  name            TEXT NOT NULL,                       -- "Main Field" / "Forest Loop"
  description     TEXT,
  capacity_max    INTEGER,                             -- max attendees per booking (informational)
  active          INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_site_fields_site ON site_fields(site_id);
CREATE INDEX idx_site_fields_active ON site_fields(active);
```

### `site_blackouts`

Operator-configured downtime per field (maintenance, weather closures, planned offline windows). Blocks all bookings — events AND rentals.

```sql
CREATE TABLE site_blackouts (
  id              TEXT PRIMARY KEY,                    -- blk_<random12>
  field_id        TEXT NOT NULL REFERENCES site_fields(id),
  starts_at       INTEGER NOT NULL,                    -- ms
  ends_at         INTEGER NOT NULL,                    -- ms; > starts_at
  reason          TEXT,                                -- "Surface repair" / "Annual maintenance"
  created_by_user_id TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_blackouts_field_window ON site_blackouts(field_id, starts_at, ends_at);
```

### `field_rentals`

Top-level rental record. May own multiple `field_rental_recurrences` rows (one per occurrence in a recurring booking).

```sql
CREATE TABLE field_rentals (
  id              TEXT PRIMARY KEY,                    -- fr_<random12>
  customer_id     TEXT NOT NULL REFERENCES customers(id),
  site_id         TEXT NOT NULL REFERENCES sites(id),
  field_id        TEXT NOT NULL REFERENCES site_fields(id),

  -- Schedule
  rental_kind     TEXT NOT NULL DEFAULT 'once' CHECK (rental_kind IN ('once','weekly','monthly','custom')),
  starts_at       INTEGER NOT NULL,                    -- first occurrence ms
  ends_at         INTEGER NOT NULL,                    -- last occurrence ends_at ms (rolled up)

  -- Pricing
  pricing_model   TEXT NOT NULL CHECK (pricing_model IN ('per_hour','per_day','flat_rate')),
  rate_cents      INTEGER NOT NULL,                    -- the unit rate
  total_cents     INTEGER NOT NULL,                    -- sum across occurrences pre-tax
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  fee_cents       INTEGER NOT NULL DEFAULT 0,
  grand_total_cents INTEGER NOT NULL,
  deposit_cents   INTEGER,                             -- nullable; refundable deposit if charged
  recurring_discount_bps INTEGER,                      -- nullable; basis points off after N committed occurrences

  -- Documents (snapshot at sign time, mirrors waivers)
  agreement_document_id TEXT REFERENCES site_use_agreement_documents(id),
  agreement_signed_at   INTEGER,                       -- when renter signed
  agreement_body_html_snapshot TEXT,                   -- frozen at sign
  agreement_body_sha256 TEXT,                          -- frozen at sign
  agreement_signer_typed_name TEXT,
  agreement_signer_ip   TEXT,
  agreement_signer_ua   TEXT,
  countersigned_by_user_id TEXT REFERENCES users(id),  -- owner countersign
  countersigned_at      INTEGER,

  -- COI tracking
  coi_required          INTEGER NOT NULL DEFAULT 1,
  coi_min_amount_cents  INTEGER,                       -- e.g. $1M = 100000000
  coi_received_at       INTEGER,
  coi_expires_at        INTEGER,
  coi_document_id       TEXT REFERENCES field_rental_documents(id),

  -- Payment terms
  payment_terms         TEXT NOT NULL DEFAULT 'net_0' CHECK (payment_terms IN ('net_0','net_15','net_30')),
  cancellation_policy   TEXT NOT NULL DEFAULT 'standard' CHECK (cancellation_policy IN ('standard','negotiated')),
  cancellation_notes    TEXT,                          -- if negotiated

  -- Status
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','agreed','paid','completed','cancelled','refunded')),
  cancelled_at          INTEGER,
  cancelled_reason      TEXT,
  cancelled_by_user_id  TEXT REFERENCES users(id),

  -- Audit
  created_by_user_id    TEXT REFERENCES users(id),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_field_rentals_customer ON field_rentals(customer_id);
CREATE INDEX idx_field_rentals_field ON field_rentals(field_id);
CREATE INDEX idx_field_rentals_status ON field_rentals(status);
CREATE INDEX idx_field_rentals_window ON field_rentals(field_id, starts_at, ends_at);
```

### `field_rental_recurrences`

One row per occurrence for recurring rentals. For `rental_kind='once'`, exactly one row matching the parent's starts_at/ends_at.

```sql
CREATE TABLE field_rental_recurrences (
  id              TEXT PRIMARY KEY,                    -- frr_<random12>
  rental_id       TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  occurrence_number INTEGER NOT NULL,                  -- 1, 2, 3, ... for ordering
  starts_at       INTEGER NOT NULL,
  ends_at         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE(rental_id, occurrence_number)
);
CREATE INDEX idx_frr_rental ON field_rental_recurrences(rental_id);
CREATE INDEX idx_frr_window ON field_rental_recurrences(starts_at, ends_at);
```

### `field_rental_contacts`

Multiple contacts per rental (primary billing, on-site lead, etc.). Mirrors `vendor_contacts` table.

```sql
CREATE TABLE field_rental_contacts (
  id              TEXT PRIMARY KEY,                    -- frc_<random12>
  rental_id       TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  role            TEXT NOT NULL CHECK (role IN ('billing','onsite_lead','signer','other')),
  is_primary      INTEGER NOT NULL DEFAULT 0,          -- only one primary per rental enforced in route
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_frc_rental ON field_rental_contacts(rental_id);
```

### `field_rental_documents`

Files attached to a rental — agreement copies, COIs, addenda. Versioned where applicable; no in-place edit.

```sql
CREATE TABLE field_rental_documents (
  id              TEXT PRIMARY KEY,                    -- frd_<random12>
  rental_id       TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('agreement','coi','addendum','correspondence','other')),
  file_name       TEXT NOT NULL,
  r2_key          TEXT NOT NULL,                       -- field_rentals/<random>.<ext>
  content_type    TEXT NOT NULL,
  bytes           INTEGER NOT NULL,
  uploaded_by_user_id TEXT REFERENCES users(id),
  uploaded_at     INTEGER NOT NULL,
  retired_at      INTEGER                              -- versioning support; never NULL on the live row
);
CREATE INDEX idx_frd_rental ON field_rental_documents(rental_id);
CREATE INDEX idx_frd_kind ON field_rental_documents(kind);
```

### `field_rental_payments`

One row per Stripe Invoice. Recurring rentals can have multiple per parent rental.

```sql
CREATE TABLE field_rental_payments (
  id              TEXT PRIMARY KEY,                    -- frp_<random12>
  rental_id       TEXT NOT NULL REFERENCES field_rentals(id) ON DELETE CASCADE,
  recurrence_id   TEXT REFERENCES field_rental_recurrences(id),  -- NULL = parent invoice (deposit / one-shot)
  stripe_invoice_id TEXT,                              -- in_xxxx; NULL for non-Stripe (cash/check)
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('card','cash','check','venmo','ach')),
  amount_cents    INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded','void')),
  due_at          INTEGER,                             -- per payment_terms net-N
  paid_at         INTEGER,
  refunded_at     INTEGER,
  refund_amount_cents INTEGER,
  refund_reason   TEXT,
  refund_method   TEXT,                                -- 'stripe' / 'cash' / etc.
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_frp_rental ON field_rental_payments(rental_id);
CREATE INDEX idx_frp_recurrence ON field_rental_payments(recurrence_id);
CREATE INDEX idx_frp_status ON field_rental_payments(status);
CREATE INDEX idx_frp_stripe ON field_rental_payments(stripe_invoice_id);
```

### `site_use_agreement_documents`

Versioned, immutable agreement template library. Mirrors waiver_documents (migration 0011 pattern).

```sql
CREATE TABLE site_use_agreement_documents (
  id              TEXT PRIMARY KEY,                    -- sua_<random12>
  version         TEXT NOT NULL,                       -- 'v1.0', 'v1.1', etc.
  body_html       TEXT NOT NULL,
  body_sha256     TEXT NOT NULL,                       -- hex sha256 of body_html
  scope           TEXT NOT NULL DEFAULT 'all_sites' CHECK (scope IN ('all_sites','site_specific')),
  scoped_site_id  TEXT REFERENCES sites(id),           -- non-null when scope='site_specific'
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  retired_at      INTEGER,
  retired_by_user_id TEXT REFERENCES users(id)
);
CREATE INDEX idx_sua_live ON site_use_agreement_documents(retired_at, scope);
CREATE INDEX idx_sua_scoped ON site_use_agreement_documents(scoped_site_id);
```

### `customer_contacts` (NEW — for business clients)

For B2B rentals, business customers have multiple contacts (legal signer, primary billing, AP clerk). Already foreshadowed by vendor_contacts but separate table because customers and vendors are not the same entity.

```sql
CREATE TABLE customer_contacts (
  id              TEXT PRIMARY KEY,                    -- cc_<random12>
  customer_id     TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  role            TEXT NOT NULL CHECK (role IN ('billing','signer','onsite_lead','ap_clerk','other')),
  is_primary      INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  archived_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_customer_contacts_customer ON customer_contacts(customer_id);
```

---

## 2. `customers` table extensions

Adds B2B fields. All nullable so existing rows (all `client_type='individual'` post-backfill) continue working.

```sql
ALTER TABLE customers ADD COLUMN client_type TEXT NOT NULL DEFAULT 'individual'
  CHECK (client_type IN ('individual','business'));

ALTER TABLE customers ADD COLUMN legal_name TEXT;                  -- "Acme Tactical LLC"
ALTER TABLE customers ADD COLUMN ein TEXT;                          -- 12-3456789 (US tax ID)
ALTER TABLE customers ADD COLUMN registration_number TEXT;          -- D&B / state biz registration
ALTER TABLE customers ADD COLUMN billing_contact_id TEXT
  REFERENCES customer_contacts(id);                                 -- pointer to primary billing contact
ALTER TABLE customers ADD COLUMN billing_address_line1 TEXT;
ALTER TABLE customers ADD COLUMN billing_address_line2 TEXT;
ALTER TABLE customers ADD COLUMN billing_address_city TEXT;
ALTER TABLE customers ADD COLUMN billing_address_state TEXT;
ALTER TABLE customers ADD COLUMN billing_address_postal_code TEXT;
ALTER TABLE customers ADD COLUMN billing_address_country TEXT DEFAULT 'US';

CREATE INDEX idx_customers_client_type ON customers(client_type);
```

---

## 3. `taxes_fees` extension

Add `field_rental` to the `applies_to` CHECK enum:

```sql
-- D1 quirk: CHECK constraints can't be ALTERed in SQLite. Migration documents
-- the new valid values; the route layer enforces. (Same pattern as vendor_documents.kind.)
-- New valid applies_to values: 'all', 'tickets', 'field_rental'
```

---

## 4. `events` extension (for conflict detection)

Without this, M5.5's conflict-detection logic can't pair events with the field they occupy.

```sql
ALTER TABLE events ADD COLUMN field_id TEXT REFERENCES site_fields(id);
CREATE INDEX idx_events_field ON events(field_id);
```

Backfill: each existing event ties to a single physical field. Operator runs a one-shot script post-migration to set `field_id` per event:

```sql
UPDATE events SET field_id = 'fld_ghosttown_main' WHERE id IN (...);
UPDATE events SET field_id = 'fld_foxtrot_main' WHERE id IN (...);
```

(Site/field IDs auto-generated by Operator at site-creation time during the migration's final step.)

---

## 5. Migration ordering

```
0043_field_rentals_schema.sql:
  -- 1. New tables (in FK dependency order)
  CREATE TABLE sites ...
  CREATE TABLE site_fields ...
  CREATE TABLE site_blackouts ...
  CREATE TABLE site_use_agreement_documents ...
  CREATE TABLE customer_contacts ...
  CREATE TABLE field_rentals ...
  CREATE TABLE field_rental_recurrences ...
  CREATE TABLE field_rental_contacts ...
  CREATE TABLE field_rental_documents ...
  CREATE TABLE field_rental_payments ...

  -- 2. Customers extension
  ALTER TABLE customers ADD COLUMN client_type ...
  ALTER TABLE customers ADD COLUMN legal_name ...
  -- ... rest of B2B fields

  -- 3. Events extension for conflict detection
  ALTER TABLE events ADD COLUMN field_id ...

  -- 4. Indexes (already inline in CREATE TABLE)
  -- 5. Seeds: NONE in this migration. Operator creates Sites + Fields
  --    via /admin/sites UI in M5.5 batch 2 onward.
```

Operator workflow post-migration apply:
1. `/admin/sites` create row for "Ghost Town" → returns `site_id`
2. `/admin/sites/:id` add field "Main Field" → returns `field_id`
3. SQL UPDATE to backfill events (one-shot script in M5.5 batch X)
4. Repeat for Foxtrot Fields

---

## 6. D1 constraints reminder

Per [CLAUDE.md M3 D1 quirks subsection](../../CLAUDE.md#carry-forward-d1-quirks-added-2026-05-07-in-m4-batch-0):

1. No `BEGIN TRANSACTION` / `COMMIT` keywords (and no literal `TRANSACTION` keyword anywhere — wrangler parser flags even comments)
2. NOT NULL via table-rebuild fails on FK constraints during DROP. Use column-rename pattern if NOT NULL is required.
3. `wrangler --remote --json --file` strips upload-progress chars; if parsing JSON output programmatically, strip everything before first `[` or `{`.

This migration uses only ADD COLUMN + CREATE TABLE — no rebuild needed. Should apply cleanly.
