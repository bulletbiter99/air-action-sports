-- Session-invalidation counter. Included in session cookie payload ('sv') and
-- checked on every authenticated request. Incremented on password change,
-- password reset, and logout, so any previously-issued cookie for that user
-- becomes invalid on the next request.
--
-- This closes SECURITY_AUDIT.md MED-9 (password change doesn't invalidate
-- existing sessions) and MED-10 (logout is client-only, cookie still valid
-- until TTL).

ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
