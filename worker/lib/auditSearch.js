// M7 Batch 6 — Audit-log full-text search query builder.
//
// Turns raw operator search input into a safe FTS5 MATCH expression for the
// audit_log_fts index (migration 0063). User input must NEVER be interpolated
// into a MATCH string verbatim — FTS5 has its own query grammar (AND/OR/NOT/
// NEAR, double quotes, parentheses, *, ^, :) and malformed input throws a
// query error.
//
// Strategy: split on whitespace; per token, keep only word-ish characters
// ([a-zA-Z0-9@._-] — covers ids like cus_123 and emails like a@b.com); drop
// tokens with no alphanumeric content; wrap each surviving token in double
// quotes (neutralizing any operator meaning) and append a prefix '*' so partial
// matches work ("refu" matches "refund"). Tokens are space-joined → implicit
// AND. Returns null when nothing usable, signalling the caller to fall back to
// the pre-existing LIKE scan.
//
// Pure (no I/O) — used by worker/routes/admin/auditLog.js; unit-tested in
// tests/unit/lib/auditSearch.test.js.

export function buildFtsMatchQuery(q) {
    if (q === null || q === undefined) return null;
    const tokens = String(q)
        .split(/\s+/)
        .map((t) => t.replace(/[^a-zA-Z0-9@._-]/g, ''))
        .filter((t) => /[a-zA-Z0-9]/.test(t));
    if (tokens.length === 0) return null;
    return tokens.map((t) => `"${t}"*`).join(' ');
}
