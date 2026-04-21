-- Waiver hardening: versioned waiver documents + at-sign snapshot & hash for
-- every signed waiver, plus a distinct e-records consent bit (ESIGN §7001(c)).
--
-- Legal rationale: today the `waivers` row captures who signed and when, but
-- NOT what they signed. If the waiver language is later edited, there is no
-- way to reconstruct the exact terms a past signer agreed to. This migration
-- closes that gap.

CREATE TABLE waiver_documents (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL UNIQUE,
    body_html TEXT NOT NULL,
    body_sha256 TEXT NOT NULL,          -- hex SHA-256 of body_html, computed at seed/insert
    effective_from INTEGER NOT NULL,    -- ms epoch
    retired_at INTEGER,                 -- ms epoch; null = currently live
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_waiver_documents_live ON waiver_documents(retired_at, version);

-- At-sign snapshot columns on the waivers table. body_html_snapshot is the
-- exact text the signer saw; body_sha256 is its hash at that moment; the doc
-- id + version link back for queryability but the snapshot itself is the
-- legally authoritative record (survives doc edits/deletes).
ALTER TABLE waivers ADD COLUMN waiver_document_id TEXT REFERENCES waiver_documents(id);
ALTER TABLE waivers ADD COLUMN waiver_document_version INTEGER;
ALTER TABLE waivers ADD COLUMN body_html_snapshot TEXT;
ALTER TABLE waivers ADD COLUMN body_sha256 TEXT;
ALTER TABLE waivers ADD COLUMN erecords_consent INTEGER NOT NULL DEFAULT 0;

-- Seed v1 = the exact text the Waiver page has served since launch. SHA-256
-- was computed from the canonical single-line HTML form of this ordered list.
-- If you ever update this text, insert a new row with version=2, stamp
-- retired_at on version=1, and deploy the code change together.
INSERT INTO waiver_documents (id, version, body_html, body_sha256, effective_from, created_at)
VALUES (
    'wd_v1',
    1,
    '<ol><li>I understand airsoft involves physical activity and inherent risks including but not limited to bruising, sprains, and eye injury.</li><li>I confirm I will wear mandatory face and eye protection at all times during gameplay.</li><li>I agree to follow all safety rules, marshal instructions, and FPS limits.</li><li>I accept that Air Action Sports, its staff, and site owners are not liable for injuries sustained during gameplay, provided reasonable safety measures are in place.</li><li>I confirm I am physically fit to participate and have no medical conditions that would prevent safe participation.</li><li>I understand that failure to follow safety rules may result in immediate removal from the event without refund.</li></ol>',
    '0d8ee7e9864ad184d083cdbbce58da4a83a6ece79770392706e5324d1af459d7',
    (strftime('%s', 'now') * 1000),
    (strftime('%s', 'now') * 1000)
);

-- Backfill any pre-existing signed waivers to v1. Per HANDOFF §12 the live DB
-- has no signed waivers yet, but this keeps the columns coherent if any exist
-- locally and in any future restore-from-backup scenario. erecords_consent
-- stays 0 for legacy rows to flag them as pre-explicit-consent.
UPDATE waivers
SET waiver_document_id = 'wd_v1',
    waiver_document_version = 1,
    body_html_snapshot = (SELECT body_html FROM waiver_documents WHERE id = 'wd_v1'),
    body_sha256 = (SELECT body_sha256 FROM waiver_documents WHERE id = 'wd_v1')
WHERE waiver_document_id IS NULL;
