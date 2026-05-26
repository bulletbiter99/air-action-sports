# M6 Batch 0 — Pre-migration spot-check log

**Purpose**: Capture production D1 schema for every table M6 will touch, BEFORE any M6 migration is written. Lesson #7 from M5 hotfix PR #143 — local D1 fixture has a more permissive schema than production; every migration that creates or alters a table must verify production schema first.

**Operator runs**: All commands below. Claude Code never runs `wrangler d1 execute --remote`. Paste the captured output under each command before Batch 0 closes.

**Date opened**: 2026-05-25 (M6 Batch 0)

---

## Pre-flight verification items

### M5.5 smoke checklist (run before Batch 0 merges)

Run the 6 items in `docs/runbooks/m55-deploy.md`. Paste results below.

```
[ ] M5.5 smoke item 1 — result:
[ ] M5.5 smoke item 2 — result:
[ ] M5.5 smoke item 3 — result:
[ ] M5.5 smoke item 4 — result:
[ ] M5.5 smoke item 5 — result:
[ ] M5.5 smoke item 6 — result:
```

### Overnight cron summary verification

Inspect Cloudflare Workers logs for the most recent `0 3 * * *` invocation. Confirm the summary object contains **all 8 keys**: `tags`, `certs`, `staffReminders`, `staffAutoDecline`, `taxYearAutoLock`, `recurrenceGen`, `coiAlerts`, `leadStale`.

Paste the actual summary log line below:

```
[paste summary log line here]
```

### DMARC + Resend DKIM/SPF DNS

Cloudflare DNS → `airactionsport.com` zone. Verify presence of the three TXT records.

```
SPF:   [✓ / ✗ — paste record value]
DKIM:  [✓ / ✗ — paste record name + first 20 chars of value]
DMARC: [✓ / ✗ — paste record value]
```

### Cloudflare Always-Use-HTTPS

```
[✓ confirmed ON / ✗ not enabled]
```

---

## Schema spot-checks

### bookings

```bash
source .claude/.env
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command=".schema bookings"
```

**Output:**

```
[paste schema output here]
```

**Notes**: Batch 5 adds `setup_future_usage` handling but does NOT alter the bookings table schema (the flag travels through the Stripe Checkout Session, not stored on the booking row). Schema capture is for reference only.

---

### email_templates

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command=".schema email_templates"
```

**Output:**

```
[paste schema output here]
```

**Notes**: Batch 3 adds a `status` column (`'draft' | 'published'`) with backfill default `'published'`. Lesson #7 originated here — confirm `id TEXT PRIMARY KEY` and `created_at INTEGER NOT NULL` exist in production schema before Batch 3 writes the migration. Every new template seed in M6 (e.g., the dispute notification email in Batch 6) must include `id='tpl_<slug>'` and `created_at=updated_at` matching the existing convention (e.g., `tpl_event_reminder_24h`, `tpl_user_invite`).

---

### customers

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command=".schema customers"
```

**Output:**

```
[paste schema output here]
```

**Notes**: Batch 5's `setup_future_usage` change saves a Stripe payment method on the customer. Verify `customers` table is M3 0022 schema (has `email`, `email_normalized`, `email_marketing` consent column, denormalized aggregates). If a Stripe customer ID column is needed for Batch 7's off-session damage charge, that ALTER would happen in Batch 7, not Batch 0.

---

### audit_log

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command=".schema audit_log"
```

**Output:**

```
[paste schema output here]
```

**Notes**: Batch 6 (`charge.dispute.created` consumer) writes to audit_log via the M2 `writeAudit()` helper. Confirm the production shape is `(user_id, action, target_type, target_id, meta_json, created_at)` with `id INTEGER PRIMARY KEY AUTOINCREMENT` (per the M5 post-deploy carry-forward note: production audit_log differs from some older code's expectations of a 7-col TEXT-id shape).

---

### Vendor + charge table existence query

The M6 prompt references `vendor_packages` (Batch 1-2) and `damage_charges` (Batch 7) as M6 targets. Actual table names from M5/M5.5 may differ. Run this to enumerate:

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%vendor%' OR name LIKE '%charge%' OR name LIKE '%dispute%') ORDER BY name"
```

**Output:**

```
[paste table list here]
```

**What this tells us:**
- If a `vendor_packages` table exists already → Batch 1 likely extends rather than creates
- If only `vendor_contracts` / `vendor_documents` / `event_vendors` exist → Batch 1 creates the new table
- If a `booking_charges` table exists from M5 R16 → Batch 7 likely extends that, not creates `damage_charges`
- If a `disputes` table exists → flag it for Batch 6 reference

Capture the `.schema` for any matching tables found:

```bash
# Repeat .schema for each table the query above returned (operator fills in based on results)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command=".schema <table_name>"
```

**Captured schemas:**

```
[paste relevant .schema outputs here]
```

---

## Summary of findings (filled at Batch 0 close)

**Tables confirmed present (existing):**
- `bookings`
- `email_templates`
- `customers`
- `audit_log`
- [...other findings from the LIKE query]

**Tables M6 must create:**
- [TBD based on findings]

**Schema deviations from local D1 fixture:**
- [TBD — flag any column with NOT NULL constraint that doesn't appear in local fixture, etc.]

**Email template seed convention confirmed:**
- `id` column type: [TEXT PRIMARY KEY / other]
- `created_at` column constraint: [NOT NULL / nullable]
- Existing template id prefix convention: [`tpl_*` / other]

**Audit log shape confirmed:**
- Columns: [(user_id, action, target_type, target_id, meta_json, created_at) / other]
- `id` auto-increment: [yes / no]

**Stop-and-ask triggers:**
- Pre-migration spot-check reveals production schema differs from local fixture → halt that batch.
- Any vendor or charge table found with schema that doesn't match Surface 7's design assumptions → surface to operator before Batch 1 / Batch 7 plans.

---

## Sign-off

Operator confirms with `[date / time UTC]` once all spot-checks have output captured.
