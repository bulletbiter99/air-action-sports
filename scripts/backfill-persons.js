#!/usr/bin/env node
//
// M5 Batch 3 — persons backfill from users.
//
// Iterates the users table, creates a persons row per user (one-to-one
// via persons.user_id), and assigns a primary role through person_roles
// using the legacy users.role mapping:
//   owner   -> role_event_director         (closest org-chart match)
//   manager -> role_booking_coordinator    (most generic Tier-1 op default)
//   staff   -> role_check_in_staff         (most common Tier-3 default)
//
// Idempotent: re-running detects existing persons rows by user_id and
// skips creation. The audit trail (`person.created_via_backfill`) is
// emitted only for net-new rows, not on re-runs.
//
// Usage:
//   node scripts/backfill-persons.js --local             # apply to local D1
//   node scripts/backfill-persons.js --remote            # apply to remote D1
//   node scripts/backfill-persons.js --local --dry-run   # print plan, no writes
//
// Operator runs --remote AFTER migrations 0030 + 0032 are applied to
// remote and after this PR merges. Until then, --local only against the
// local D1 fixture managed by scripts/setup-local-d1.sh.

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DB = 'air-action-sports-db';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ────────────────────────────────────────────────────────────────────
// Pure helpers — no I/O. Exported for unit tests.
// ────────────────────────────────────────────────────────────────────

/**
 * Maps a legacy users.role to the role catalog ID used as the
 * person_roles primary role for the backfilled persons row.
 *
 * Returns null for unknown roles; caller should flag for operator
 * review rather than auto-assign.
 *
 * @param {string|null|undefined} legacyRole
 * @returns {string|null}
 */
export function legacyRoleToPersonRoleId(legacyRole) {
    if (!legacyRole) return null;
    switch (legacyRole) {
        case 'owner':
            return 'role_event_director';
        case 'manager':
            return 'role_booking_coordinator';
        case 'staff':
            return 'role_check_in_staff';
        default:
            return null;
    }
}

/**
 * Generates a random 12-char alphanumeric ID with a given prefix.
 * Same pattern as the rest of the codebase (worker/lib/ids.js).
 *
 * @param {string} prefix
 * @returns {string}
 */
export function randomId(prefix) {
    const bytes = randomBytes(12);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return `${prefix}_${out}`;
}

/**
 * Plans the backfill operation given a list of users + a list of
 * existing persons rows. Returns a structured plan describing what
 * would be created, skipped, or flagged for operator review.
 *
 * Pure — no I/O, no DB calls. The caller (or a test) feeds in the
 * arrays and inspects the plan.
 *
 * @param {Array<{id: string, role: string, email: string, display_name: string, created_at: number}>} users
 * @param {Array<{user_id: string}>} existingPersons
 * @returns {{ toCreate: object[], toSkip: object[], toFlag: object[] }}
 */
export function planBackfill(users, existingPersons) {
    const existingUserIds = new Set(existingPersons.map((p) => p.user_id));
    const toCreate = [];
    const toSkip = [];
    const toFlag = [];

    for (const u of users) {
        if (existingUserIds.has(u.id)) {
            toSkip.push({ user_id: u.id, reason: 'already_has_person' });
            continue;
        }

        const roleId = legacyRoleToPersonRoleId(u.role);
        if (!roleId) {
            toFlag.push({ user_id: u.id, reason: 'unknown_legacy_role', role: u.role });
            continue;
        }

        toCreate.push({
            person_id: randomId('prs'),
            person_role_id: randomId('pr'),
            user_id: u.id,
            full_name: u.display_name || u.email || u.id,
            email: u.email,
            role_id: roleId,
            now: Date.now(),
            created_at: u.created_at || Date.now(),
        });
    }

    return { toCreate, toSkip, toFlag };
}

// ────────────────────────────────────────────────────────────────────
// CLI / wrangler integration — only runs when invoked as a script.
// ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
    const args = process.argv.slice(2);
    const localFlag = args.includes('--local');
    const remoteFlag = args.includes('--remote');
    const dryRun = args.includes('--dry-run');

    if (!localFlag && !remoteFlag) {
        console.error('Usage: node scripts/backfill-persons.js --local|--remote [--dry-run]');
        process.exit(2);
    }
    if (localFlag && remoteFlag) {
        console.error('Pick one of --local or --remote.');
        process.exit(2);
    }

    const target = localFlag ? '--local' : '--remote';

    console.log(`[backfill-persons] target=${target} dry-run=${dryRun}`);

    // Build a single SQL file with all the planning queries upfront, then
    // execute statements one by one. The wrangler stdout JSON parsing is
    // brittle — we strip everything before first '[' or '{' (M3 D1 quirk).

    function exec(sql, kind = 'query') {
        const tmpFile = join(tmpdir(), `aas-backfill-persons-${randomBytes(4).toString('hex')}.sql`);
        writeFileSync(tmpFile, sql);
        try {
            const cmd = `npx wrangler d1 execute ${DB} ${target} --json --file=${tmpFile}`;
            const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
            // M3 D1 quirk: strip upload-progress UI chars before JSON
            const idxBracket = stdout.search(/[[{]/);
            if (idxBracket === -1) return null;
            const jsonStr = stdout.slice(idxBracket);
            return JSON.parse(jsonStr);
        } finally {
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    }

    const usersResult = exec('SELECT id, role, email, display_name, created_at FROM users;');
    const users = usersResult?.[0]?.results || [];

    const personsResult = exec('SELECT user_id FROM persons WHERE user_id IS NOT NULL;');
    const existingPersons = personsResult?.[0]?.results || [];

    const plan = planBackfill(users, existingPersons);

    console.log(`[backfill-persons] users=${users.length} existing=${existingPersons.length} create=${plan.toCreate.length} skip=${plan.toSkip.length} flag=${plan.toFlag.length}`);

    if (plan.toFlag.length > 0) {
        console.warn('[backfill-persons] FLAGS — these users have an unknown legacy role and will not be backfilled:');
        for (const f of plan.toFlag) {
            console.warn(`  - user ${f.user_id} role=${f.role}`);
        }
    }

    if (dryRun) {
        console.log('[backfill-persons] dry-run; no writes issued. Plan summary:');
        for (const c of plan.toCreate) {
            console.log(`  CREATE person=${c.person_id} user_id=${c.user_id} primary_role=${c.role_id}`);
        }
        process.exit(0);
    }

    let created = 0;
    for (const c of plan.toCreate) {
        const sqlBatch = `
INSERT INTO persons (id, user_id, full_name, email, status, created_at, updated_at)
  VALUES ('${c.person_id}', '${c.user_id}', ${escapeSql(c.full_name)}, ${escapeSql(c.email)}, 'active', ${c.created_at}, ${c.now});

INSERT INTO person_roles (id, person_id, role_id, is_primary, effective_from, created_at)
  VALUES ('${c.person_role_id}', '${c.person_id}', '${c.role_id}', 1, ${c.now}, ${c.now});

INSERT INTO audit_log (id, action, actor_user_id, target_type, target_id, meta, created_at)
  VALUES ('${randomId('al')}', 'person.created_via_backfill', NULL, 'person', '${c.person_id}',
          ${escapeSql(JSON.stringify({ user_id: c.user_id, primary_role: c.role_id }))}, ${c.now});
`;
        try {
            exec(sqlBatch, 'mutation');
            created += 1;
            console.log(`  [+] person=${c.person_id} user_id=${c.user_id} primary_role=${c.role_id}`);
        } catch (err) {
            console.error(`  [!] failed for user_id=${c.user_id}: ${err.message}`);
        }
    }

    console.log(`[backfill-persons] done. created=${created} skipped=${plan.toSkip.length} flagged=${plan.toFlag.length}`);
}

function escapeSql(value) {
    if (value === null || value === undefined) return 'NULL';
    return `'${String(value).replace(/'/g, "''")}'`;
}
