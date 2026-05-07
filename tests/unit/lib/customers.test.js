// M3 Batch 5 — worker/lib/customers.js characterization tests.
//
// findOrCreateCustomerForBooking returns customer_id (idempotent on
// email_normalized; emits customer.created audit row on INSERT).
// recomputeCustomerDenormalizedFields rebuilds aggregates from bookings.
//
// All tests use mockD1 — no real D1 / Stripe / Resend involvement.

import { describe, it, expect } from 'vitest';
import {
    findOrCreateCustomerForBooking,
    recomputeCustomerDenormalizedFields,
} from '../../../worker/lib/customers.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findOrCreateCustomerForBooking', () => {
    it('returns null when email is null (no DB writes)', async () => {
        const db = createMockD1();
        const id = await findOrCreateCustomerForBooking(db, {
            email: null,
            name: 'Alice',
            phone: '5551234567',
        });
        expect(id).toBeNull();
        const writes = db.__writes();
        const inserts = writes.filter((w) => w.kind === 'run' && /INSERT/.test(w.sql));
        expect(inserts).toHaveLength(0);
        const selects = writes.filter((w) => w.kind === 'first');
        expect(selects).toHaveLength(0);
    });

    it('returns null when email is malformed (no DB writes)', async () => {
        const db = createMockD1();
        const id = await findOrCreateCustomerForBooking(db, {
            email: 'not-an-email',
            name: 'Alice',
            phone: '5551234567',
        });
        expect(id).toBeNull();
        const inserts = db.__writes().filter((w) => w.kind === 'run' && /INSERT/.test(w.sql));
        expect(inserts).toHaveLength(0);
    });

    it('returns existing customer id when email_normalized matches an active row (no INSERT)', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM customers WHERE email_normalized/, { id: 'cus_existing' }, 'first');

        const id = await findOrCreateCustomerForBooking(db, {
            email: 'alice@example.com',
            name: 'Alice Smith',
            phone: '5551234567',
        });
        expect(id).toBe('cus_existing');

        const inserts = db.__writes().filter(
            (w) => w.kind === 'run' && /INSERT INTO customers/.test(w.sql),
        );
        expect(inserts).toHaveLength(0);
        const auditInserts = db.__writes().filter(
            (w) => w.kind === 'run' && /'customer\.created'/.test(w.sql),
        );
        expect(auditInserts).toHaveLength(0);
    });

    it('Gmail dot-variant + plus-alias match the same active customer', async () => {
        // Tests that the SELECT query receives the canonicalized address.
        // alice.smith+test@gmail.com normalizes to alicesmith@gmail.com.
        const db = createMockD1();
        let receivedNormalized = null;
        db.__on(/SELECT id FROM customers WHERE email_normalized/, (sql, args) => {
            receivedNormalized = args[0];
            return { id: 'cus_alice' };
        }, 'first');

        const id = await findOrCreateCustomerForBooking(db, {
            email: '  Alice.Smith+TEST@Gmail.COM  ',
            name: 'Alice',
            phone: null,
        });
        expect(id).toBe('cus_alice');
        expect(receivedNormalized).toBe('alicesmith@gmail.com');
    });

    it('non-Gmail dots are significant (treated as distinct addresses)', async () => {
        const db = createMockD1();
        let receivedNormalized = null;
        db.__on(/SELECT id FROM customers WHERE email_normalized/, (sql, args) => {
            receivedNormalized = args[0];
            return null;  // no match → goes to INSERT path
        }, 'first');

        await findOrCreateCustomerForBooking(db, {
            email: 'john.doe@yahoo.com',
            name: 'John',
            phone: null,
        });
        // dots preserved on non-gmail providers (matches backfill helper).
        expect(receivedNormalized).toBe('john.doe@yahoo.com');
    });

    it('creates a new customer when no active row matches; emits customer.created audit row', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM customers WHERE email_normalized/, null, 'first');

        const id = await findOrCreateCustomerForBooking(db, {
            email: 'bob@example.com',
            name: 'Bob Jones',
            phone: '5559999999',
            actorUserId: 'u_actor',
        });
        expect(id).toMatch(/^cus_[A-Za-z0-9]{14}$/);

        const writes = db.__writes();

        const customerInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO customers/.test(w.sql),
        );
        expect(customerInsert).toBeTruthy();
        // bind layout: 0:id 1:email 2:email_normalized 3:name 4:phone 5:created_at 6:updated_at
        expect(customerInsert.args[0]).toBe(id);
        expect(customerInsert.args[1]).toBe('bob@example.com');
        expect(customerInsert.args[2]).toBe('bob@example.com');
        expect(customerInsert.args[3]).toBe('Bob Jones');
        expect(customerInsert.args[4]).toBe('5559999999');

        const auditInsert = writes.find(
            (w) => w.kind === 'run' && /'customer\.created'/.test(w.sql),
        );
        expect(auditInsert).toBeTruthy();
        expect(auditInsert.args[0]).toBe('u_actor');         // user_id (actorUserId)
        expect(auditInsert.args[1]).toBe(id);                // target_id = customer id
        const meta = JSON.parse(auditInsert.args[2]);
        expect(meta.source).toBe('dual_write');
        expect(meta.normalized_email).toBe('bob@example.com');
    });

    it('writes user_id=NULL on the audit row when called without actorUserId (webhook context)', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM customers WHERE email_normalized/, null, 'first');

        await findOrCreateCustomerForBooking(db, {
            email: 'cara@example.com',
            name: 'Cara',
            phone: null,
        });

        const auditInsert = db.__writes().find(
            (w) => w.kind === 'run' && /'customer\.created'/.test(w.sql),
        );
        expect(auditInsert).toBeTruthy();
        expect(auditInsert.args[0]).toBeNull();
    });

    it('SELECT filter scopes lookup to active customers (archived_at IS NULL)', async () => {
        const db = createMockD1();
        let receivedSql = null;
        db.__on(/SELECT id FROM customers WHERE email_normalized/, (sql) => {
            receivedSql = sql;
            return null;
        }, 'first');

        await findOrCreateCustomerForBooking(db, {
            email: 'dan@example.com',
            name: 'Dan',
            phone: null,
        });
        expect(receivedSql).toMatch(/archived_at IS NULL/);
    });
});

describe('recomputeCustomerDenormalizedFields', () => {
    it('is a no-op when customerId is null or undefined', async () => {
        const db = createMockD1();
        await recomputeCustomerDenormalizedFields(db, null);
        await recomputeCustomerDenormalizedFields(db, undefined);
        await recomputeCustomerDenormalizedFields(db, '');
        const writes = db.__writes();
        expect(writes).toHaveLength(0);
    });

    it('aggregates paid LTV / refund_count / total_attendees / first/last_booking_at correctly', async () => {
        const db = createMockD1();
        db.__on(/SELECT status, total_cents, player_count, created_at[\s\S]*FROM bookings WHERE customer_id/, {
            results: [
                { status: 'paid',      total_cents: 8000,  player_count: 2, created_at: 1000 },
                { status: 'paid',      total_cents: 16000, player_count: 4, created_at: 2000 },
                { status: 'refunded',  total_cents: 8000,  player_count: 1, created_at: 3000 },
                { status: 'comp',      total_cents: 0,     player_count: 1, created_at: 500  },
                { status: 'abandoned', total_cents: 0,     player_count: 1, created_at: 4000 },
            ],
        }, 'all');

        await recomputeCustomerDenormalizedFields(db, 'cus_abc');

        const update = db.__writes().find(
            (w) => w.kind === 'run' && /UPDATE customers SET/.test(w.sql),
        );
        expect(update).toBeTruthy();
        // bind order: total_bookings, total_attendees, lifetime_value_cents,
        //             refund_count, first_booking_at, last_booking_at, updated_at, id
        expect(update.args[0]).toBe(5);                     // total_bookings (count of all rows)
        expect(update.args[1]).toBe(2 + 4 + 1 + 1);          // total_attendees (skip abandoned)
        expect(update.args[2]).toBe(8000 + 16000);           // LTV (paid only)
        expect(update.args[3]).toBe(1);                      // refund_count
        expect(update.args[4]).toBe(500);                    // first_booking_at (min)
        expect(update.args[5]).toBe(4000);                   // last_booking_at (max)
        expect(update.args[7]).toBe('cus_abc');              // WHERE id
    });

    it('handles the empty-bookings case (no rows linked) — first/last_booking_at NULL', async () => {
        const db = createMockD1();
        db.__on(/FROM bookings WHERE customer_id/, { results: [] }, 'all');

        await recomputeCustomerDenormalizedFields(db, 'cus_empty');

        const update = db.__writes().find(
            (w) => w.kind === 'run' && /UPDATE customers SET/.test(w.sql),
        );
        expect(update).toBeTruthy();
        expect(update.args[0]).toBe(0);                      // total_bookings
        expect(update.args[1]).toBe(0);                      // total_attendees
        expect(update.args[2]).toBe(0);                      // LTV
        expect(update.args[3]).toBe(0);                      // refund_count
        expect(update.args[4]).toBeNull();                   // first_booking_at
        expect(update.args[5]).toBeNull();                   // last_booking_at
    });
});
