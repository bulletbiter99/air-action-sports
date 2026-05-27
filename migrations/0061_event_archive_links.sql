-- 0061_event_archive_links.sql
-- Post-M6 Track C — past-games / event archive (phase 1: external links only).
--
-- One row per archive asset (video or photo gallery) per event. Phase 2 will
-- add storage_key / mime_type / size_bytes for R2-hosted assets, but the
-- kind/url/ordering shape stays stable.
--
-- PRE-MIGRATION SPOT-CHECK (verified 2026-05-27 on remote):
-- - events table exists (M3+ schema)
-- - capabilities table has 'customers.write' / 'staff.write' etc. (M5 capability system)
-- - No table named 'event_archive_links' exists yet
--
-- D1 quirks (per CLAUDE.md):
-- - No BEGIN/COMMIT keywords
-- - Additive CREATE TABLE — no FK-during-DROP issue
-- - Capability + bindings: owner gets explicit grant (post-0031 caps don't
--   auto-grant to owner via the bulk-insert pattern); event_director gets
--   explicit binding per operator decision (see docs/next-session.md Track C).

CREATE TABLE event_archive_links (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('video', 'photo')),
    url             TEXT NOT NULL,
    title           TEXT,
    thumbnail_url   TEXT,
    ordering        INTEGER NOT NULL DEFAULT 0,
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_eal_event_ordering ON event_archive_links(event_id, ordering);
CREATE INDEX idx_eal_kind ON event_archive_links(kind);

-- New capability + bindings.
-- Owner needs an explicit binding because the 0031 bulk-grant only covered
-- caps that existed at that time. Event Director gets access per operator
-- (post-event archive curation fits the ED role naturally).

INSERT INTO capabilities (key, category, description, requires_capability_key, created_at) VALUES
  ('events.archive.write',
   'events',
   'Manage event archive links (YouTube videos + photo gallery URLs) on past events',
   NULL,
   strftime('%s','now') * 1000);

INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('owner',          'events.archive.write', strftime('%s','now') * 1000),
  ('event_director', 'events.archive.write', strftime('%s','now') * 1000);
