#!/usr/bin/env node
//
// M3 Batch 4 — backfill integration test.
//
// Operator-runnable end-to-end check against local D1. NOT a vitest test
// (CI doesn't run wrangler against a local database). Exits 0 on
// success; non-zero on assertion failure.
//
// Usage:
//   bash scripts/teardown-local-d1.sh && bash scripts/setup-local-d1.sh
//   node scripts/backfill-customers.test.js
//
// What it asserts (all against the seed fixture from B1):
//   - Sarah's 8 dot/plus/case Gmail variants → 1 customer
//   - Mike's 4 plus-alias variants → 1 customer
//   - John.doe vs johndoe @yahoo → 2 separate customers
//   - Malformed and NULL email bookings → 0 customers, customer_id stays NULL
//   - Total: 38 customers from 50 bookings (1 + 1 + 2 + 33 + 1 walk-up)
//   - Idempotency: re-running backfill produces 0 new customers, 0 errors
//   - Customer.created audit rows: one per new customer
//   - Sarah customer denormalized: total_bookings=8, refund_count=1,
//     lifetime_value_cents=52104

import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const DB = 'air-action-sports-db';
const FLAGS = '--local';

function execD1(sql) {
    const cmd = `npx wrangler d1 execute ${DB} ${FLAGS} --json --command ${JSON.stringify(sql)}`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(result);
    return parsed[0]?.results || [];
}

function runBackfill() {
    execSync(`node scripts/backfill-customers.js ${FLAGS}`, { stdio: 'inherit' });
}

function pass(label) {
    console.log(`  ✓ ${label}`);
}

function header(label) {
    console.log(`\n── ${label} ──`);
}

function main() {
    console.log('M3 backfill integration test (against local D1)\n');

    header('Pre-conditions');
    const bookingCount = execD1('SELECT COUNT(*) AS n FROM bookings')[0].n;
    assert.equal(bookingCount, 50, `expected 50 bookings; got ${bookingCount}. Run setup-local-d1.sh first.`);
    pass(`50 bookings in local D1`);

    const customerCountBefore = execD1('SELECT COUNT(*) AS n FROM customers')[0].n;
    assert.equal(customerCountBefore, 0, `expected 0 customers pre-backfill; got ${customerCountBefore}`);
    pass('0 customers pre-backfill');

    header('First-run: full backfill');
    runBackfill();

    header('Post-first-run assertions');

    const customerCountAfter = execD1('SELECT COUNT(*) AS n FROM customers')[0].n;
    assert.equal(customerCountAfter, 38,
        `expected 38 customers (1 Sarah + 1 Mike + 2 yahoo + 33 distinct + 1 walk-up); got ${customerCountAfter}`);
    pass('38 customers created');

    const linkedBookings = execD1("SELECT COUNT(*) AS n FROM bookings WHERE customer_id IS NOT NULL")[0].n;
    assert.equal(linkedBookings, 48,
        `expected 48 bookings linked (50 total minus 2 skipped malformed/null email); got ${linkedBookings}`);
    pass('48 bookings linked (2 skipped: malformed + null email)');

    const skippedBookings = execD1("SELECT id, email FROM bookings WHERE customer_id IS NULL ORDER BY id")[0]
        ? execD1("SELECT id, email FROM bookings WHERE customer_id IS NULL ORDER BY id")
        : [];
    const skippedIds = skippedBookings.map((r) => r.id).sort();
    assert.deepEqual(skippedIds, ['bk_seed_malformed', 'bk_seed_null_email'].sort(),
        `expected skipped: bk_seed_malformed, bk_seed_null_email; got ${skippedIds.join(', ')}`);
    pass('skipped bookings: bk_seed_malformed + bk_seed_null_email');

    // Sarah collapse check
    const sarahCustomer = execD1("SELECT id, total_bookings, total_attendees, lifetime_value_cents, refund_count FROM customers WHERE email_normalized='sarahchen@gmail.com'");
    assert.equal(sarahCustomer.length, 1, "Sarah's 8 Gmail variants should collapse to 1 customer");
    assert.equal(sarahCustomer[0].total_bookings, 8, `Sarah total_bookings; got ${sarahCustomer[0].total_bookings}`);
    assert.equal(sarahCustomer[0].refund_count, 1, `Sarah refund_count; got ${sarahCustomer[0].refund_count}`);
    // 6 paid bookings: 8510 + 8510 + 9032 + 9032 + 8510 + 8510 = 52104
    assert.equal(sarahCustomer[0].lifetime_value_cents, 52104,
        `Sarah lifetime_value_cents (6 paid: 3×8510 + 2×9032 + 1×8510 = 52104); got ${sarahCustomer[0].lifetime_value_cents}`);
    // 7 attendees: 8 bookings minus 1 abandoned = 7 attendee-equivalent
    assert.equal(sarahCustomer[0].total_attendees, 7,
        `Sarah total_attendees (8 - 1 abandoned); got ${sarahCustomer[0].total_attendees}`);
    pass('Sarah customer: 8 bookings collapse to 1, LTV 52104, refund_count 1');

    // Mike collapse check
    const mikeCustomer = execD1("SELECT id, total_bookings FROM customers WHERE email_normalized='mike@gmail.com'");
    assert.equal(mikeCustomer.length, 1, "Mike's 4 plus-alias variants should collapse to 1 customer");
    assert.equal(mikeCustomer[0].total_bookings, 4, `Mike total_bookings; got ${mikeCustomer[0].total_bookings}`);
    pass('Mike customer: 4 plus-alias bookings collapse to 1');

    // Yahoo split check
    const yahooCustomers = execD1("SELECT email_normalized FROM customers WHERE email_normalized LIKE '%@yahoo.com' AND email_normalized LIKE 'john%' ORDER BY email_normalized");
    assert.equal(yahooCustomers.length, 2, `expected 2 separate yahoo customers; got ${yahooCustomers.length}`);
    pass('Yahoo: john.doe and johndoe stay as 2 separate customers');

    // Audit rows
    const auditRows = execD1("SELECT COUNT(*) AS n FROM audit_log WHERE action='customer.created'")[0].n;
    assert.equal(auditRows, 38, `expected 38 customer.created audit rows; got ${auditRows}`);
    pass('38 customer.created audit rows emitted');

    // Audit row shape
    const sampleAudit = execD1("SELECT meta_json FROM audit_log WHERE action='customer.created' LIMIT 1")[0];
    const meta = JSON.parse(sampleAudit.meta_json);
    assert.equal(meta.source, 'backfill', `audit meta.source; got ${meta.source}`);
    assert.ok(typeof meta.booking_count === 'number');
    assert.ok(typeof meta.normalized_email === 'string');
    pass('audit meta shape: { source: "backfill", booking_count, normalized_email }');

    header('Idempotency check: second run');
    runBackfill();

    header('Post-second-run assertions');

    const customerCountFinal = execD1('SELECT COUNT(*) AS n FROM customers')[0].n;
    assert.equal(customerCountFinal, 38, `expected 38 customers (no change); got ${customerCountFinal}`);
    pass('still 38 customers after second run (no duplicates)');

    const auditRowsFinal = execD1("SELECT COUNT(*) AS n FROM audit_log WHERE action='customer.created'")[0].n;
    assert.equal(auditRowsFinal, 38, `expected 38 audit rows (no new ones from re-run); got ${auditRowsFinal}`);
    pass('no new customer.created audit rows on idempotent re-run');

    // Sarah's denormalized fields should be unchanged after re-run
    const sarahCustomerAfter = execD1("SELECT total_bookings, lifetime_value_cents FROM customers WHERE email_normalized='sarahchen@gmail.com'");
    assert.equal(sarahCustomerAfter[0].total_bookings, 8);
    assert.equal(sarahCustomerAfter[0].lifetime_value_cents, 52104);
    pass('Sarah denormalized fields unchanged after re-run');

    console.log('\n✓ All integration assertions passed.');
}

try {
    main();
} catch (err) {
    console.error('\n✗ Integration test FAILED:');
    console.error(err.message);
    if (err.actual !== undefined) {
        console.error(`  expected: ${JSON.stringify(err.expected)}`);
        console.error(`  received: ${JSON.stringify(err.actual)}`);
    }
    process.exit(1);
}
