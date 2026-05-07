#!/usr/bin/env node
//
// M3 Batch 4 — customers backfill script.
//
// Iterates bookings, normalizes emails (per worker/lib/customerEmail.js),
// groups by canonical address, creates customer records, links bookings
// + attendees via customer_id, and emits customer.created audit rows.
//
// Idempotent: re-running detects existing customers (UNIQUE constraint
// on email_normalized WHERE archived_at IS NULL) and updates their
// denormalized fields rather than creating duplicates. New customer
// rows trigger a customer.created audit row; updates do NOT.
//
// Usage:
//   node scripts/backfill-customers.js --local            # apply to local D1
//   node scripts/backfill-customers.js --remote           # apply to remote D1
//   node scripts/backfill-customers.js --local --dry-run  # print plan, no writes
//   node scripts/backfill-customers.js --local --limit=N  # process first N bookings
//
// Operator runs --remote AFTER B5's dual-write code merges to main and
// the M3 deploy runbook gives the green light. Until then, --local only.
//
// Schema requires migration 0022 to be applied.

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { normalizeEmail } from '../worker/lib/customerEmail.js';

const DB = 'air-action-sports-db';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ────────────────────────────────────────────────────────────────────
// Pure helpers — no I/O. Exported for unit tests.
// ────────────────────────────────────────────────────────────────────

/**
 * Given an array of bookings, produces a Map<email_normalized, Booking[]>
 * keyed on canonical normalized addresses. Bookings whose email
 * normalizes to null (malformed / null email) are excluded.
 *
 * The caller is responsible for logging the skipped ones — this helper
 * doesn't side-effect.
 */
export function groupByNormalizedEmail(bookings) {
    const groups = new Map();
    for (const b of bookings) {
        const key = normalizeEmail(b.email);
        if (key === null) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
    }
    return groups;
}

/**
 * For a list of bookings belonging to one customer, returns the
 * denormalized aggregates that get stored on customers.
 *
 * - total_bookings: count of bookings
 * - total_attendees: sum of player_count where status NOT IN ('abandoned')
 *   (abandoned bookings never created attendee rows)
 * - lifetime_value_cents: sum of total_cents where status='paid' only
 *   (refunded does NOT count; comp is $0; abandoned never settled)
 * - refund_count: count where status='refunded'
 * - first_booking_at / last_booking_at: min/max created_at
 */
export function computeDenormalizedFields(bookings) {
    let lifetimeValueCents = 0;
    let totalAttendees = 0;
    let refundCount = 0;
    let firstBookingAt = null;
    let lastBookingAt = null;

    for (const b of bookings) {
        if (b.status !== 'abandoned') {
            totalAttendees += b.player_count || 0;
        }
        if (b.status === 'paid') {
            lifetimeValueCents += b.total_cents || 0;
        }
        if (b.status === 'refunded') {
            refundCount += 1;
        }
        if (firstBookingAt == null || b.created_at < firstBookingAt) {
            firstBookingAt = b.created_at;
        }
        if (lastBookingAt == null || b.created_at > lastBookingAt) {
            lastBookingAt = b.created_at;
        }
    }

    return {
        total_bookings: bookings.length,
        total_attendees: totalAttendees,
        lifetime_value_cents: lifetimeValueCents,
        refund_count: refundCount,
        first_booking_at: firstBookingAt,
        last_booking_at: lastBookingAt,
    };
}

/**
 * Picks the display email for a customer record. We use the email
 * exactly as it first appeared (preserving case) — matches by the
 * earliest created_at booking in the group.
 */
export function pickDisplayEmailFromGroup(bookings) {
    if (!bookings.length) return null;
    const sorted = [...bookings].sort((a, b) => a.created_at - b.created_at);
    return sorted[0].email;
}

/**
 * Picks the display name + phone the same way (first-seen wins).
 */
export function pickDisplayFieldsFromGroup(bookings) {
    if (!bookings.length) return { name: null, phone: null };
    const sorted = [...bookings].sort((a, b) => a.created_at - b.created_at);
    return {
        name: sorted[0].full_name || null,
        phone: sorted[0].phone || null,
    };
}

/** SQLite string literal escape — doubles single quotes. */
export function escapeSqlString(s) {
    if (s == null) return 'NULL';
    return `'${String(s).replace(/'/g, "''")}'`;
}

export function makeCustomerId() {
    const bytes = randomBytes(14);
    let out = '';
    for (let i = 0; i < 14; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return `cus_${out}`;
}

/**
 * Produces a backfill plan from current state.
 *
 * @param {object} args
 * @param {Booking[]} args.bookings
 * @param {Map<string, Customer>} args.existingCustomers - keyed on email_normalized
 * @param {(s?: string) => string} [args.idGen] - injectable for tests
 * @returns {{
 *   newCustomers: Array<{id, email, email_normalized, name, phone, fields}>,
 *   updatedCustomers: Array<{id, email_normalized, fields}>,
 *   bookingLinks: Array<{booking_id, customer_id}>,
 *   skippedBookings: Array<{booking_id, reason}>,
 * }}
 */
export function buildBackfillPlan({ bookings, existingCustomers, idGen = makeCustomerId }) {
    const groups = groupByNormalizedEmail(bookings);
    const newCustomers = [];
    const updatedCustomers = [];
    const bookingLinks = [];
    const skippedBookings = [];

    // Track skipped bookings (those whose email normalized to null)
    for (const b of bookings) {
        if (normalizeEmail(b.email) === null) {
            skippedBookings.push({
                booking_id: b.id,
                reason: !b.email ? 'null_email' : 'malformed_email',
            });
        }
    }

    for (const [emailNormalized, group] of groups.entries()) {
        const fields = computeDenormalizedFields(group);
        const existing = existingCustomers.get(emailNormalized);

        let customerId;
        if (existing) {
            customerId = existing.id;
            updatedCustomers.push({
                id: customerId,
                email_normalized: emailNormalized,
                fields,
            });
        } else {
            customerId = idGen();
            const display = pickDisplayFieldsFromGroup(group);
            newCustomers.push({
                id: customerId,
                email: pickDisplayEmailFromGroup(group),
                email_normalized: emailNormalized,
                name: display.name,
                phone: display.phone,
                fields,
            });
        }

        for (const b of group) {
            bookingLinks.push({ booking_id: b.id, customer_id: customerId });
        }
    }

    return { newCustomers, updatedCustomers, bookingLinks, skippedBookings };
}

/**
 * Renders a backfill plan to a single SQL transaction.
 */
export function planToSql(plan, { now = Date.now() } = {}) {
    const lines = [];

    lines.push('BEGIN TRANSACTION;');

    // Insert new customers + emit customer.created audit rows
    for (const c of plan.newCustomers) {
        lines.push(
            `INSERT INTO customers (id, email, email_normalized, name, phone, total_bookings, total_attendees, lifetime_value_cents, refund_count, first_booking_at, last_booking_at, email_transactional, email_marketing, sms_transactional, sms_marketing, created_at, updated_at) VALUES (` +
            `${escapeSqlString(c.id)}, ${escapeSqlString(c.email)}, ${escapeSqlString(c.email_normalized)}, ${escapeSqlString(c.name)}, ${escapeSqlString(c.phone)}, ` +
            `${c.fields.total_bookings}, ${c.fields.total_attendees}, ${c.fields.lifetime_value_cents}, ${c.fields.refund_count}, ` +
            `${c.fields.first_booking_at ?? 'NULL'}, ${c.fields.last_booking_at ?? 'NULL'}, ` +
            `1, 1, 0, 0, ${now}, ${now});`,
        );

        const meta = JSON.stringify({
            source: 'backfill',
            booking_count: c.fields.total_bookings,
            normalized_email: c.email_normalized,
        });
        lines.push(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at) VALUES (` +
            `NULL, 'customer.created', 'customer', ${escapeSqlString(c.id)}, ${escapeSqlString(meta)}, ${now});`,
        );
    }

    // Update existing customers' denormalized fields
    for (const u of plan.updatedCustomers) {
        lines.push(
            `UPDATE customers SET total_bookings = ${u.fields.total_bookings}, total_attendees = ${u.fields.total_attendees}, lifetime_value_cents = ${u.fields.lifetime_value_cents}, refund_count = ${u.fields.refund_count}, first_booking_at = ${u.fields.first_booking_at ?? 'NULL'}, last_booking_at = ${u.fields.last_booking_at ?? 'NULL'}, updated_at = ${now} WHERE id = ${escapeSqlString(u.id)};`,
        );
    }

    // Link bookings → customer_id (and attendees of those bookings)
    for (const link of plan.bookingLinks) {
        lines.push(
            `UPDATE bookings SET customer_id = ${escapeSqlString(link.customer_id)} WHERE id = ${escapeSqlString(link.booking_id)};`,
        );
        lines.push(
            `UPDATE attendees SET customer_id = ${escapeSqlString(link.customer_id)} WHERE booking_id = ${escapeSqlString(link.booking_id)};`,
        );
    }

    lines.push('COMMIT;');
    return lines.join('\n') + '\n';
}

// ────────────────────────────────────────────────────────────────────
// I/O — wrangler shell-out + temp-file SQL writes
// ────────────────────────────────────────────────────────────────────

function execWrangler(flags, sqlOrFile, isFile = false) {
    const cmd = isFile
        ? `npx wrangler d1 execute ${DB} ${flags} --json --file ${sqlOrFile}`
        : `npx wrangler d1 execute ${DB} ${flags} --json --command ${JSON.stringify(sqlOrFile)}`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    return JSON.parse(result);
}

function readBookings(flags, limit = null) {
    const limitClause = limit ? ` LIMIT ${limit}` : '';
    const sql = `SELECT id, email, full_name, phone, status, total_cents, player_count, created_at FROM bookings ORDER BY created_at ASC${limitClause}`;
    const out = execWrangler(flags, sql);
    return out[0]?.results || [];
}

function readExistingCustomers(flags) {
    const sql = `SELECT id, email_normalized FROM customers WHERE archived_at IS NULL`;
    const out = execWrangler(flags, sql);
    const map = new Map();
    for (const c of out[0]?.results || []) {
        map.set(c.email_normalized, c);
    }
    return map;
}

function writeAndExecuteSql(flags, sql) {
    const tmpFile = join(tmpdir(), `backfill-${Date.now()}.sql`);
    writeFileSync(tmpFile, sql, 'utf8');
    try {
        execWrangler(flags, tmpFile, true);
    } finally {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

// ────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const args = { local: false, remote: false, dryRun: false, limit: null };
    for (const a of argv) {
        if (a === '--local') args.local = true;
        else if (a === '--remote') args.remote = true;
        else if (a === '--dry-run') args.dryRun = true;
        else if (a.startsWith('--limit=')) args.limit = Number(a.slice('--limit='.length));
        else if (a === '--help' || a === '-h') {
            console.log('Usage: node scripts/backfill-customers.js (--local|--remote) [--dry-run] [--limit=N]');
            process.exit(0);
        }
    }
    if (!args.local && !args.remote) {
        console.error('Error: must specify --local or --remote');
        process.exit(2);
    }
    if (args.local && args.remote) {
        console.error('Error: --local and --remote are mutually exclusive');
        process.exit(2);
    }
    return args;
}

async function main(argv) {
    const args = parseArgs(argv);
    const flags = args.remote ? '--remote' : '--local';
    const target = args.remote ? 'REMOTE' : 'local';

    console.log(`── M3 customers backfill (${target}) ──`);
    console.log();

    console.log('Step 1/4: Reading bookings…');
    const bookings = readBookings(flags, args.limit);
    console.log(`  ${bookings.length} bookings`);

    console.log('Step 2/4: Reading existing customers…');
    const existingCustomers = readExistingCustomers(flags);
    console.log(`  ${existingCustomers.size} existing active customers`);

    console.log('Step 3/4: Building plan…');
    const plan = buildBackfillPlan({ bookings, existingCustomers });
    console.log(`  ${plan.newCustomers.length} new customers to create`);
    console.log(`  ${plan.updatedCustomers.length} existing customers to update`);
    console.log(`  ${plan.bookingLinks.length} booking → customer links`);
    console.log(`  ${plan.skippedBookings.length} bookings skipped (malformed/null email):`);
    for (const s of plan.skippedBookings.slice(0, 10)) {
        console.log(`    - ${s.booking_id} (${s.reason})`);
    }
    if (plan.skippedBookings.length > 10) {
        console.log(`    … and ${plan.skippedBookings.length - 10} more`);
    }

    if (args.dryRun) {
        console.log();
        console.log('--dry-run: no writes. Exiting.');
        process.exit(0);
    }

    console.log('Step 4/4: Applying plan…');
    const sql = planToSql(plan);
    writeAndExecuteSql(flags, sql);

    console.log();
    console.log('✓ Backfill complete.');
    console.log(`  ${plan.newCustomers.length} customers created (audit-logged)`);
    console.log(`  ${plan.updatedCustomers.length} customers updated`);
    console.log(`  ${plan.bookingLinks.length} bookings linked`);
    console.log(`  ${plan.skippedBookings.length} bookings skipped`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
