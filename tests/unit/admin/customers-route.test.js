// M3 Batch 8a — admin customers route tests.
//
// Covers GET /api/admin/customers (list), GET /api/admin/customers/:id
// (detail), and POST /api/admin/customers/merge (manager+ archives
// duplicates, re-points bookings/attendees, recomputes primary).

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function fetchJson(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

describe('GET /api/admin/customers — list', () => {
    it('returns paginated active customers by default (archived hidden)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM customers/, { n: 2 }, 'first');
        env.DB.__on(/FROM customers WHERE archived_at IS NULL/, {
            results: [
                { id: 'cus_A', email: 'a@x.com', email_normalized: 'a@x.com', name: 'Alice',
                  phone: null, total_bookings: 1, total_attendees: 1, lifetime_value_cents: 8000,
                  refund_count: 0, first_booking_at: 1000, last_booking_at: 1000,
                  email_transactional: 1, email_marketing: 1, sms_transactional: 0, sms_marketing: 0,
                  notes: null, archived_at: null, archived_reason: null, archived_by: null,
                  merged_into: null, created_at: 1000, updated_at: 1000 },
                { id: 'cus_B', email: 'b@x.com', email_normalized: 'b@x.com', name: 'Bob',
                  phone: null, total_bookings: 2, total_attendees: 4, lifetime_value_cents: 32000,
                  refund_count: 0, first_booking_at: 2000, last_booking_at: 5000,
                  email_transactional: 1, email_marketing: 1, sms_transactional: 0, sms_marketing: 0,
                  notes: null, archived_at: null, archived_reason: null, archived_by: null,
                  merged_into: null, created_at: 2000, updated_at: 5000 },
            ],
        }, 'all');

        const res = await worker.fetch(fetchJson('/api/admin/customers', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total).toBe(2);
        expect(json.customers).toHaveLength(2);
        expect(json.customers[0].id).toBe('cus_A');
        expect(json.customers[0].lifetimeValueCents).toBe(8000);
        expect(json.customers[0].emailTransactional).toBe(true); // boolean coerced from 1
    });

    it('q parameter binds %lowercased%-needle for email/name search', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM customers/, { n: 0 }, 'first');
        env.DB.__on(/FROM customers WHERE archived_at IS NULL AND \(LOWER\(email\) LIKE \? OR LOWER\(name\) LIKE \?\)/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(fetchJson('/api/admin/customers?q=Alice', { headers: { cookie: cookieHeader } }), env, {});
        // bind 0/1 = the LIKE needle (twice), bind 2 = limit, bind 3 = offset
        expect(capturedBinds[0]).toBe('%alice%');
        expect(capturedBinds[1]).toBe('%alice%');
    });

    it('archived=true filters to archived rows only', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM customers/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/FROM customers/, { results: [] }, 'all');

        await worker.fetch(fetchJson('/api/admin/customers?archived=true', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/archived_at IS NOT NULL/);
        expect(capturedSql).not.toMatch(/archived_at IS NULL/);
    });

    it('archived=all skips the archived filter entirely', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM customers/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/FROM customers/, { results: [] }, 'all');

        await worker.fetch(fetchJson('/api/admin/customers?archived=all', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).not.toMatch(/archived_at/);
    });

    it('limit clamps to 200 max even when query asks for more', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM customers/, { n: 0 }, 'first');
        env.DB.__on(/FROM customers/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(fetchJson('/api/admin/customers?limit=5000', { headers: { cookie: cookieHeader } }), env, {});
        // last 2 binds are limit, offset
        expect(capturedBinds[capturedBinds.length - 2]).toBe(200);
        expect(capturedBinds[capturedBinds.length - 1]).toBe(0);
    });
});

describe('GET /api/admin/customers/:id — detail', () => {
    it('returns customer + bookings + tags', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, {
            id: 'cus_A', email: 'a@x.com', email_normalized: 'a@x.com', name: 'Alice',
            phone: null, total_bookings: 2, total_attendees: 4, lifetime_value_cents: 16000,
            refund_count: 1, first_booking_at: 1000, last_booking_at: 5000,
            email_transactional: 1, email_marketing: 1, sms_transactional: 0, sms_marketing: 0,
            notes: 'VIP', archived_at: null, archived_reason: null, archived_by: null,
            merged_into: null, created_at: 1000, updated_at: 5000,
        }, 'first');

        env.DB.__on(/FROM bookings b\s+LEFT JOIN events e/, {
            results: [
                { id: 'bk_1', event_id: 'ev_x', full_name: 'Alice', email: 'a@x.com',
                  status: 'paid', subtotal_cents: 8000, tax_cents: 240, fee_cents: 268,
                  total_cents: 8508, payment_method: 'card', created_at: 1000,
                  paid_at: 1100, refunded_at: null,
                  event_title: 'Operation Nightfall', event_date_iso: '2026-05-09T08:00:00' },
                { id: 'bk_2', event_id: 'ev_x', full_name: 'Alice', email: 'a@x.com',
                  status: 'refunded', subtotal_cents: 8000, tax_cents: 240, fee_cents: 268,
                  total_cents: 8508, payment_method: 'cash', created_at: 5000,
                  paid_at: 5100, refunded_at: 6000,
                  event_title: 'Operation Nightfall', event_date_iso: '2026-05-09T08:00:00' },
            ],
        }, 'all');

        env.DB.__on(/FROM customer_tags\s+WHERE customer_id/, {
            results: [
                { tag: 'VIP', tag_type: 'manual', created_at: 5000, created_by: 'u_admin' },
                { tag: 'returning', tag_type: 'system', created_at: 6000, created_by: null },
            ],
        }, 'all');

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_A', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.customer.id).toBe('cus_A');
        expect(json.customer.notes).toBe('VIP');
        expect(json.bookings).toHaveLength(2);
        expect(json.bookings[0].eventTitle).toBe('Operation Nightfall');
        expect(json.bookings[1].status).toBe('refunded');
        expect(json.tags).toHaveLength(2);
        expect(json.tags[0].tagType).toBe('manual');
        expect(json.tags[1].tagType).toBe('system');
    });

    it('returns 404 for unknown customer id', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        // No __on for SELECT customers — defaults to null

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_unknown', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/Not found/i);
    });
});

// ────────────────────────────────────────────────────────────────────
// M5.5 B9 — formatCustomer + GET /:id field_rentals JOIN
// ────────────────────────────────────────────────────────────────────

describe('M5.5 B9 — formatCustomer business fields', () => {
    function baseRow(overrides = {}) {
        return {
            id: 'cus_test', email: 't@x.com', email_normalized: 't@x.com', name: 'Test',
            phone: null, total_bookings: 0, total_attendees: 0, lifetime_value_cents: 0,
            refund_count: 0, first_booking_at: null, last_booking_at: null,
            email_transactional: 1, email_marketing: 1, sms_transactional: 0, sms_marketing: 0,
            notes: null, archived_at: null, archived_reason: null, archived_by: null,
            merged_into: null, created_at: 1000, updated_at: 1000,
            ...overrides,
        };
    }

    it('exposes clientType (defaults to "individual" when row missing the column)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow(), 'first');

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_test', { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.customer.clientType).toBe('individual');
    });

    it('surfaces businessName and businessWebsite when clientType=business', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow({
            client_type: 'business',
            business_name: 'Acme Tactical LLC',
            business_website: 'https://acme-tactical.example',
        }), 'first');

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_test', { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.customer.clientType).toBe('business');
        expect(json.customer.businessName).toBe('Acme Tactical LLC');
        expect(json.customer.businessWebsite).toBe('https://acme-tactical.example');
    });

    it('null business_name/website surface as null (not undefined)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow({
            client_type: 'business', business_name: null, business_website: null,
        }), 'first');

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_test', { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.customer.businessName).toBeNull();
        expect(json.customer.businessWebsite).toBeNull();
    });

    it('list endpoint also surfaces clientType in each row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM customers/, { n: 1 }, 'first');
        env.DB.__on(/FROM customers WHERE archived_at IS NULL/, {
            results: [baseRow({ id: 'cus_biz', client_type: 'business', business_name: 'Acme' })],
        }, 'all');

        const res = await worker.fetch(fetchJson('/api/admin/customers', { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.customers[0].clientType).toBe('business');
        expect(json.customers[0].businessName).toBe('Acme');
    });
});

describe('M5.5 B9 — GET /:id field_rentals JOIN', () => {
    function baseRow(overrides = {}) {
        return {
            id: 'cus_test', email: 't@x.com', email_normalized: 't@x.com', name: 'Test',
            phone: null, total_bookings: 0, total_attendees: 0, lifetime_value_cents: 0,
            refund_count: 0, first_booking_at: null, last_booking_at: null,
            email_transactional: 1, email_marketing: 1, sms_transactional: 0, sms_marketing: 0,
            notes: null, archived_at: null, archived_reason: null, archived_by: null,
            merged_into: null, created_at: 1000, updated_at: 1000,
            ...overrides,
        };
    }

    it('returns fieldRentals: [] when customer has no rentals', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow(), 'first');

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_test', { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.fieldRentals).toEqual([]);
    });

    it('returns fieldRentals with formatted rows when rentals exist', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow({ client_type: 'business' }), 'first');
        env.DB.__on(/FROM field_rentals\s+WHERE customer_id = \?\s+ORDER BY scheduled_starts_at/, {
            results: [
                {
                    id: 'fr_001', status: 'paid',
                    scheduled_starts_at: 1000, scheduled_ends_at: 2000,
                    total_cents: 50000, coi_status: 'received', coi_expires_at: 99000,
                    archived_at: null, engagement_type: 'paintball',
                },
                {
                    id: 'fr_002', status: 'lead',
                    scheduled_starts_at: 500, scheduled_ends_at: 1500,
                    total_cents: 25000, coi_status: 'pending', coi_expires_at: null,
                    archived_at: null, engagement_type: 'film_shoot',
                },
            ],
        }, 'all');

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_test', { headers: { cookie: cookieHeader } }), env, {});
        const json = await res.json();
        expect(json.fieldRentals).toHaveLength(2);
        expect(json.fieldRentals[0].id).toBe('fr_001');
        expect(json.fieldRentals[0].status).toBe('paid');
        expect(json.fieldRentals[0].scheduledStartsAt).toBe(1000);
        expect(json.fieldRentals[0].totalCents).toBe(50000);
        expect(json.fieldRentals[0].coiStatus).toBe('received');
        expect(json.fieldRentals[0].engagementType).toBe('paintball');
        expect(json.fieldRentals[1].id).toBe('fr_002');
    });

    it('field_rentals query is bounded by LIMIT 100 and ORDER BY scheduled_starts_at DESC', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow(), 'first');

        let capturedSql = '';
        env.DB.__on(/FROM field_rentals\s+WHERE customer_id/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(fetchJson('/api/admin/customers/cus_test', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/ORDER BY scheduled_starts_at DESC/);
        expect(capturedSql).toMatch(/LIMIT 100/);
    });

    it('degrades to empty fieldRentals when field_rentals query throws', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow(), 'first');
        env.DB.__on(/FROM field_rentals\s+WHERE customer_id/, () => {
            throw new Error('no such table: field_rentals');
        }, 'all');

        const res = await worker.fetch(fetchJson('/api/admin/customers/cus_test', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.fieldRentals).toEqual([]);
    });

    it('field_rentals query binds the customer_id', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, baseRow({ id: 'cus_xyz' }), 'first');

        let capturedBinds = null;
        env.DB.__on(/FROM field_rentals\s+WHERE customer_id/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(fetchJson('/api/admin/customers/cus_xyz', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toEqual(['cus_xyz']);
    });
});

describe('POST /api/admin/customers/merge', () => {
    it('happy path: archives duplicate, re-points bookings/attendees, audits, recomputes primary', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        // Match `SELECT id, archived_at FROM customers WHERE id = ?` for both
        // primary lookup and per-duplicate validation. Distinguish by the
        // bind argument.
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, (sql, args) => {
            const id = args[0];
            // Primary + duplicate both active
            if (id === 'cus_primary' || id === 'cus_dup') {
                return { id, archived_at: null };
            }
            return null;
        }, 'first');

        // recomputeCustomerDenormalizedFields will run a SELECT on bookings
        // for the primary; mock it minimally so it doesn't throw.
        env.DB.__on(/SELECT status, total_cents, player_count, created_at[\s\S]*FROM bookings WHERE customer_id/, {
            results: [
                { status: 'paid', total_cents: 8000, player_count: 1, created_at: 1000 },
            ],
        }, 'all');

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/merge', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ primaryId: 'cus_primary', duplicateIds: ['cus_dup'] }),
            }),
            env, {}
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.primaryId).toBe('cus_primary');
        expect(json.archivedCount).toBe(1);

        const writes = env.DB.__writes();
        // Bookings re-pointed
        const bookingsRetarget = writes.find((w) =>
            w.kind === 'run' && /UPDATE bookings SET customer_id = \? WHERE customer_id = \?/.test(w.sql)
        );
        expect(bookingsRetarget).toBeTruthy();
        expect(bookingsRetarget.args).toEqual(['cus_primary', 'cus_dup']);

        // Attendees re-pointed
        const attendeesRetarget = writes.find((w) =>
            w.kind === 'run' && /UPDATE attendees SET customer_id = \? WHERE customer_id = \?/.test(w.sql)
        );
        expect(attendeesRetarget).toBeTruthy();

        // Duplicate archived with merged_into=primary
        const archive = writes.find((w) =>
            w.kind === 'run' && /UPDATE customers SET[\s\S]*archived_at = \?[\s\S]*archived_reason = 'merged'/.test(w.sql)
        );
        expect(archive).toBeTruthy();
        // bind layout: 0:archived_at, 1:archived_by, 2:merged_into, 3:updated_at, 4:id
        expect(archive.args[1]).toBe('u_actor');
        expect(archive.args[2]).toBe('cus_primary');
        expect(archive.args[4]).toBe('cus_dup');

        // customer.merged audit row
        const auditMerged = writes.find((w) =>
            w.kind === 'run' && /INSERT INTO audit_log/.test(w.sql) && w.args[1] === 'customer.merged'
        );
        expect(auditMerged).toBeTruthy();
        expect(auditMerged.args[0]).toBe('u_actor'); // user_id
        expect(auditMerged.args[3]).toBe('cus_dup'); // target_id
        expect(JSON.parse(auditMerged.args[4]).merged_into).toBe('cus_primary');

        // Primary recompute happened (UPDATE customers SET total_bookings=...)
        const recompute = writes.find((w) =>
            w.kind === 'run' && /UPDATE customers SET\s+total_bookings/.test(w.sql)
        );
        expect(recompute).toBeTruthy();
    });

    it('refuses self-merge with 400', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/merge', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ primaryId: 'cus_x', duplicateIds: ['cus_x'] }),
            }),
            env, {}
        );
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/self-merge/i);
    });

    it('refuses already-archived primary with 409', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, (sql, args) => {
            if (args[0] === 'cus_primary_archived') return { id: 'cus_primary_archived', archived_at: 9999 };
            return null;
        }, 'first');

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/merge', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ primaryId: 'cus_primary_archived', duplicateIds: ['cus_dup'] }),
            }),
            env, {}
        );
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.error).toMatch(/archived/i);
    });

    it('staff role gets 403 (manager+ required)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/merge', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ primaryId: 'cus_a', duplicateIds: ['cus_b'] }),
            }),
            env, {}
        );
        expect(res.status).toBe(403);
    });
});

describe('POST /api/admin/customers/:id/gdpr-delete (B11)', () => {
    it('happy path: redacts personal fields, archives, writes gdpr_deletions + audit row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'owner' });

        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, (sql, args) => {
            if (args[0] === 'cus_target') return { id: 'cus_target', archived_at: null };
            return null;
        }, 'first');

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/cus_target/gdpr-delete', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestedVia: 'GDPR',
                    reason: 'User invoked right to erasure',
                    retentionUntil: 9_999_999_999_999,
                }),
            }),
            env, {}
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.customerId).toBe('cus_target');
        expect(typeof json.archivedAt).toBe('number');

        const writes = env.DB.__writes();

        // Customer redacted + archived
        const redact = writes.find((w) =>
            w.kind === 'run' && /UPDATE customers SET[\s\S]*archived_reason = 'gdpr_delete'/.test(w.sql)
        );
        expect(redact).toBeTruthy();
        // bind 0/1 = redacted email values; both should match the gdpr-deleted format
        expect(redact.args[0]).toMatch(/^gdpr-deleted\+cus_target@redacted\.local$/);
        expect(redact.args[1]).toMatch(/^gdpr-deleted\+cus_target@redacted\.local$/);
        // bind 3 = archived_by user id
        expect(redact.args[3]).toBe('u_actor');
        // bind 5 (last) = id
        expect(redact.args[5]).toBe('cus_target');

        // Tags dropped
        const tagsDelete = writes.find((w) =>
            w.kind === 'run' && /DELETE FROM customer_tags WHERE customer_id = \?/.test(w.sql)
        );
        expect(tagsDelete).toBeTruthy();
        expect(tagsDelete.args[0]).toBe('cus_target');

        // gdpr_deletions audit row
        const gdprInsert = writes.find((w) =>
            w.kind === 'run' && /INSERT INTO gdpr_deletions/.test(w.sql)
        );
        expect(gdprInsert).toBeTruthy();
        // args: customer_id, reason, requested_via, requested_at, deleted_at, deleted_by, retention_until, notes
        expect(gdprInsert.args[0]).toBe('cus_target');
        expect(gdprInsert.args[1]).toBe('User invoked right to erasure');
        expect(gdprInsert.args[2]).toBe('GDPR');
        expect(gdprInsert.args[5]).toBe('u_actor');
        expect(gdprInsert.args[6]).toBe(9_999_999_999_999);

        // customer.gdpr_deleted audit row (via writeAudit)
        const audit = writes.find((w) =>
            w.kind === 'run' && /INSERT INTO audit_log/.test(w.sql) && w.args[1] === 'customer.gdpr_deleted'
        );
        expect(audit).toBeTruthy();
        expect(audit.args[0]).toBe('u_actor');
        expect(audit.args[3]).toBe('cus_target');
        expect(JSON.parse(audit.args[4]).requestedVia).toBe('GDPR');
    });

    it('refuses already-archived customer with 409', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'owner' });

        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/,
            { id: 'cus_archived', archived_at: 9_999 }, 'first');

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/cus_archived/gdpr-delete', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestedVia: 'manual' }),
            }),
            env, {}
        );
        expect(res.status).toBe(409);
    });

    it('returns 404 for unknown customer', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'owner' });
        // No __on registered → SELECT returns null

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/cus_unknown/gdpr-delete', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestedVia: 'manual' }),
            }),
            env, {}
        );
        expect(res.status).toBe(404);
    });

    it('manager role gets 403 (owner-only)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/cus_x/gdpr-delete', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestedVia: 'manual' }),
            }),
            env, {}
        );
        expect(res.status).toBe(403);
    });

    it('rejects invalid requestedVia with 400', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'owner' });

        const res = await worker.fetch(
            fetchJson('/api/admin/customers/cus_x/gdpr-delete', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestedVia: 'invalid-value' }),
            }),
            env, {}
        );
        expect(res.status).toBe(400);
    });
});
