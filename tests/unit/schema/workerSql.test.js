// Real-schema guard — every static SQL literal in worker/ must compile
// against the actual production schema.
//
// THE BUG CLASS THIS CATCHES
// -------------------------
// tests/helpers/mockD1.js matches SQL by substring/regex and returns whatever
// fixture the test registered — it never checks that the columns exist. So a
// query referencing a column that was never migrated passes every unit test and
// 500s in production. The 2026-07 admin workflow audit found three of these
// (A1 event_staffing.rsvp, A2 persons.legal_name/ein, A7 the HQ staffing
// counter); building this guard immediately surfaced three more, including
// `UPDATE bookings SET ... updated_at = ?` in the nightly Stripe fee sync,
// which had silently captured 0 fees across 74 paid bookings for a month.
//
// HOW IT WORKS
// ------------
// tests/helpers/realSchema.js applies every migrations/*.sql into an in-memory
// SQLite database. SQLite resolves column names at prepare() time, so simply
// preparing a statement proves it references only real columns — no fixture
// rows required.
//
// SCOPE / KNOWN GAPS
// ------------------
// Only *static* SQL is checked. Statements built with `${}` interpolation
// (~100 of them: dynamic column lists, sentinel-column sweeps, filter builders)
// are skipped because the literal isn't valid SQL on its own. Semantics are not
// checked either — a query can compile and still be wrong (e.g. comparing
// against a value the CHECK constraint forbids). This guard is about the
// does-this-column-exist class specifically.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSchemaDb } from '../../helpers/realSchema.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WORKER_DIR = join(REPO_ROOT, 'worker');

// A literal must START with a DML/CTE keyword and also contain a structural
// keyword. The second test is what rejects bare strings like the HTTP method
// 'DELETE' or a Hono route's 'select', which would otherwise be extracted and
// fail with "incomplete input".
const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const SQL_BODY = /\b(FROM|INTO|SET|VALUES)\b/i;

/**
 * Statements that do NOT compile and are deliberately not fixed here.
 *
 * Each entry MUST carry a reason. The suite asserts every allowlisted statement
 * still fails — so when one gets fixed, this list forces you to delete the
 * entry rather than leaving stale cover behind for the next regression.
 */
const ALLOWED_FAILURES = [
    {
        file: 'worker/lib/laborEntries.js',
        match: 'UPDATE persons SET lifetime_pay_cents',
        reason: 'Intentional forward-compat write. recomputePersonAggregates() computes the '
            + 'values for its caller and attempts the denormalized write inside an explicit '
            + 'try/catch, documented as a no-op until a future migration adds the columns.',
    },
    {
        file: 'worker/routes/event-day/checkin.js',
        match: 'FROM attendees WHERE id = ?',
        reason: 'attendees has no event_id column — the check-in and check-out lookups read one '
            + '(the code even comments that it "may be null pre-M3"). Both need to join bookings '
            + 'for the event, which rewrites 11 mockD1 regexes in '
            + 'tests/unit/event-day/checkin/route.test.js; split into its own PR to stay under '
            + 'the 10-file cap. Unreachable today — the kiosk has never opened a session.',
    },
    {
        file: 'worker/lib/thresholds1099.js',
        match: 'SELECT le.person_id, p.full_name, p.email, p.legal_name, p.ein',
        reason: 'Audit finding A2 — persons.legal_name / persons.ein were never migrated, so '
            + 'the 1099 report, its CSV export and the nightly W-9 sweep all fail. Fixed in the '
            + 'Sprint 2 PR that adds migration 0078; both statements come off this list there.',
    },
];

function walkJs(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walkJs(full, out);
        else if (entry.endsWith('.js')) out.push(full);
    }
    return out;
}

/** Every static SQL literal in worker/, as { file, sql }. */
function collectStatements() {
    const found = [];
    for (const fullPath of walkJs(WORKER_DIR)) {
        const file = relative(REPO_ROOT, fullPath).split(sep).join('/');
        const src = readFileSync(fullPath, 'utf8');
        const literals = [
            ...(src.match(/`[^`]*`/g) || []),
            ...(src.match(/'(?:[^'\\\n]|\\.)*'/g) || []),
            ...(src.match(/"(?:[^"\\\n]|\\.)*"/g) || []),
        ].map((lit) => lit.slice(1, -1));

        for (const sql of literals) {
            if (sql.includes('${')) continue; // interpolated — not valid SQL standalone
            if (!SQL_START.test(sql) || !SQL_BODY.test(sql)) continue;
            found.push({ file, sql });
        }
    }
    return found;
}

const statements = collectStatements();

function allowanceFor({ file, sql }) {
    return ALLOWED_FAILURES.find((a) => a.file === file && sql.includes(a.match));
}

function prepareError(sql) {
    try {
        getSchemaDb().prepare(sql);
        return null;
    } catch (err) {
        return err.message;
    }
}

describe('worker SQL compiles against the real D1 schema', () => {
    it('extracts a plausible number of statements', () => {
        // Guards the guard: if the extractor silently stops matching, every
        // other assertion below would pass vacuously.
        expect(statements.length).toBeGreaterThan(600);
    });

    it('every static statement prepares, except documented allowances', () => {
        const unexpected = [];
        for (const stmt of statements) {
            if (allowanceFor(stmt)) continue;
            const error = prepareError(stmt.sql);
            if (error) {
                unexpected.push(`${stmt.file}: ${error}\n    ${stmt.sql.replace(/\s+/g, ' ').slice(0, 120)}`);
            }
        }
        expect(unexpected).toEqual([]);
    });

    it('every allowlisted statement still fails (no stale allowances)', () => {
        const stale = [];
        for (const allowance of ALLOWED_FAILURES) {
            const matching = statements.filter(
                (s) => s.file === allowance.file && s.sql.includes(allowance.match),
            );
            if (matching.length === 0) {
                stale.push(`${allowance.file}: no statement matches "${allowance.match}" — remove this allowance`);
                continue;
            }
            if (matching.every((s) => prepareError(s.sql) === null)) {
                stale.push(`${allowance.file}: "${allowance.match}" now compiles — remove this allowance`);
            }
        }
        expect(stale).toEqual([]);
    });
});

describe('schema facts the app depends on', () => {
    // Narrow pins for the columns whose absence caused the bugs above, so a
    // future migration that drops one fails loudly here rather than silently in
    // a nightly cron.
    it('bookings carries the Stripe fee-capture columns and has no updated_at', () => {
        const db = getSchemaDb();
        const cols = db.prepare('PRAGMA table_info(bookings)').all().map((r) => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'stripe_fee_cents', 'stripe_net_cents', 'stripe_balance_transaction_id',
        ]));
        // bookings is created_at/paid_at-stamped only. Writing updated_at is what
        // broke runStripeFeeSync for a month.
        expect(cols).not.toContain('updated_at');
    });

    it('event_staffing tracks RSVP state in `status`, not `rsvp`', () => {
        const cols = getSchemaDb().prepare('PRAGMA table_info(event_staffing)').all().map((r) => r.name);
        expect(cols).toContain('status');
        expect(cols).not.toContain('rsvp');
    });

    it('customers stores the contact name in `name`', () => {
        const cols = getSchemaDb().prepare('PRAGMA table_info(customers)').all().map((r) => r.name);
        expect(cols).toContain('name');
        expect(cols).not.toContain('full_name');
    });
});
