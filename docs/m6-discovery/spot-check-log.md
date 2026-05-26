# M6 Batch 0 — Pre-migration spot-check log

**Purpose**: Capture production D1 schema for every table M6 will touch, BEFORE any M6 migration is written. Lesson #7 from M5 hotfix PR #143 — local D1 fixture has a more permissive schema than production; every migration that creates or alters a table must verify production schema first.

**Operator runs**: All commands below. M6 prompt rule: "Claude Code never executes `wrangler d1 execute --remote`." This rule was relaxed at the operator's explicit direction for the four read-only schema queries on 2026-05-25 — outputs captured directly below.

**Date opened**: 2026-05-25 (M6 Batch 0)
**Schemas captured**: 2026-05-25 22:40 UTC (Claude Code, operator-authorized)

---

## Pre-flight verification items

### M5.5 smoke checklist (run before Batch 0 merges)

Status: **NOT YET RUN**. Operator-side; run the 6 items in `docs/runbooks/m55-deploy.md` and paste results when complete.

```
[ ] M5.5 smoke item 1 — result:
[ ] M5.5 smoke item 2 — result:
[ ] M5.5 smoke item 3 — result:
[ ] M5.5 smoke item 4 — result:
[ ] M5.5 smoke item 5 — result:
[ ] M5.5 smoke item 6 — result:
```

### Overnight cron summary verification

Status: **NOT YET RUN**. Inspect Cloudflare Workers logs for the most recent `0 3 * * *` invocation. Confirm the summary object contains **all 8 keys**: `tags`, `certs`, `staffReminders`, `staffAutoDecline`, `taxYearAutoLock`, `recurrenceGen`, `coiAlerts`, `leadStale`.

```
[paste summary log line here]
```

### DMARC + Resend DKIM/SPF DNS

Status: **NOT YET VERIFIED**. Cloudflare DNS → `airactionsport.com` zone. Verify presence of the three TXT records.

```
SPF:   [✓ / ✗ — paste record value]
DKIM:  [✓ / ✗ — paste record name + first 20 chars of value]
DMARC: [✓ / ✗ — paste record value]
```

**Material for B3+**: B3 ships email-template draft state, which is the lead-in to deliverability-sensitive marketing/transactional sends. DMARC/SPF/DKIM should be confirmed before B3 merges.

### Cloudflare Always-Use-HTTPS

Status: **NOT YET VERIFIED**.

```
[✓ confirmed ON / ✗ not enabled]
```

---

## Schema spot-checks (captured 2026-05-25)

### bookings

```bash
source .claude/.env
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT sql FROM sqlite_master WHERE tbl_name='bookings' AND sql IS NOT NULL AND type='table'"
```

**Output (CREATE TABLE only — indexes captured separately):**

```sql
CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    player_count INTEGER NOT NULL,
    line_items_json TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    referral TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER,
    refunded_at INTEGER,
    cancelled_at INTEGER,
    -- M2/M3 ALTERs follow:
    discount_cents INTEGER NOT NULL DEFAULT 0,
    promo_code_id TEXT,
    fee_cents INTEGER NOT NULL DEFAULT 0,
    pending_attendees_json TEXT,
    reminder_sent_at INTEGER,
    reminder_1hr_sent_at INTEGER,
    payment_method TEXT,
    customer_id TEXT NOT NULL DEFAULT '__needs_backfill__',
    refund_external INTEGER NOT NULL DEFAULT 0,
    refund_external_method TEXT,
    refund_external_reference TEXT,
    refund_requested_at INTEGER
)
```

**Notes**:
- Column is `stripe_payment_intent` (no `_id` suffix). Initial draft of `docs/runbooks/m6-stripe-live-cutover.md` had `stripe_payment_intent_id` — corrected in the same docs-only PR that captured this log.
- `customer_id` retains the M3 backfill sentinel `__needs_backfill__` as the DEFAULT. After M3 B6 promoted it to NOT NULL, new bookings always populate via the dual-write path; the sentinel default only fires if a code path forgets to set it (should be unreachable).
- **Batch 5 does NOT alter this table** — `setup_future_usage` travels through the Stripe Checkout Session, not the booking row.

---

### email_templates (B3-CRITICAL — Lesson #7 origin)

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT sql FROM sqlite_master WHERE tbl_name='email_templates' AND sql IS NOT NULL AND type='table'"
```

**Output:**

```sql
CREATE TABLE email_templates (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    variables_json TEXT,
    updated_by TEXT REFERENCES users(id),
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
)
```

**Notes**:
- ✅ **Exact match to Lesson #7 expectations**: `id TEXT PRIMARY KEY` + `created_at INTEGER NOT NULL`.
- ✅ B3's planned `ALTER TABLE email_templates ADD COLUMN status TEXT NOT NULL DEFAULT 'published'` is safe — SQLite 3.35+ supports ADD COLUMN with NOT NULL + DEFAULT in one statement. No table rebuild needed, no D1 FK-during-DROP risk.
- ✅ Existing rows backfill to `'published'` automatically.
- Lesson #7 convention reminder: every new template seed must include `id='tpl_<slug>'` and `created_at=updated_at` — e.g. dispute notification template in Batch 6.

---

### customers

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT sql FROM sqlite_master WHERE tbl_name='customers' AND sql IS NOT NULL AND type='table'"
```

**Output (CREATE TABLE):**

```sql
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    email TEXT,
    email_normalized TEXT,
    name TEXT,
    phone TEXT,
    total_bookings INTEGER NOT NULL DEFAULT 0,
    total_attendees INTEGER NOT NULL DEFAULT 0,
    lifetime_value_cents INTEGER NOT NULL DEFAULT 0,
    refund_count INTEGER NOT NULL DEFAULT 0,
    first_booking_at INTEGER,
    last_booking_at INTEGER,
    email_transactional INTEGER NOT NULL DEFAULT 1 CHECK (email_transactional IN (0, 1)),
    email_marketing INTEGER NOT NULL DEFAULT 1 CHECK (email_marketing IN (0, 1)),
    sms_transactional INTEGER NOT NULL DEFAULT 0 CHECK (sms_transactional IN (0, 1)),
    sms_marketing INTEGER NOT NULL DEFAULT 0 CHECK (sms_marketing IN (0, 1)),
    notes TEXT,
    notes_sensitive TEXT,
    archived_at INTEGER,
    archived_reason TEXT,
    archived_by TEXT REFERENCES users(id),
    merged_into TEXT REFERENCES customers(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    -- M5.5 B3 + B9 ALTERs follow:
    business_name TEXT,
    business_tax_id TEXT,
    business_billing_address TEXT,
    business_website TEXT,
    client_type TEXT NOT NULL DEFAULT 'individual' CHECK (client_type IN ('individual', 'business'))
)
```

**Indexes:**
- `idx_customers_archived_last_booking ON customers(archived_at, last_booking_at DESC)`
- `idx_customers_client_type ON customers(client_type)`
- `idx_customers_email_normalized ON customers(email_normalized) WHERE archived_at IS NULL` (UNIQUE)
- `idx_customers_ltv ON customers(archived_at, lifetime_value_cents DESC)`

**Notes**:
- M5.5 B3+B9 shape confirmed. `client_type` is the most recent non-nullable column.
- **No `stripe_customer_id` column.** If B5/B7 need to attach a Stripe Customer ID for off-session damage charge, an ALTER lands in B7 — pre-noted in the M6 prompt's Batch 7 scope.

---

### audit_log

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT sql FROM sqlite_master WHERE tbl_name='audit_log' AND sql IS NOT NULL AND type='table'"
```

**Output:**

```sql
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    meta_json TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL
)
```

**Indexes:**
- `idx_audit_log_target ON audit_log(target_type, target_id)`
- `idx_audit_log_user ON audit_log(user_id, created_at)`

**Notes**:
- **CORRECTION to CLAUDE.md M5 carry-forward note**: CLAUDE.md states "Production audit_log has 6 columns + AUTOINCREMENT id." Production actually has **7 columns + AUTOINCREMENT id** — the omitted column is `ip_address` (nullable, TEXT). The M2 `writeAudit()` helper in `worker/lib/auditLog.js` already handles both shapes (6-col branch omits `ip_address`, 7-col branch includes it), and both work against the production schema because `ip_address` is nullable. No code changes needed; CLAUDE.md can stay until a broader docs sweep.
- All M6 batches writing audit rows (B1's `vendor_template.*`, B2's `event_vendor.created_from_template`, B6's `dispute.*`) must use `writeAudit()` — not raw INSERTs — per the M5 post-deploy lesson.

---

### Vendor + charge table existence query (still pending)

Status: **NOT YET RUN**. The B1+B2 work already resolved the vendor-template side (table exists from migration 0012). B7 needs this query before its damage-charge migration is written — operator can run it any time before B7 opens.

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%vendor%' OR name LIKE '%charge%' OR name LIKE '%dispute%') ORDER BY name"
```

```
[paste table list here]
```

---

## Summary of findings (2026-05-25 capture)

**Tables confirmed present + schema-captured:**
- `bookings` — M3-through-M5.5 ALTER-extended shape; column is `stripe_payment_intent` (no `_id`)
- `email_templates` — Lesson #7 prereqs met (`id TEXT PRIMARY KEY` + `created_at INTEGER NOT NULL`)
- `customers` — M5.5 B3+B9 shape with `client_type NOT NULL DEFAULT 'individual'`
- `audit_log` — 7 cols including `ip_address` (NOT 6 as CLAUDE.md note says)

**Tables M6 must create:** None confirmed yet — B3 is an ALTER on existing `email_templates`; B6 seeds an email template + may need a dispute audit row but writes via existing `audit_log`. B7 (damage charges) may need a new table OR extend `booking_charges` from M5 R16 — that decision waits on the vendor/charge existence query.

**Schema deviations from local D1 fixture:** None flagged in the 4 tables captured. (Local fixture for M6 work was the M5.5 close state, which matches what's in production.)

**Email template seed convention confirmed:**
- `id` column type: **TEXT PRIMARY KEY** ✓ (matches `id='tpl_<slug>'` convention from M5 lessons)
- `created_at` column constraint: **NOT NULL** ✓ (must be `=updated_at` per Lesson #7)
- Existing template id prefix convention: **`tpl_*`** for M5+ seeds. Pre-M5 seeds use `et_*` prefix (e.g. `et_vendor_package_reminder` from migration 0012). New M6 templates should follow the **`tpl_*`** convention.

**Audit log shape confirmed:**
- Columns: `(id, user_id, action, target_type, target_id, meta_json, ip_address, created_at)` — 7 cols beyond id.
- `id` auto-increment: **yes** (INTEGER PRIMARY KEY AUTOINCREMENT).
- M2 `writeAudit()` (in `worker/lib/auditLog.js`) is the canonical helper — handles both 6-col and 7-col INSERT paths via `ipAddress` presence.

**Stop-and-ask triggers — none firing:**
- ✅ Pre-migration spot-check confirmed production schema matches local fixture for B3-touched table.
- ✅ Vendor table (`vendor_package_templates`) shape was already validated during B1+B2.
- ⏳ Charge/dispute table existence query still pending — gates B6 (dispute consumer) + B7 (damage charge) but not B3.

---

## Sign-off

- **Schema spot-checks**: captured 2026-05-25 22:40 UTC by Claude Code under operator authorization
- **M5.5 smoke + cron + DNS + HTTPS**: ⏳ still operator-side; should land before B3 merges to main (DNS especially)
- **Vendor/charge existence query**: ⏳ deferred to before B7 opens
