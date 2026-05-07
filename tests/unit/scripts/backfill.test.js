// Vitest unit tests for the pure helpers in scripts/backfill-customers.js.
// I/O paths (wrangler shell-out) are exercised by the integration test at
// scripts/backfill-customers.test.js — that one runs against local D1
// outside of CI.

import { describe, it, expect } from 'vitest';
import {
    groupByNormalizedEmail,
    computeDenormalizedFields,
    pickDisplayEmailFromGroup,
    pickDisplayFieldsFromGroup,
    escapeSqlString,
    makeCustomerId,
    buildBackfillPlan,
    planToSql,
} from '../../../scripts/backfill-customers.js';

// Helper to build a booking shape matching what the script reads from D1
function bk(overrides = {}) {
    return {
        id: 'bk_test',
        email: 'sarah@gmail.com',
        full_name: 'Sarah Chen',
        phone: '5551110001',
        status: 'paid',
        total_cents: 8000,
        player_count: 1,
        created_at: 1700000000000,
        ...overrides,
    };
}

describe('groupByNormalizedEmail', () => {
    it('returns empty Map for empty input', () => {
        expect(groupByNormalizedEmail([]).size).toBe(0);
    });

    it('collapses Sarah\'s 8 Gmail dot-variants into 1 group', () => {
        const variants = [
            'sarahchen@gmail.com',
            'sarah.chen@gmail.com',
            'sar.ahchen@gmail.com',
            'sarah.c.hen@gmail.com',
            's.a.r.a.h.c.h.e.n@gmail.com',
            'Sarah.Chen@gmail.com',
            'SARAHCHEN@gmail.com',
            'sarah.chen@googlemail.com',
        ];
        const bookings = variants.map((email, i) => bk({ id: `bk_${i}`, email, created_at: 1700000000000 + i }));
        const groups = groupByNormalizedEmail(bookings);
        expect(groups.size).toBe(1);
        const [key, group] = [...groups.entries()][0];
        expect(key).toBe('sarahchen@gmail.com');
        expect(group).toHaveLength(8);
    });

    it('collapses 4 Gmail plus-aliases into 1 group', () => {
        const bookings = [
            bk({ id: 'bk_m1', email: 'mike@gmail.com' }),
            bk({ id: 'bk_m2', email: 'mike+events@gmail.com' }),
            bk({ id: 'bk_m3', email: 'mike+nightfall@gmail.com' }),
            bk({ id: 'bk_m4', email: 'mike+test@googlemail.com' }),
        ];
        const groups = groupByNormalizedEmail(bookings);
        expect(groups.size).toBe(1);
        expect(groups.get('mike@gmail.com')).toHaveLength(4);
    });

    it('keeps non-Gmail dot-variants as separate customers', () => {
        const bookings = [
            bk({ id: 'bk_jd1', email: 'john.doe@yahoo.com' }),
            bk({ id: 'bk_jd2', email: 'johndoe@yahoo.com' }),
        ];
        const groups = groupByNormalizedEmail(bookings);
        expect(groups.size).toBe(2);
    });

    it('skips bookings with malformed emails (multiple @)', () => {
        const bookings = [
            bk({ id: 'bk_bad', email: 'weird@@example.com' }),
            bk({ id: 'bk_ok', email: 'good@example.com' }),
        ];
        const groups = groupByNormalizedEmail(bookings);
        expect(groups.size).toBe(1);
        expect(groups.get('good@example.com')).toHaveLength(1);
    });

    it('skips bookings with NULL or empty email', () => {
        const bookings = [
            bk({ id: 'bk_null', email: null }),
            bk({ id: 'bk_empty', email: '' }),
            bk({ id: 'bk_ok', email: 'good@example.com' }),
        ];
        const groups = groupByNormalizedEmail(bookings);
        expect(groups.size).toBe(1);
    });
});

describe('computeDenormalizedFields', () => {
    it('computes correctly for 4 paid bookings', () => {
        const bookings = [
            bk({ id: 'b1', status: 'paid', total_cents: 20000, player_count: 1, created_at: 1000 }),
            bk({ id: 'b2', status: 'paid', total_cents: 20000, player_count: 1, created_at: 2000 }),
            bk({ id: 'b3', status: 'paid', total_cents: 20000, player_count: 1, created_at: 3000 }),
            bk({ id: 'b4', status: 'paid', total_cents: 20000, player_count: 1, created_at: 4000 }),
        ];
        const f = computeDenormalizedFields(bookings);
        expect(f.total_bookings).toBe(4);
        expect(f.total_attendees).toBe(4);
        expect(f.lifetime_value_cents).toBe(80000);
        expect(f.refund_count).toBe(0);
        expect(f.first_booking_at).toBe(1000);
        expect(f.last_booking_at).toBe(4000);
    });

    it('excludes refunded bookings from LTV but counts them in total_bookings + refund_count', () => {
        const bookings = [
            bk({ id: 'b1', status: 'paid', total_cents: 20000, player_count: 1, created_at: 1000 }),
            bk({ id: 'b2', status: 'paid', total_cents: 20000, player_count: 1, created_at: 2000 }),
            bk({ id: 'b3', status: 'paid', total_cents: 20000, player_count: 1, created_at: 3000 }),
            bk({ id: 'b4', status: 'refunded', total_cents: 20000, player_count: 1, created_at: 4000 }),
        ];
        const f = computeDenormalizedFields(bookings);
        expect(f.total_bookings).toBe(4);
        expect(f.total_attendees).toBe(4); // refunded still counted (had attendees)
        expect(f.lifetime_value_cents).toBe(60000); // 3 × $200
        expect(f.refund_count).toBe(1);
    });

    it('counts comp bookings in total_bookings + total_attendees but not LTV (comp totals are 0)', () => {
        const bookings = [
            bk({ id: 'b1', status: 'paid', total_cents: 8000, player_count: 1, created_at: 1000 }),
            bk({ id: 'b2', status: 'comp', total_cents: 0, player_count: 1, created_at: 2000 }),
        ];
        const f = computeDenormalizedFields(bookings);
        expect(f.total_bookings).toBe(2);
        expect(f.total_attendees).toBe(2);
        expect(f.lifetime_value_cents).toBe(8000); // comp is $0
        expect(f.refund_count).toBe(0);
    });

    it('excludes abandoned bookings from total_attendees (never had attendee rows)', () => {
        const bookings = [
            bk({ id: 'b1', status: 'paid', player_count: 1, created_at: 1000 }),
            bk({ id: 'b2', status: 'abandoned', player_count: 3, created_at: 2000 }),
        ];
        const f = computeDenormalizedFields(bookings);
        expect(f.total_bookings).toBe(2);
        expect(f.total_attendees).toBe(1); // abandoned skipped
    });

    it('total_attendees sums player_count across non-abandoned bookings', () => {
        const bookings = [
            bk({ id: 'b1', status: 'paid', player_count: 2, created_at: 1000 }),
            bk({ id: 'b2', status: 'paid', player_count: 3, created_at: 2000 }),
            bk({ id: 'b3', status: 'paid', player_count: 1, created_at: 3000 }),
        ];
        const f = computeDenormalizedFields(bookings);
        expect(f.total_attendees).toBe(6);
    });

    it('Sarah-fixture replica: 6 paid + 1 refunded + 1 abandoned (from B1 seed)', () => {
        // Approximate the M3 batch 1 seed for Sarah's group
        const bookings = [
            bk({ status: 'paid', total_cents: 8510, player_count: 1, created_at: 1000 }),
            bk({ status: 'paid', total_cents: 8510, player_count: 1, created_at: 2000 }),
            bk({ status: 'paid', total_cents: 9032, player_count: 1, created_at: 3000 }),
            bk({ status: 'paid', total_cents: 9032, player_count: 1, created_at: 4000 }),
            bk({ status: 'refunded', total_cents: 9032, player_count: 1, created_at: 5000 }),
            bk({ status: 'paid', total_cents: 8510, player_count: 1, created_at: 6000 }),
            bk({ status: 'abandoned', total_cents: 8510, player_count: 1, created_at: 7000 }),
            bk({ status: 'paid', total_cents: 8510, player_count: 1, created_at: 8000 }),
        ];
        const f = computeDenormalizedFields(bookings);
        expect(f.total_bookings).toBe(8);
        expect(f.total_attendees).toBe(7); // 8 - 1 abandoned
        expect(f.lifetime_value_cents).toBe(8510 + 8510 + 9032 + 9032 + 8510 + 8510); // 6 paid only
        expect(f.refund_count).toBe(1);
        expect(f.first_booking_at).toBe(1000);
        expect(f.last_booking_at).toBe(8000);
    });
});

describe('pickDisplayEmailFromGroup', () => {
    it('returns the email from the chronologically earliest booking', () => {
        const bookings = [
            bk({ email: 'Sarah.Chen@gmail.com', created_at: 2000 }),
            bk({ email: 'sarahchen@gmail.com', created_at: 1000 }), // earliest
            bk({ email: 'SARAHCHEN@gmail.com', created_at: 3000 }),
        ];
        expect(pickDisplayEmailFromGroup(bookings)).toBe('sarahchen@gmail.com');
    });

    it('returns null for empty group', () => {
        expect(pickDisplayEmailFromGroup([])).toBe(null);
    });

    it('preserves case from the first-seen booking', () => {
        const bookings = [bk({ email: 'JaneDoe@Outlook.com', created_at: 100 })];
        expect(pickDisplayEmailFromGroup(bookings)).toBe('JaneDoe@Outlook.com');
    });
});

describe('pickDisplayFieldsFromGroup', () => {
    it('returns name + phone from earliest booking', () => {
        const bookings = [
            bk({ full_name: 'Old Name', phone: '5550000', created_at: 2000 }),
            bk({ full_name: 'First Name', phone: '5551111', created_at: 1000 }),
        ];
        const fields = pickDisplayFieldsFromGroup(bookings);
        expect(fields.name).toBe('First Name');
        expect(fields.phone).toBe('5551111');
    });

    it('returns nulls for empty group', () => {
        expect(pickDisplayFieldsFromGroup([])).toEqual({ name: null, phone: null });
    });
});

describe('makeCustomerId', () => {
    it('returns a cus_-prefixed ID', () => {
        const id = makeCustomerId();
        expect(id).toMatch(/^cus_[0-9A-Za-z]{14}$/);
    });

    it('produces unique IDs across calls', () => {
        const ids = new Set();
        for (let i = 0; i < 50; i++) ids.add(makeCustomerId());
        expect(ids.size).toBe(50);
    });
});

describe('escapeSqlString', () => {
    it('quotes simple strings', () => {
        expect(escapeSqlString('hello')).toBe("'hello'");
    });

    it('doubles single quotes', () => {
        expect(escapeSqlString("O'Brien")).toBe("'O''Brien'");
    });

    it('returns NULL (literal) for null/undefined', () => {
        expect(escapeSqlString(null)).toBe('NULL');
        expect(escapeSqlString(undefined)).toBe('NULL');
    });

    it('coerces numbers to strings then quotes', () => {
        expect(escapeSqlString(42)).toBe("'42'");
    });
});

describe('buildBackfillPlan', () => {
    it('creates a new customer per unique normalized email', () => {
        const bookings = [
            bk({ id: 'b1', email: 'sarah@gmail.com' }),
            bk({ id: 'b2', email: 'mike@yahoo.com' }),
        ];
        const plan = buildBackfillPlan({
            bookings,
            existingCustomers: new Map(),
            idGen: () => 'cus_TESTID',
        });
        expect(plan.newCustomers).toHaveLength(2);
        expect(plan.updatedCustomers).toHaveLength(0);
        expect(plan.bookingLinks).toHaveLength(2);
        expect(plan.skippedBookings).toHaveLength(0);
    });

    it('reuses existing customer ID and produces an update entry (idempotency)', () => {
        // Both bookings normalize to 'sarah@gmail.com' (plus-alias stripped).
        const existingCustomers = new Map([
            ['sarah@gmail.com', { id: 'cus_existing_001', email_normalized: 'sarah@gmail.com' }],
        ]);
        const bookings = [
            bk({ id: 'b1', email: 'sarah@gmail.com' }),
            bk({ id: 'b2', email: 'sarah+test@gmail.com' }),  // plus-alias of same person
        ];
        const plan = buildBackfillPlan({ bookings, existingCustomers, idGen: () => 'cus_NEW' });
        expect(plan.newCustomers).toHaveLength(0);
        expect(plan.updatedCustomers).toHaveLength(1);
        expect(plan.updatedCustomers[0].id).toBe('cus_existing_001');
        expect(plan.bookingLinks.every((l) => l.customer_id === 'cus_existing_001')).toBe(true);
    });

    it('records skipped bookings (malformed/null email) without linking', () => {
        const bookings = [
            bk({ id: 'b_malformed', email: 'weird@@example.com' }),
            bk({ id: 'b_null', email: null }),
            bk({ id: 'b_ok', email: 'sarah@gmail.com' }),
        ];
        const plan = buildBackfillPlan({
            bookings,
            existingCustomers: new Map(),
            idGen: () => 'cus_X',
        });
        expect(plan.skippedBookings).toHaveLength(2);
        expect(plan.skippedBookings[0]).toEqual({ booking_id: 'b_malformed', reason: 'malformed_email' });
        expect(plan.skippedBookings[1]).toEqual({ booking_id: 'b_null', reason: 'null_email' });
        expect(plan.bookingLinks).toHaveLength(1); // only b_ok linked
    });
});

describe('planToSql', () => {
    it('emits a sequence of statements without SQL transaction wrapping (D1 remote rejects BEGIN/COMMIT)', () => {
        // M3 B6 fix-up: D1's wrangler execute path forbids SQL `BEGIN
        // TRANSACTION` / `COMMIT` and directs callers to db.batch().
        // Local SQLite accepts them, which masked the issue during B4
        // development. Idempotency is provided by the per-statement
        // semantics + email_normalized UNIQUE INDEX (see planToSql jsdoc).
        const sql = planToSql({ newCustomers: [], updatedCustomers: [], bookingLinks: [], skippedBookings: [] });
        expect(sql).not.toContain('BEGIN TRANSACTION');
        expect(sql).not.toContain('COMMIT');
    });

    it('emits a customer.created audit row for each new customer', () => {
        const plan = {
            newCustomers: [{
                id: 'cus_TEST',
                email: 'sarah@gmail.com',
                email_normalized: 'sarah@gmail.com',
                name: 'Sarah Chen',
                phone: '5550000000',
                fields: { total_bookings: 1, total_attendees: 1, lifetime_value_cents: 8000, refund_count: 0, first_booking_at: 1000, last_booking_at: 1000 },
            }],
            updatedCustomers: [],
            bookingLinks: [],
            skippedBookings: [],
        };
        const sql = planToSql(plan, { now: 9999 });
        expect(sql).toContain('INSERT INTO customers');
        expect(sql).toContain("'customer.created'");
        expect(sql).toContain("'cus_TEST'");
        expect(sql).toContain('"source":"backfill"');
    });

    it('does NOT emit audit row for updated customers', () => {
        const plan = {
            newCustomers: [],
            updatedCustomers: [{
                id: 'cus_existing',
                email_normalized: 'sarah@gmail.com',
                fields: { total_bookings: 5, total_attendees: 5, lifetime_value_cents: 40000, refund_count: 0, first_booking_at: 1000, last_booking_at: 5000 },
            }],
            bookingLinks: [],
            skippedBookings: [],
        };
        const sql = planToSql(plan);
        expect(sql).toContain('UPDATE customers');
        expect(sql).not.toContain("'customer.created'");
    });

    it('updates both bookings and attendees per booking link', () => {
        const plan = {
            newCustomers: [],
            updatedCustomers: [],
            bookingLinks: [{ booking_id: 'bk_x', customer_id: 'cus_y' }],
            skippedBookings: [],
        };
        const sql = planToSql(plan);
        expect(sql).toContain("UPDATE bookings SET customer_id = 'cus_y' WHERE id = 'bk_x'");
        expect(sql).toContain("UPDATE attendees SET customer_id = 'cus_y' WHERE booking_id = 'bk_x'");
    });

    it("handles single-quoted names (O'Brien) without breaking SQL", () => {
        const plan = {
            newCustomers: [{
                id: 'cus_X',
                email: 'obrien@example.com',
                email_normalized: 'obrien@example.com',
                name: "Sean O'Brien",
                phone: '5550000',
                fields: { total_bookings: 1, total_attendees: 1, lifetime_value_cents: 8000, refund_count: 0, first_booking_at: 1, last_booking_at: 1 },
            }],
            updatedCustomers: [],
            bookingLinks: [],
            skippedBookings: [],
        };
        const sql = planToSql(plan);
        expect(sql).toContain("'Sean O''Brien'");
    });
});
