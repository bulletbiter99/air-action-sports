# Runbook — Site-Use Agreement (SUA) template management

**Audience:** operator. **Last updated:** Sprint 4 (admin-audit B5).

The SUA library (`site_use_agreement_documents`, migration 0048) holds the
versioned agreement text that field-rental renters sign during a
`kind=agreement` document upload. There is **no management UI** — versions are
managed with the SQL recipes below, run via `wrangler d1 execute --remote`.

## Current state

✅ **Migration 0080 APPLIED to remote 2026-07-28** (operator-authorized). Verified:
`sua_seed_v1_placeholder` is the active version 1, and `body_sha256` was independently
recomputed from `body_html` **as stored in production** — it matches, so the
signature-snapshot integrity contract holds. Agreement uploads no longer 409.

The seeded version 1 is a **PLACEHOLDER whose body opens with a red
NOT-ATTORNEY-REVIEWED banner**. It exists so the agreement-upload flow works
end-to-end; **replace it with counsel-approved text before a real renter signs**
(retire v1 + insert v2 per the recipes below — never UPDATE a live row's body).

## The rules (why the recipes look the way they do)

1. **Versions are immutable. Never `UPDATE` a live row's `body_html`.**
   A signed rental snapshots `sua_body_sha256_snapshot` at signing time —
   rewriting the body a signer agreed to breaks the integrity trail. Publish a
   new version instead.
2. **`body_sha256` must be the hex sha256 of `body_html` exactly as stored.**
   Compute it from the same bytes you insert (recipe below does both).
3. **Exactly one live version at a time.** `fetchLiveSua` takes the newest
   non-retired row by `effective_from`; retire the old row when publishing a
   successor so the library stays unambiguous.

## Recipe — replace the placeholder with attorney-approved text

1. Save the approved agreement body as HTML to a local file, e.g.
   `scripts/sua-v2-body.html` (a `<div>` fragment; headings + paragraphs; no
   scripts).

2. Generate the INSERT with the sha256 computed from the exact bytes:

```bash
node -e "
const fs = require('fs');
const crypto = require('crypto');
const body = fs.readFileSync('scripts/sua-v2-body.html', 'utf8');
const sha = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
const esc = body.replace(/'/g, \"''\");
fs.writeFileSync('scripts/sua-v2-publish.sql', \`
-- Publish SUA version 2 + retire version 1 (audit copy of the applied SQL)
UPDATE site_use_agreement_documents SET retired_at = strftime('%s','now') * 1000
 WHERE retired_at IS NULL;
INSERT INTO site_use_agreement_documents
  (id, version, title, body_html, body_sha256, effective_from, created_at)
VALUES ('sua_v2', 2, 'Site Use Agreement', '\${esc}', '\${sha}',
        strftime('%s','now') * 1000, strftime('%s','now') * 1000);
\`);
console.log('sha256', sha);
"
```

3. Apply it (file, not `--command` — multi-statement write; D1 quirk #4):

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --file=scripts/sua-v2-publish.sql
```

4. Verify exactly one live row remains:

```bash
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT id, version, title, retired_at FROM site_use_agreement_documents ORDER BY version"
```

5. Commit `scripts/sua-v2-body.html` + `scripts/sua-v2-publish.sql` as the
   audit record (house convention for applied D1 data changes).

## Recipe — retire the SUA entirely (no live version)

```sql
UPDATE site_use_agreement_documents SET retired_at = strftime('%s','now') * 1000 WHERE retired_at IS NULL;
```

Agreement uploads then 409 with a pointer back at this runbook until a new
version is inserted. Already-signed rentals are unaffected (their snapshots
reference retired rows by id, which stay in the table forever).

## How signing works (for reference)

`POST /api/admin/field-rentals/:id/documents` with `kind=agreement` requires
`sua_signer_typed_name` / `sua_signer_ip` / `sua_signer_ua` / `sua_signed_at`
and stamps the rental with the live SUA's `id` + `body_sha256` snapshot
(`worker/routes/admin/fieldRentalDocuments.js`). The 409 when no live version
exists is deliberate — an agreement signature with no agreement text behind it
would be worthless.
