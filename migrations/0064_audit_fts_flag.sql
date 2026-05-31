-- 0064_audit_fts_flag.sql
-- M7 Batch 6 — Feature flag gating the audit-log full-text (FTS5) search path.
--
-- When 'on', worker/routes/admin/auditLog.js uses the audit_log_fts MATCH query
-- (index from migration 0063); when 'off' (default) it uses the pre-existing
-- target_id/meta_json LIKE scan. Seeded 'off' per the M3/M4 flag-rollout
-- convention — operator flips to 'on' after verifying the index populated and
-- search latency, via:
--   UPDATE feature_flags SET state='on', updated_at=strftime('%s','now')*1000
--   WHERE key='audit_log_fts';
--
-- Matches the feature_flags seed shape from migration 0021 (NOT NULL columns:
-- state, user_opt_in_default, created_at, updated_at).

INSERT OR IGNORE INTO feature_flags
    (key, description, state, user_opt_in_default, role_scope, created_at, updated_at, notes)
VALUES (
    'audit_log_fts',
    'Use the FTS5 full-text index for audit-log search (the q param). Falls back to a LIKE scan when off.',
    'off',
    0,
    NULL,
    strftime('%s','now') * 1000,
    strftime('%s','now') * 1000,
    'Seeded in M7 Batch 6 (migration 0064). Requires migration 0063 (audit_log_fts table). Flip to on after verifying the index.'
);
