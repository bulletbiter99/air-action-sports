#!/usr/bin/env node
//
// M5.5 Batch 2 — sites + site_fields seed script.
//
// Inserts Ghost Town and Foxtrot site rows (one field per site, per
// operator clarification 2026-05-11: each is its own field at its own
// geographic location). Idempotent — checks for existing rows by slug
// before inserting, so re-runs are no-ops.
//
// Usage:
//   node scripts/seed-sites.js --local            # apply to local D1
//   node scripts/seed-sites.js --remote           # apply to remote D1
//   node scripts/seed-sites.js --local --dry-run  # print plan, no writes
//
// Requires migration 0044 (sites schema) to be applied first.
//
// Operator runs --remote AFTER this PR merges to milestone branch and
// milestone branch merges to main. Migration 0044 was already applied
// to remote during B1 plan-mode (operator authorized).

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DB = 'air-action-sports-db';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ────────────────────────────────────────────────────────────────────
// Seed data — operator-confirmed per M5.5 Batch 2 plan
// ────────────────────────────────────────────────────────────────────

export const SEED_SITES = [
    {
        slug: 'ghost-town',
        name: 'Ghost Town',
        address: null,
        city: 'Hiawatha',
        state: 'UT',
        postal_code: '84545',
        total_acreage: null,
        notes: null,
        default_arrival_buffer_minutes: 30,
        default_cleanup_buffer_minutes: 30,
        default_blackout_window: null,
        fields: [
            {
                slug: 'ghost-town',
                name: 'Ghost Town',
                approximate_acreage: null,
                notes: null,
            },
        ],
    },
    {
        slug: 'foxtrot',
        name: 'Foxtrot',
        address: null,
        city: 'Kaysville',
        state: 'UT',
        postal_code: '84037',
        total_acreage: null,
        notes: null,
        default_arrival_buffer_minutes: 30,
        default_cleanup_buffer_minutes: 30,
        default_blackout_window: null,
        fields: [
            {
                slug: 'foxtrot',
                name: 'Foxtrot',
                approximate_acreage: null,
                notes: null,
            },
        ],
    },
];

// ────────────────────────────────────────────────────────────────────
// Pure helpers — no I/O. Exported for unit tests.
// ────────────────────────────────────────────────────────────────────

/**
 * Generate a site_<random12> ID. Uses Node crypto.randomBytes for
 * non-Worker contexts (the script runs in Node, not a Worker).
 */
export function makeSiteId() {
    return `site_${randomString(12)}`;
}

export function makeFieldId() {
    return `fld_${randomString(12)}`;
}

function randomString(len) {
    const bytes = randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
}

/**
 * SQL string escape — doubles single quotes. Use for inline values.
 * Returns 'NULL' for null/undefined.
 */
export function escapeSqlString(value) {
    if (value === null || value === undefined) return 'NULL';
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Given the current state of sites + site_fields tables, builds a
 * plan describing which rows need to be inserted. Plan items are
 * objects like:
 *   { kind: 'insert_site', site_slug, site_id, payload }
 *   { kind: 'insert_field', site_slug, site_id, field_slug, field_id, payload }
 *   { kind: 'skip_site_exists', site_slug, existing_id }
 *   { kind: 'skip_field_exists', site_slug, field_slug, existing_id }
 *
 * @param existingSites Array<{id, slug}> from sites table
 * @param existingFields Array<{id, site_id, slug}> from site_fields table
 * @param seedData defaults to SEED_SITES; injectable for tests
 */
export function buildSeedPlan(existingSites, existingFields, seedData = SEED_SITES) {
    const plan = [];
    const sitesBySlug = new Map();
    for (const s of existingSites) sitesBySlug.set(s.slug, s);

    const fieldsBySiteAndSlug = new Map();
    for (const f of existingFields) {
        const key = `${f.site_id}|${f.slug}`;
        fieldsBySiteAndSlug.set(key, f);
    }

    for (const seedSite of seedData) {
        let siteId;
        const existing = sitesBySlug.get(seedSite.slug);
        if (existing) {
            plan.push({
                kind: 'skip_site_exists',
                site_slug: seedSite.slug,
                existing_id: existing.id,
            });
            siteId = existing.id;
        } else {
            siteId = makeSiteId();
            plan.push({
                kind: 'insert_site',
                site_slug: seedSite.slug,
                site_id: siteId,
                payload: {
                    id: siteId,
                    slug: seedSite.slug,
                    name: seedSite.name,
                    address: seedSite.address,
                    city: seedSite.city,
                    state: seedSite.state,
                    postal_code: seedSite.postal_code,
                    total_acreage: seedSite.total_acreage,
                    notes: seedSite.notes,
                    default_arrival_buffer_minutes: seedSite.default_arrival_buffer_minutes,
                    default_cleanup_buffer_minutes: seedSite.default_cleanup_buffer_minutes,
                    default_blackout_window: seedSite.default_blackout_window,
                },
            });
        }

        for (const seedField of seedSite.fields) {
            const fieldKey = `${siteId}|${seedField.slug}`;
            const existingField = fieldsBySiteAndSlug.get(fieldKey);
            if (existingField) {
                plan.push({
                    kind: 'skip_field_exists',
                    site_slug: seedSite.slug,
                    field_slug: seedField.slug,
                    existing_id: existingField.id,
                });
            } else {
                const fieldId = makeFieldId();
                plan.push({
                    kind: 'insert_field',
                    site_slug: seedSite.slug,
                    site_id: siteId,
                    field_slug: seedField.slug,
                    field_id: fieldId,
                    payload: {
                        id: fieldId,
                        site_id: siteId,
                        slug: seedField.slug,
                        name: seedField.name,
                        approximate_acreage: seedField.approximate_acreage,
                        notes: seedField.notes,
                    },
                });
            }
        }
    }

    return plan;
}

/**
 * Converts a plan into an ordered array of SQL statement strings.
 * @param plan Output of buildSeedPlan
 * @param now Current epoch ms (injectable for deterministic tests)
 */
export function planToSql(plan, now) {
    const sql = [];

    for (const op of plan) {
        if (op.kind === 'insert_site') {
            const p = op.payload;
            sql.push(
                `INSERT INTO sites (id, slug, name, address, city, state, postal_code, total_acreage, notes, active, archived_at, default_arrival_buffer_minutes, default_cleanup_buffer_minutes, default_blackout_window, created_at, updated_at) VALUES (` +
                    [
                        escapeSqlString(p.id),
                        escapeSqlString(p.slug),
                        escapeSqlString(p.name),
                        escapeSqlString(p.address),
                        escapeSqlString(p.city),
                        escapeSqlString(p.state),
                        escapeSqlString(p.postal_code),
                        p.total_acreage === null ? 'NULL' : String(p.total_acreage),
                        escapeSqlString(p.notes),
                        '1',
                        'NULL',
                        String(p.default_arrival_buffer_minutes),
                        String(p.default_cleanup_buffer_minutes),
                        escapeSqlString(p.default_blackout_window),
                        String(now),
                        String(now),
                    ].join(', ') +
                    `);`,
            );
            // Audit log
            sql.push(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at) VALUES (` +
                    [
                        'NULL',
                        `'site.created'`,
                        `'site'`,
                        escapeSqlString(p.id),
                        escapeSqlString(JSON.stringify({ slug: p.slug, source: 'seed-sites' })),
                        String(now),
                    ].join(', ') +
                    `);`,
            );
        } else if (op.kind === 'insert_field') {
            const p = op.payload;
            sql.push(
                `INSERT INTO site_fields (id, site_id, slug, name, approximate_acreage, notes, active, archived_at, created_at) VALUES (` +
                    [
                        escapeSqlString(p.id),
                        escapeSqlString(p.site_id),
                        escapeSqlString(p.slug),
                        escapeSqlString(p.name),
                        p.approximate_acreage === null ? 'NULL' : String(p.approximate_acreage),
                        escapeSqlString(p.notes),
                        '1',
                        'NULL',
                        String(now),
                    ].join(', ') +
                    `);`,
            );
            sql.push(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at) VALUES (` +
                    [
                        'NULL',
                        `'site_field.created'`,
                        `'site_field'`,
                        escapeSqlString(p.id),
                        escapeSqlString(
                            JSON.stringify({
                                site_id: p.site_id,
                                slug: p.slug,
                                source: 'seed-sites',
                            }),
                        ),
                        String(now),
                    ].join(', ') +
                    `);`,
            );
        }
        // skip_* ops produce no SQL
    }

    return sql;
}

/**
 * Produce a 1-line summary per plan item, for human-readable output.
 */
export function planToHumanSummary(plan) {
    return plan.map((op) => {
        switch (op.kind) {
            case 'insert_site':
                return `+ site ${op.site_slug} (${op.site_id})`;
            case 'insert_field':
                return `+ field ${op.field_slug} on ${op.site_slug} (${op.field_id})`;
            case 'skip_site_exists':
                return `· site ${op.site_slug} already exists (${op.existing_id})`;
            case 'skip_field_exists':
                return `· field ${op.field_slug} on ${op.site_slug} already exists (${op.existing_id})`;
            default:
                return `? unknown plan op: ${JSON.stringify(op)}`;
        }
    });
}

// ────────────────────────────────────────────────────────────────────
// CLI — I/O paths. Not unit tested; exercised manually by the
// operator and during local D1 verification.
// ────────────────────────────────────────────────────────────────────

function wranglerExecute(envFlag, sql) {
    // For multi-statement writes. Uses --file because --command can't
    // handle multi-statement SQL reliably.
    // wrangler --remote --json --file emits upload-progress UI chars
    // before the JSON payload; strip them before parsing.
    const tmpFile = join(tmpdir(), `seed-sites-${Date.now()}-${randomString(8)}.sql`);
    writeFileSync(tmpFile, sql, 'utf8');
    try {
        const cmd = `npx wrangler d1 execute ${DB} ${envFlag} --json --file=${tmpFile}`;
        const raw = execSync(cmd, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });
        // Strip everything before first [ or { (wrangler stdout UI chars)
        const firstJson = Math.min(
            raw.indexOf('[') === -1 ? Infinity : raw.indexOf('['),
            raw.indexOf('{') === -1 ? Infinity : raw.indexOf('{'),
        );
        if (firstJson === Infinity) return [];
        return JSON.parse(raw.slice(firstJson));
    } finally {
        try {
            unlinkSync(tmpFile);
        } catch (_e) {
            // ignore cleanup failure
        }
    }
}

// Wrangler quirk (Lesson — discovered during B2 remote seed):
// --json --file against REMOTE returns a SUMMARY row
// ({"Total queries executed": N, "Rows read": N, ...}) instead of
// the actual SELECT row data. The same flag against LOCAL D1
// returns row data. To get actual rows from a SELECT against both
// local and remote, use --command (NOT --file). --command also has
// a max length limit (~16k chars), but read queries here are small.
function wranglerQuery(envFlag, sql) {
    const cmd = `npx wrangler d1 execute ${DB} ${envFlag} --json --command=${JSON.stringify(sql)}`;
    const raw = execSync(cmd, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });
    const firstJson = Math.min(
        raw.indexOf('[') === -1 ? Infinity : raw.indexOf('['),
        raw.indexOf('{') === -1 ? Infinity : raw.indexOf('{'),
    );
    if (firstJson === Infinity) return [];
    const parsed = JSON.parse(raw.slice(firstJson));
    return parsed?.[0]?.results || [];
}

function readSites(envFlag) {
    return wranglerQuery(envFlag, 'SELECT id, slug FROM sites');
}

function readFields(envFlag) {
    return wranglerQuery(envFlag, 'SELECT id, site_id, slug FROM site_fields');
}

function main() {
    const args = process.argv.slice(2);
    const isLocal = args.includes('--local');
    const isRemote = args.includes('--remote');
    const isDryRun = args.includes('--dry-run');

    if (isLocal === isRemote) {
        console.error('Usage: node scripts/seed-sites.js (--local | --remote) [--dry-run]');
        process.exit(1);
    }

    const envFlag = isLocal ? '--local' : '--remote';
    const mode = isDryRun ? 'DRY RUN' : isLocal ? 'LOCAL APPLY' : 'REMOTE APPLY';
    console.log(`seed-sites: ${mode}`);

    // Read current state
    const existingSites = readSites(envFlag);
    const existingFields = readFields(envFlag);
    console.log(`Pre-seed state: ${existingSites.length} site(s), ${existingFields.length} field(s)`);

    // Build plan
    const plan = buildSeedPlan(existingSites, existingFields);
    const summary = planToHumanSummary(plan);
    console.log('\nPlan:');
    for (const line of summary) console.log(`  ${line}`);

    // Convert to SQL
    const now = Date.now();
    const sql = planToSql(plan, now);

    if (sql.length === 0) {
        console.log('\nNothing to do — all sites + fields already present.');
        return;
    }

    if (isDryRun) {
        console.log('\nDry-run — would execute these SQL statements:');
        for (const stmt of sql) console.log(`  ${stmt}`);
        return;
    }

    // Execute
    console.log(`\nExecuting ${sql.length} statement(s)...`);
    wranglerExecute(envFlag, sql.join('\n'));
    console.log('Done.');

    // Post-seed verification
    const postSites = readSites(envFlag);
    const postFields = readFields(envFlag);
    console.log(`Post-seed state: ${postSites.length} site(s), ${postFields.length} field(s)`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
