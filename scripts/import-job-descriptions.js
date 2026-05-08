#!/usr/bin/env node
//
// M5 Batch 5 — one-shot import of docs/staff-job-descriptions.md into
// 22 staff_documents rows (kind='jd', version='v1.0').
//
// Idempotent: re-running detects existing rows by (slug, version) and
// skips. Past acks (none yet at first run) stay pinned to whatever
// version was acknowledged.
//
// Usage:
//   node scripts/import-job-descriptions.js --local
//   node scripts/import-job-descriptions.js --remote
//   node scripts/import-job-descriptions.js --local --dry-run

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DB = 'air-action-sports-db';
const __dirname = dirname(fileURLToPath(import.meta.url));
const JD_DOC_PATH = join(__dirname, '..', 'docs', 'staff-job-descriptions.md');

// Number-ordered roles from migration 0032_roles_seed.sql, matching
// the sequence in docs/staff-job-descriptions.md (## 1 ... ## 22).
const ROLE_ORDER = [
    'role_event_director',         // 1
    'role_booking_coordinator',    // 2
    'role_marketing_manager',      // 3
    'role_bookkeeper',             // 4
    'role_hr_coordinator',         // 5
    'role_equipment_manager',      // 6
    'role_game_designer',          // 7
    'role_site_coordinator',       // 8
    'role_compliance_reviewer',    // 9
    'role_read_only_auditor',      // 10
    'role_check_in_staff',         // 11
    'role_lead_marshal',           // 12
    'role_field_marshal',          // 13
    'role_safety_officer',         // 14
    'role_event_emt',              // 15
    'role_event_photographer',     // 16
    'role_setup_teardown',         // 17
    'role_vendor_coordinator',     // 18
    'role_junior_field_designer',  // 19
    'role_graphic_designer',       // 20
    'role_insurance_broker',       // 21
    'role_attorney',               // 22
];

// ────────────────────────────────────────────────────────────────────
// Pure helpers — exported for unit tests.
// ────────────────────────────────────────────────────────────────────

/**
 * Parses the JD doc into an array of section objects. Each section
 * starts at `## N. Title` and ends at the next `## N. ` heading or EOF.
 *
 * @param {string} markdown
 * @returns {Array<{ number: number, title: string, body: string }>}
 */
export function parseJobDescriptions(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let current = null;

    for (const line of lines) {
        const m = line.match(/^##\s+(\d+)\.\s+(.+?)\s*$/);
        if (m) {
            if (current) sections.push(current);
            current = {
                number: Number(m[1]),
                title: m[2].trim(),
                body: '',
            };
        } else if (current) {
            current.body += line + '\n';
        }
    }
    if (current) sections.push(current);
    return sections.map((s) => ({ ...s, body: s.body.trim() }));
}

/**
 * Builds the staff_documents row payload for a parsed JD section.
 *
 * @param {{ number: number, title: string, body: string }} section
 * @param {string} roleId
 * @returns {{ id, kind, slug, title, body_html, body_sha256, version, primary_role_id, description }}
 */
export function buildRow(section, roleId) {
    const slug = roleId.replace(/^role_/, '') + '_jd';
    const body = section.body;
    const sha256 = createHash('sha256').update(body, 'utf8').digest('hex');
    const id = `sd_${randomBytes(9).toString('hex').slice(0, 12)}`;
    return {
        id,
        kind: 'jd',
        slug,
        title: section.title,
        body_html: body,
        body_sha256: sha256,
        version: 'v1.0',
        primary_role_id: roleId,
        description: section.title.length > 120 ? section.title.slice(0, 117) + '...' : section.title,
    };
}

export function planImport(markdown, existingSlugs = []) {
    const sections = parseJobDescriptions(markdown);
    const existingSet = new Set(existingSlugs);
    const toCreate = [];
    const toSkip = [];
    const toFlag = [];

    for (const section of sections) {
        const idx = section.number - 1;
        const roleId = ROLE_ORDER[idx];
        if (!roleId) {
            toFlag.push({ section: section.number, reason: 'no_matching_role', title: section.title });
            continue;
        }
        const slug = roleId.replace(/^role_/, '') + '_jd';
        if (existingSet.has(slug)) {
            toSkip.push({ slug, reason: 'already_exists' });
            continue;
        }
        toCreate.push(buildRow(section, roleId));
    }

    return { toCreate, toSkip, toFlag };
}

// ────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
    const args = process.argv.slice(2);
    const localFlag = args.includes('--local');
    const remoteFlag = args.includes('--remote');
    const dryRun = args.includes('--dry-run');

    if (!localFlag && !remoteFlag) {
        console.error('Usage: node scripts/import-job-descriptions.js --local|--remote [--dry-run]');
        process.exit(2);
    }
    const target = localFlag ? '--local' : '--remote';

    const markdown = readFileSync(JD_DOC_PATH, 'utf8');

    function exec(sql) {
        const tmpFile = join(tmpdir(), `aas-import-jd-${randomBytes(4).toString('hex')}.sql`);
        writeFileSync(tmpFile, sql);
        try {
            const cmd = `npx wrangler d1 execute ${DB} ${target} --json --file=${tmpFile}`;
            const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
            const idx = stdout.search(/[[{]/);
            if (idx === -1) return null;
            return JSON.parse(stdout.slice(idx));
        } finally {
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    }

    const existingResult = exec(`SELECT slug FROM staff_documents WHERE kind='jd' AND version='v1.0';`);
    const existingSlugs = (existingResult?.[0]?.results || []).map((r) => r.slug);

    const plan = planImport(markdown, existingSlugs);
    console.log(`[import-jd] sections=${parseJobDescriptions(markdown).length} create=${plan.toCreate.length} skip=${plan.toSkip.length} flag=${plan.toFlag.length}`);

    if (plan.toFlag.length > 0) {
        console.warn('[import-jd] FLAGS:');
        for (const f of plan.toFlag) console.warn(`  - section ${f.section}: ${f.reason} (${f.title})`);
    }

    if (dryRun) {
        for (const r of plan.toCreate) {
            console.log(`  WOULD CREATE: id=${r.id} slug=${r.slug} title=${r.title}`);
        }
        process.exit(0);
    }

    let created = 0;
    for (const r of plan.toCreate) {
        const escapeSql = (s) => s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
        const sql = `
INSERT INTO staff_documents (id, kind, slug, title, body_html, body_sha256, version, primary_role_id, description, created_by_user_id, created_at)
  VALUES (${escapeSql(r.id)}, ${escapeSql(r.kind)}, ${escapeSql(r.slug)}, ${escapeSql(r.title)},
          ${escapeSql(r.body_html)}, ${escapeSql(r.body_sha256)}, ${escapeSql(r.version)},
          ${escapeSql(r.primary_role_id)}, ${escapeSql(r.description)},
          (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1),
          ${Date.now()});

INSERT INTO audit_log (id, action, actor_user_id, target_type, target_id, meta, created_at)
  VALUES ('${`al_${randomBytes(9).toString('hex').slice(0, 12)}`}', 'staff_document.imported_via_script',
          (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1),
          'staff_document', ${escapeSql(r.id)},
          ${escapeSql(JSON.stringify({ slug: r.slug, version: r.version, kind: 'jd', body_sha256: r.body_sha256 }))},
          ${Date.now()});
`;
        try {
            exec(sql);
            created += 1;
            console.log(`  [+] ${r.slug} v${r.version} (${r.title})`);
        } catch (err) {
            console.error(`  [!] failed for slug=${r.slug}: ${err.message}`);
        }
    }
    console.log(`[import-jd] done. created=${created} skipped=${plan.toSkip.length} flagged=${plan.toFlag.length}`);
}
