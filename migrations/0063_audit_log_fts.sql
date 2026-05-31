-- 0063_audit_log_fts.sql
-- M7 Batch 6 — Full-text search index over audit_log (FTS5).
--
-- Adds an external-content FTS5 virtual table mirroring audit_log's searchable
-- text columns (action, target_type, target_id, meta_json), kept in sync by an
-- AFTER INSERT trigger. audit_log is INSERT-only by design (no UPDATE/DELETE),
-- so a single insert trigger is sufficient — no delete/update triggers needed.
--
-- worker/routes/admin/auditLog.js uses, when the audit_log_fts feature flag
-- (seeded in 0064) is enabled:
--     ... JOIN audit_log_fts fts ON fts.rowid = al.id WHERE audit_log_fts MATCH ?
-- Otherwise it falls back to the pre-existing target_id/meta_json LIKE scan, so
-- this index is purely additive and safe to apply ahead of flipping the flag.
--
-- D1 / wrangler notes:
-- - No BEGIN/COMMIT control keywords here (D1 quirk #1). The trigger body's
--   BEGIN...END is the trigger delimiter, not a control statement.
-- - First FTS5 virtual table + trigger in this project. D1 (SQLite) supports both.
-- - The final 'rebuild' insert backfills the index from existing audit_log rows
--   (the trigger only catches future inserts).

CREATE VIRTUAL TABLE audit_log_fts USING fts5(
  action,
  target_type,
  target_id,
  meta_json,
  content='audit_log',
  content_rowid='id'
);

CREATE TRIGGER audit_log_fts_ai AFTER INSERT ON audit_log BEGIN
  INSERT INTO audit_log_fts(rowid, action, target_type, target_id, meta_json)
  VALUES (new.id, new.action, new.target_type, new.target_id, new.meta_json);
END;

INSERT INTO audit_log_fts(audit_log_fts) VALUES('rebuild');
