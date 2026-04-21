-- Vendor v1: layers e-signature, vendor-side uploads, optional password
-- portal, and reusable package templates on top of the MVP schema (0010).
--
-- Decisions locked in:
--   - Countersignature is OWNER-ONLY (config enforced in route layer).
--   - Vendor password portal exposes ALL non-revoked event_vendors for any
--     vendor_contact whose email matches — one password unlocks the whole
--     history for that contact.
--   - Vendor-uploaded docs extend the existing `vendor_documents` table with
--     new kinds + an 'uploaded_by_contact_id' column (nullable; the admin
--     upload path continues to use uploaded_by_user_id).

-- ───── vendor_package_templates: reusable starter packages ─────
-- Sections snapshot is JSON array: [{kind, title, body_html, sort_order}, ...]
-- Cloning a template into an event_vendor copies each entry into
-- vendor_package_sections — template edits don't retroactively rewrite
-- packages that were composed from older versions.
CREATE TABLE vendor_package_templates (
    id TEXT PRIMARY KEY,                    -- 'vtpl_*'
    name TEXT NOT NULL,                     -- "Food Truck Package", "Medic Package"
    description TEXT,
    sections_json TEXT NOT NULL,            -- serialized section array
    requires_signature INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_vendor_templates_active ON vendor_package_templates(deleted_at, name);

-- ───── vendor_contract_documents: versioned boilerplate for sign-flow ─────
-- Same pattern as waiver_documents: the live row is `retired_at IS NULL`.
-- Signing snapshots the HTML + hash onto vendor_signatures — past contracts
-- stay pinned even if the live template is superseded.
CREATE TABLE vendor_contract_documents (
    id TEXT PRIMARY KEY,                    -- 'vcd_*'
    version INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,                    -- e.g. "Vendor Operating Agreement v1"
    body_html TEXT NOT NULL,
    body_sha256 TEXT NOT NULL,
    effective_from INTEGER NOT NULL,
    retired_at INTEGER,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_vendor_contracts_live ON vendor_contract_documents(retired_at, version);

-- ───── event_vendors: new signature-related columns ─────
-- contract_required flips on when the package is attached to a template that
-- `requires_signature = 1`. The signed row lives in vendor_signatures.
ALTER TABLE event_vendors ADD COLUMN template_id TEXT REFERENCES vendor_package_templates(id);
ALTER TABLE event_vendors ADD COLUMN contract_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_vendors ADD COLUMN contract_signed_at INTEGER;           -- denormalised for list queries
ALTER TABLE event_vendors ADD COLUMN contract_countersigned_at INTEGER;    -- ditto

-- ───── vendor_signatures: immutable signed-contract record ─────
-- Per (event_vendor, contact) — one vendor contact, one signature per
-- package. At-sign snapshot follows the same ESIGN-compliant pattern as
-- waivers (body + sha256 + IP + UA + typed name + explicit intent + erecords
-- consent). Countersignature is recorded in place when an owner accepts.
CREATE TABLE vendor_signatures (
    id TEXT PRIMARY KEY,                    -- 'vsig_*'
    event_vendor_id TEXT NOT NULL REFERENCES event_vendors(id),
    contact_id TEXT NOT NULL REFERENCES vendor_contacts(id),
    contract_document_id TEXT NOT NULL REFERENCES vendor_contract_documents(id),
    contract_document_version INTEGER NOT NULL,
    body_html_snapshot TEXT NOT NULL,       -- exact HTML the signer saw
    body_sha256 TEXT NOT NULL,              -- hash of body_html_snapshot at sign time
    typed_name TEXT NOT NULL,
    erecords_consent INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    user_agent TEXT,
    token_version INTEGER NOT NULL,         -- which magic-link version was used
    signed_at INTEGER NOT NULL,
    countersigned_by_user_id TEXT REFERENCES users(id),    -- owner role only
    countersigned_at INTEGER,
    UNIQUE(event_vendor_id)                 -- one fully-signed contract per package
);

CREATE INDEX idx_vendor_signatures_ev ON vendor_signatures(event_vendor_id);
CREATE INDEX idx_vendor_signatures_contact ON vendor_signatures(contact_id);

-- ───── vendor_documents: vendor-side uploads ─────
-- Extend kind with vendor-originated types and track the contact who
-- uploaded (NULL when an admin uploaded via the existing admin endpoint).
-- Can't add a CHECK constraint via ALTER in SQLite, so we re-enforce kinds
-- in the route layer instead. Valid set becomes:
--   admin_asset, coi, w9, vendor_return
ALTER TABLE vendor_documents ADD COLUMN uploaded_by_contact_id TEXT REFERENCES vendor_contacts(id);

-- ───── vendor_contacts: optional password portal ─────
-- NULL until the contact opts in via the magic-link CTA ("Save your login").
-- PBKDF2-SHA256 via existing worker/lib/password.js. session_version matches
-- the admin users pattern — bump to invalidate active cookies.
ALTER TABLE vendor_contacts ADD COLUMN password_hash TEXT;
ALTER TABLE vendor_contacts ADD COLUMN password_updated_at INTEGER;
ALTER TABLE vendor_contacts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendor_contacts ADD COLUMN last_login_at INTEGER;

-- ───── vendors: COI reminder idempotency ─────
-- Matches the bookings.reminder_sent_at pattern. Cron sweep in worker/index.js
-- will stamp these when the respective reminder fires so we don't double-send.
ALTER TABLE vendors ADD COLUMN coi_reminder_30d_sent_at INTEGER;
ALTER TABLE vendors ADD COLUMN coi_reminder_7d_sent_at INTEGER;

-- ───── event_vendors: package reminder idempotency ─────
-- 7-days-before-event "have you opened this yet?" reminder. Only fires if
-- status is 'sent' (i.e. not yet viewed).
ALTER TABLE event_vendors ADD COLUMN package_reminder_sent_at INTEGER;
-- 14-days-before-event "please sign the contract" reminder. Only fires when
-- contract_required = 1 AND contract_signed_at IS NULL.
ALTER TABLE event_vendors ADD COLUMN signature_reminder_sent_at INTEGER;

-- ───── Seed the v1 email templates ─────
-- Each template is editable at /admin/settings/email-templates. Variables
-- are replaced by the Worker at send time using the existing templates lib.
INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at)
VALUES
('et_vendor_package_reminder', 'vendor_package_reminder',
 'Reminder — your package for {{event_title}}',
 '<p>Hi {{contact_name}},</p><p>Just a heads up — you haven''t opened the vendor package for <strong>{{event_title}}</strong> yet and the event is coming up on {{event_date}}.</p><p><a href="{{package_url}}" style="display:inline-block;background:#c65a2a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">Open Your Package</a></p><p>— Air Action Sports</p>',
 'Hi {{contact_name}},\n\nYou haven''t opened the vendor package for {{event_title}} yet — the event is on {{event_date}}.\n\nOpen it: {{package_url}}\n\n— Air Action Sports',
 '["contact_name","event_title","event_date","package_url"]',
 (strftime('%s', 'now') * 1000), (strftime('%s', 'now') * 1000)),

('et_vendor_signature_requested', 'vendor_signature_requested',
 'Signature needed — {{event_title}} vendor agreement',
 '<p>Hi {{contact_name}},</p><p>Your vendor package for <strong>{{event_title}}</strong> on {{event_date}} includes an operating agreement that needs your signature. The event is coming up and we''d like to have it finalised.</p><p><a href="{{package_url}}" style="display:inline-block;background:#c65a2a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">Review & Sign</a></p><p>— Air Action Sports</p>',
 'Hi {{contact_name}},\n\nYour package for {{event_title}} on {{event_date}} includes an agreement that needs your signature.\n\nReview and sign: {{package_url}}\n\n— Air Action Sports',
 '["contact_name","event_title","event_date","package_url"]',
 (strftime('%s', 'now') * 1000), (strftime('%s', 'now') * 1000)),

('et_vendor_countersigned', 'vendor_countersigned',
 'Fully executed — {{event_title}} vendor agreement',
 '<p>Hi {{contact_name}},</p><p>Your operating agreement for <strong>{{event_title}}</strong> has been countersigned by Air Action Sports. You''re all set.</p><p>A PDF copy of the fully-executed agreement is attached. You can also re-open your package to review any updates.</p><p><a href="{{package_url}}" style="display:inline-block;background:#c65a2a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">View Package</a></p><p>— Air Action Sports</p>',
 'Hi {{contact_name}},\n\nYour agreement for {{event_title}} has been countersigned. A PDF copy is attached.\n\nView package: {{package_url}}\n\n— Air Action Sports',
 '["contact_name","event_title","package_url"]',
 (strftime('%s', 'now') * 1000), (strftime('%s', 'now') * 1000)),

('et_vendor_coi_expiring', 'vendor_coi_expiring',
 'COI expiring — please send a fresh copy',
 '<p>Hi {{contact_name}},</p><p>Our records show your certificate of insurance for <strong>{{company_name}}</strong> expires on {{coi_expires_on}} ({{days_left}} days). Please send an updated COI at your earliest convenience — we can''t have you on site without current coverage.</p><p>— Air Action Sports</p>',
 'Hi {{contact_name}},\n\nYour COI for {{company_name}} expires {{coi_expires_on}} ({{days_left}} days). Please send an updated copy.\n\n— Air Action Sports',
 '["contact_name","company_name","coi_expires_on","days_left"]',
 (strftime('%s', 'now') * 1000), (strftime('%s', 'now') * 1000)),

('et_vendor_package_updated', 'vendor_package_updated',
 'Updated — your package for {{event_title}}',
 '<p>Hi {{contact_name}},</p><p>We''ve updated your vendor package for <strong>{{event_title}}</strong>. Open it to see what''s changed.</p><p><a href="{{package_url}}" style="display:inline-block;background:#c65a2a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">Open Your Package</a></p><p>— Air Action Sports</p>',
 'Hi {{contact_name}},\n\nYour package for {{event_title}} has been updated: {{package_url}}\n\n— Air Action Sports',
 '["contact_name","event_title","package_url"]',
 (strftime('%s', 'now') * 1000), (strftime('%s', 'now') * 1000)),

('et_admin_vendor_return', 'admin_vendor_return',
 '{{vendor_company}} uploaded a file',
 '<p>Heads up — <strong>{{vendor_company}}</strong> just uploaded a <em>{{doc_kind}}</em> ({{filename}}) for the {{event_title}} package.</p><p><a href="{{admin_url}}">Open the package in admin</a></p>',
 '{{vendor_company}} uploaded a {{doc_kind}} ({{filename}}) for {{event_title}}: {{admin_url}}',
 '["vendor_company","doc_kind","filename","event_title","admin_url"]',
 (strftime('%s', 'now') * 1000), (strftime('%s', 'now') * 1000));
