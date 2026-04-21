-- Vendor MVP: per-event, per-vendor branded packages accessible via a
-- tokenized magic link (no password). MVP scope is admin-to-vendor one-way
-- delivery (read-only package view, doc downloads, access logging). The v1
-- migration (0012) will layer on categories, templates, e-signature, vendor
-- uploads, and optional password portal.

-- ───── vendors: company-level record ─────
CREATE TABLE vendors (
    id TEXT PRIMARY KEY,                 -- 'vnd_*'
    company_name TEXT NOT NULL,
    tags TEXT,                           -- free-text comma list in MVP; promoted to table in v1
    website TEXT,
    notes TEXT,                          -- internal-only
    coi_expires_on TEXT,                 -- ISO date; nullable
    deleted_at INTEGER,                  -- ms epoch; NULL = active
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_vendors_active ON vendors(deleted_at, company_name);

-- ───── vendor_contacts: people at a vendor ─────
CREATE TABLE vendor_contacts (
    id TEXT PRIMARY KEY,                 -- 'vct_*'
    vendor_id TEXT NOT NULL REFERENCES vendors(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    role TEXT,                           -- 'Owner', 'Ops Lead', etc.
    is_primary INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_vendor_contacts_vendor ON vendor_contacts(vendor_id, deleted_at);
CREATE UNIQUE INDEX idx_vendor_contacts_email ON vendor_contacts(vendor_id, email) WHERE deleted_at IS NULL;

-- ───── event_vendors: the join / package container ─────
-- One row per (event, vendor) pairing. Owns the token version and status
-- machine. Deleting a row cascades to sections, documents, and the access
-- log so revoked packages leave no leaked download vectors.
CREATE TABLE event_vendors (
    id TEXT PRIMARY KEY,                 -- 'evnd_*'
    event_id TEXT NOT NULL REFERENCES events(id),
    vendor_id TEXT NOT NULL REFERENCES vendors(id),
    primary_contact_id TEXT REFERENCES vendor_contacts(id),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'viewed', 'revoked', 'complete')),
    token_version INTEGER NOT NULL DEFAULT 1,  -- bump to invalidate all prior tokens
    token_expires_at INTEGER,            -- ms epoch; default = event end + 30d, set when sent
    sent_at INTEGER,
    first_viewed_at INTEGER,
    last_viewed_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(event_id, vendor_id)
);

CREATE INDEX idx_event_vendors_event ON event_vendors(event_id, status);
CREATE INDEX idx_event_vendors_vendor ON event_vendors(vendor_id);

-- ───── vendor_package_sections: composable content blocks ─────
-- Each section is a titled chunk of sanitized HTML, ordered. MVP kinds are
-- informational only; 'contract' (with signature requirement) lands in v1.
CREATE TABLE vendor_package_sections (
    id TEXT PRIMARY KEY,                 -- 'vps_*'
    event_vendor_id TEXT NOT NULL REFERENCES event_vendors(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
        CHECK (kind IN ('overview', 'schedule', 'map', 'contact', 'custom')),
    title TEXT NOT NULL,
    body_html TEXT,                      -- sanitized on write in the admin API
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_vendor_sections_ev ON vendor_package_sections(event_vendor_id, sort_order);

-- ───── vendor_documents: files attached to a vendor or a package ─────
-- Keys live under R2 prefix 'vendors/...'. Downloads never go through the
-- public /uploads/:key route — they route through /api/vendor/:token/doc/:id
-- which validates the token <-> event_vendor <-> doc chain and writes an
-- access log row.
CREATE TABLE vendor_documents (
    id TEXT PRIMARY KEY,                 -- 'vdoc_*'
    event_vendor_id TEXT REFERENCES event_vendors(id) ON DELETE CASCADE,
    vendor_id TEXT REFERENCES vendors(id),
    r2_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    uploaded_by_user_id TEXT REFERENCES users(id),
    kind TEXT NOT NULL
        CHECK (kind IN ('admin_asset', 'coi', 'w9')),
    created_at INTEGER NOT NULL,
    CHECK ((event_vendor_id IS NOT NULL) OR (vendor_id IS NOT NULL))
);

CREATE INDEX idx_vendor_docs_ev ON vendor_documents(event_vendor_id);
CREATE INDEX idx_vendor_docs_vendor ON vendor_documents(vendor_id);

-- ───── vendor_access_log: every vendor-side action, tamper-audit trail ─────
-- Separate from the global audit_log because it fires on public (tokenized)
-- requests with no user_id and we don't want to pollute the admin audit view.
-- Indexed for "when was this package last opened" lookups.
CREATE TABLE vendor_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_vendor_id TEXT NOT NULL REFERENCES event_vendors(id),
    action TEXT NOT NULL
        CHECK (action IN ('view', 'download_doc')),
    target TEXT,                         -- doc_id for download_doc, NULL for view
    ip TEXT,
    user_agent TEXT,
    token_version INTEGER NOT NULL,      -- version in effect at access time
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_vendor_access_ev ON vendor_access_log(event_vendor_id, created_at DESC);

-- ───── Seed the outbound email template used by the "send package" action ─────
-- Admin edits live content at /admin/settings/email-templates like every other
-- transactional email. Plain-HTML here so it renders in email clients without
-- Handlebars-style interpolation dependencies — variables are replaced by the
-- server at send time.
INSERT INTO email_templates (id, slug, subject, body_html, body_text, variables_json, updated_at, created_at)
VALUES (
    'et_vendor_package_sent',
    'vendor_package_sent',
    'Your vendor package for {{event_title}} is ready',
    '<p>Hi {{contact_name}},</p><p>Your vendor package for <strong>{{event_title}}</strong> on {{event_date}} is ready. Everything you need is in one place — event overview, site map, schedule, and any files we''ve attached.</p><p><a href="{{package_url}}" style="display:inline-block;background:#c65a2a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">View Your Package</a></p><p>This link is private to you — please don''t share it. It expires {{token_expires_display}}.</p><p>Questions? Just reply to this email.</p><p>— Air Action Sports</p>',
    'Hi {{contact_name}},\n\nYour vendor package for {{event_title}} on {{event_date}} is ready.\n\nView it here: {{package_url}}\n\nThis link is private to you — please don''t share it. It expires {{token_expires_display}}.\n\nQuestions? Just reply to this email.\n\n— Air Action Sports',
    '["contact_name","event_title","event_date","package_url","token_expires_display"]',
    (strftime('%s', 'now') * 1000),
    (strftime('%s', 'now') * 1000)
);
