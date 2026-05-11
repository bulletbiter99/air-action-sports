-- M5.5 Batch 3 — Migration C: customers.client_type + business_* extensions
--
-- PRE-MIGRATION SPOT-CHECK (2026-05-11; per Lesson #7)
-- ============================================================
-- - customers table has 22 columns on remote (M3-era schema).
-- - None of these 5 new columns exist yet (verified via .schema).
-- - customers row count: 2 (M3 backfill).
-- - All 2 existing rows will have client_type=NULL until B9
--   backfills them to 'individual' and makes the column NOT NULL
--   via the column-rename pattern (D1 quirk #2).
--
-- DESIGN NOTES
-- ============================================================
-- - client_type CHECK constraint allows NULL initially. This is
--   intentional for B3 — the column is added now so subsequent
--   batches (B7 field-rentals backend; B8 admin UI) can reference
--   it, but legacy rows aren't forced to choose 'individual' until
--   B9's backfill verifies them.
-- - business_tax_id stores AES-GCM ciphertext (base64) per
--   worker/lib/personEncryption.js. Storage shape:
--   base64(iv || ciphertext || tag). Read path checks the
--   field_rentals.read.pii capability (capability seed lands in B6).
--   This migration just adds the column; encryption happens at
--   write time in B7's customer-create handler.
-- - business_billing_address: same encryption pattern. Stores a
--   single encrypted blob of the full address (line1 + line2 +
--   city + state + postal + country); structure within the blob
--   is plaintext JSON inside the ciphertext.
-- - business_website is plaintext TEXT — not PII.
-- - business_name is plaintext TEXT — same exposure as legal
--   business name in public-facing documents.
--
-- D1 quirks observed
-- ============================================================
-- - Additive only: ALTER TABLE ADD COLUMN + CREATE INDEX. No
--   table-rebuild; FK-during-DROP not triggered.
-- - No BEGIN/COMMIT.
-- - No email_templates seed; Lesson #7 not applicable.
-- - --json --file vs --command (D1 quirk #4 from M5.5 B2) only
--   affects script behavior, not migration application.

ALTER TABLE customers ADD COLUMN client_type TEXT
  CHECK (client_type IS NULL OR client_type IN ('individual', 'business'));

ALTER TABLE customers ADD COLUMN business_name TEXT;
ALTER TABLE customers ADD COLUMN business_tax_id TEXT;
ALTER TABLE customers ADD COLUMN business_billing_address TEXT;
ALTER TABLE customers ADD COLUMN business_website TEXT;

CREATE INDEX idx_customers_client_type ON customers(client_type);
