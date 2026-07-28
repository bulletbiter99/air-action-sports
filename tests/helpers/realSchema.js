// Real-schema test harness — builds the production D1 schema in memory.
//
// WHY THIS EXISTS
// ---------------
// tests/helpers/mockD1.js is a SHAPE mock, not a SQL engine: it substring/regex-
// matches the SQL text and returns whatever fixture the test registered,
// regardless of whether the columns being selected actually exist. That is the
// right trade-off for handler tests, but it means a query can reference a
// column that was never migrated and every test still passes while the endpoint
// 500s in production.
//
// That exact failure shipped three times (2026-07 admin workflow audit):
//   * A1 — `SELECT id, rsvp FROM event_staffing` (column is `status`)
//   * A2 — `SELECT p.legal_name, p.ein FROM persons` (neither column exists)
//   * A7 — the event-day HQ staffing counter, same `rsvp` mistake, masked by a
//          silent `.catch()` so it read a permanent 0/0
//
// This helper applies every migrations/*.sql into an in-memory SQLite database
// so tests can `prepare()` the app's real SQL against the real schema. SQLite
// resolves column names at prepare time, so a missing column throws
// "no such column" without needing a single row of fixture data.
//
// NOTE: `db.exec()` runs multi-statement SQL through SQLite's own parser. Do
// NOT replace it with a hand-rolled `split(';')` — the migrations contain
// semicolons inside string literals (email-template HTML carries inline CSS)
// and inside a CREATE TRIGGER ... BEGIN ... END; body (0063).

import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

let cached = null;

/**
 * Migration filenames in apply order.
 *
 * Lexicographic sort matches wrangler's own ordering. Note the repo has a
 * duplicate 0010 prefix (0010_session_version.sql + 0010_vendors.sql) — a known
 * historical red flag recorded in docs/audit/06-do-not-touch.md. They are
 * independent, so either order applies cleanly.
 */
export function migrationFiles() {
    return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * An in-memory SQLite database with every migration applied.
 *
 * Cached per process — building it is ~100ms and the schema is immutable, so
 * every test in the run shares one instance. Treat it as READ-ONLY: prepare
 * statements against it, don't write.
 */
export function getSchemaDb() {
    if (cached) return cached;

    const db = new Database(':memory:');
    for (const file of migrationFiles()) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        try {
            db.exec(sql);
        } catch (err) {
            throw new Error(`migration ${file} failed to apply: ${err.message}`);
        }
    }
    cached = db;
    return db;
}

/**
 * A WRITABLE in-memory database with every migration applied.
 *
 * Deliberately uncached, unlike getSchemaDb(): use this when a test needs to
 * exercise real constraint behaviour — PRIMARY KEY conflicts, CHECK
 * violations, ON CONFLICT clauses — rather than just compile a statement.
 * Each caller gets an isolated instance it may write to freely.
 *
 * Prefer getSchemaDb() for pure compile checks; it is ~100ms cheaper.
 */
export function freshSchemaDb() {
    const db = new Database(':memory:');
    for (const file of migrationFiles()) {
        db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
    return db;
}

/** Column names for a table, in declaration order. */
export function columnsOf(table) {
    return getSchemaDb().prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

/**
 * Assert a SQL statement compiles against the real schema.
 *
 * Rethrows with the label attached so a registry failure names the offending
 * query rather than just echoing SQLite's message.
 */
export function assertPrepares(label, sql) {
    try {
        getSchemaDb().prepare(sql);
    } catch (err) {
        throw new Error(`${label} — does not compile against the real schema: ${err.message}`);
    }
}
