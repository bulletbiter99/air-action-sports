-- Password reset tokens. Single-use, 1-hour TTL.
-- Old tokens auto-invalidated by expires_at check on redemption.

CREATE TABLE password_resets (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL,
    ip_address TEXT
);

CREATE INDEX idx_password_resets_user ON password_resets(user_id);
CREATE INDEX idx_password_resets_expires ON password_resets(expires_at);
