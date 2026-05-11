#!/usr/bin/env node
//
// M5.5 Batch 2 — events.site_id backfill script.
//
// Iterates events, parses events.location (NOT events.site — the
// latter is event series branding like "Delta", not geographic; per
// production sample 2026-05-11), matches against sites.slug, sets
// events.site_id where parseable.
//
// Idempotent: events with site_id already set are skipped. Re-runs
// are no-ops.
//
// Unparseable events (location doesn't match any known site) are
// logged to stderr but do not cause failure. They stay with NULL
// site_id; operator can set manually via SQL or future AdminSites
// UI (B6.5).
//
// Usage:
//   node scripts/backfill-events-site-id.js --local            # apply to local D1
//   node scripts/backfill-events-site-id.js --remote           # apply to remote D1
//   node scripts/backfill-events-site-id.js --local --dry-run  # print plan, no writes
//
// Requires migration 0045 to be applied and scripts/seed-sites.js to
// have run successfully (sites must exist before events can be
// mapped to them).

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DB = 'air-action-sports-db';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ────────────────────────────────────────────────────────────────────
// Site-slug parser — pure, exported for tests.
// ────────────────────────────────────────────────────────────────────

/**
 * Given a free-text location string from events.location, returns
 * the matching sites.slug ('ghost-town' / 'foxtrot') or null if
 * unparseable. Case-insensitive, whitespace-tolerant.
 *
 * Extending: add new sites by appending to this match table. Once
 * AdminSites UI ships (B6.5), this function could be replaced with
 * a runtime lookup against the sites table, but the static map
 * keeps the backfill self-contained.
 */
export function parseSiteFromLocation(location) {
    if (location === null || location === undefined) return null;
    const norm = String(location).toLowerCase().trim();
    if (!norm) return null;
    if (norm.includes('ghost town')) return 'ghost-town';
    if (norm.includes('foxtrot')) return 'foxtrot';
    return null;
}

// ────────────────────────────────────────────────────────────────────
// SQL escape — same as seed-sites.js
// ────────────────────────────────────────────────────────────────────

export function escapeSqlString(value) {
    if (value === null || value === undefined) return 'NULL';
    return `'${String(value).replace(/'/g, "''")}'`;
}

// ────────────────────────────────────────────────────────────────────
// Plan builder — pure, exported for tests.
// ────────────────────────────────────────────────────────────────────

/**
 * Given the current events + sites tables, produces a plan describing
 * which events get site_id set. Plan items:
 *   { kind: 'update', event_id, location, slug, site_id }
 *   { kind: 'skip_already_set', event_id, location, existing_site_id }
 *   { kind: 'skip_unparseable', event_id, location }
 *
 * @param events Array<{id, location, site_id}>
 * @param sites Array<{id, slug}>
 */
export function buildBackfillPlan(events, sites) {
    const sitesBySlug = new Map();
    for (const s of sites) sitesBySlug.set(s.slug, s);

    const plan = [];

    for (const event of events) {
        if (event.site_id !== null && event.site_id !== undefined && event.site_id !== '') {
            plan.push({
                kind: 'skip_already_set',
                event_id: event.id,
                location: event.location,
                existing_site_id: event.site_id,
            });
            continue;
        }

        const slug = parseSiteFromLocation(event.location);
        if (!slug) {
            plan.push({
                kind: 'skip_unparseable',
                event_id: event.id,
                location: event.location,
            });
            continue;
        }

        const site = sitesBySlug.get(slug);
        if (!site) {
            // Should not happen if seed-sites ran. Treat as unparseable
            // (logs to stderr) so operator notices.
            plan.push({
                kind: 'skip_unparseable',
                event_id: event.id,
                location: event.location,
            });
            continue;
        }

        plan.push({
            kind: 'update',
            event_id: event.id,
            location: event.location,
            slug,
            site_id: site.id,
        });
    }

    return plan;
}

/**
 * Convert a plan into SQL statements.
 */
export function planToSql(plan, now) {
    const sql = [];

    for (const op of plan) {
        if (op.kind === 'update') {
            sql.push(
                `UPDATE events SET site_id = ${escapeSqlString(op.site_id)}, updated_at = ${String(now)} WHERE id = ${escapeSqlString(op.event_id)} AND site_id IS NULL;`,
            );
            sql.push(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at) VALUES (` +
                    [
                        'NULL',
                        `'event.site_id_backfilled'`,
                        `'event'`,
                        escapeSqlString(op.event_id),
                        escapeSqlString(
                            JSON.stringify({
                                location: op.location,
                                slug: op.slug,
                                site_id: op.site_id,
                                source: 'backfill-events-site-id',
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
 * Produce a 1-line summary per plan item.
 */
export function planToHumanSummary(plan) {
    return plan.map((op) => {
        switch (op.kind) {
            case 'update':
                return `+ event ${op.event_id} -> ${op.slug} (${op.site_id})`;
            case 'skip_already_set':
                return `· event ${op.event_id} already has site_id (${op.existing_site_id})`;
            case 'skip_unparseable':
                return `! event ${op.event_id} unparseable location: ${JSON.stringify(op.location)}`;
            default:
                return `? unknown plan op: ${JSON.stringify(op)}`;
        }
    });
}

// ────────────────────────────────────────────────────────────────────
// CLI — I/O paths. Not unit tested.
// ────────────────────────────────────────────────────────────────────

function randomString(len) {
    const bytes = randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
}

function wranglerExecute(envFlag, sql) {
    const tmpFile = join(tmpdir(), `backfill-events-${Date.now()}-${randomString(8)}.sql`);
    writeFileSync(tmpFile, sql, 'utf8');
    try {
        const cmd = `npx wrangler d1 execute ${DB} ${envFlag} --json --file=${tmpFile}`;
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
        return JSON.parse(raw.slice(firstJson));
    } finally {
        try {
            unlinkSync(tmpFile);
        } catch (_e) {
            // ignore cleanup failure
        }
    }
}

function readEvents(envFlag) {
    const result = wranglerExecute(
        envFlag,
        'SELECT id, location, site_id FROM events;',
    );
    return result?.[0]?.results || [];
}

function readSites(envFlag) {
    const result = wranglerExecute(envFlag, 'SELECT id, slug FROM sites;');
    return result?.[0]?.results || [];
}

function main() {
    const args = process.argv.slice(2);
    const isLocal = args.includes('--local');
    const isRemote = args.includes('--remote');
    const isDryRun = args.includes('--dry-run');

    if (isLocal === isRemote) {
        console.error(
            'Usage: node scripts/backfill-events-site-id.js (--local | --remote) [--dry-run]',
        );
        process.exit(1);
    }

    const envFlag = isLocal ? '--local' : '--remote';
    const mode = isDryRun ? 'DRY RUN' : isLocal ? 'LOCAL APPLY' : 'REMOTE APPLY';
    console.log(`backfill-events-site-id: ${mode}`);

    const events = readEvents(envFlag);
    const sites = readSites(envFlag);
    console.log(`Pre-backfill: ${events.length} event(s), ${sites.length} site(s)`);

    if (sites.length === 0) {
        console.error('No sites found — run scripts/seed-sites.js first.');
        process.exit(1);
    }

    const plan = buildBackfillPlan(events, sites);
    const summary = planToHumanSummary(plan);
    console.log('\nPlan:');
    for (const line of summary) console.log(`  ${line}`);

    // Surface unparseable count to stderr so CI / scripted operators notice
    const unparseable = plan.filter((p) => p.kind === 'skip_unparseable');
    if (unparseable.length > 0) {
        console.error(
            `\n${unparseable.length} event(s) had unparseable locations. They stay with NULL site_id.`,
        );
    }

    const now = Date.now();
    const sql = planToSql(plan, now);

    if (sql.length === 0) {
        console.log('\nNothing to update.');
        return;
    }

    if (isDryRun) {
        console.log('\nDry-run — would execute these SQL statements:');
        for (const stmt of sql) console.log(`  ${stmt}`);
        return;
    }

    console.log(`\nExecuting ${sql.length} statement(s)...`);
    wranglerExecute(envFlag, sql.join('\n'));
    console.log('Done.');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
