// M4 Batch 2b — GET /api/admin/bookings/export.csv
//
// Streams a CSV with one header row + one row per matched booking.
// Hard cap of 10k rows. Same query params as GET /. Audit row written
// per export. requireRole('owner', 'manager') — staff is 403.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

function buildReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

describe('GET /api/admin/bookings/export.csv', () => {
    it('returns text/csv with attachment Content-Disposition', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        env.DB.__on(/FROM bookings b\s+LEFT JOIN events/, { results: [] }, 'all');

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/export.csv', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toMatch(/^text\/csv/);
        expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.csv"$/);
    });

    it('emits header row + one row per booking matching the filter', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        env.DB.__on(/FROM bookings b\s+LEFT JOIN events/, {
            results: [
                {
                    id: 'bk_1', event_id: 'ev_1', event_title: 'Op Nightfall', event_date_iso: '2026-05-09T08:30:00',
                    full_name: 'Alice', email: 'a@x.c', phone: null, player_count: 2,
                    status: 'paid', payment_method: 'cash',
                    subtotal_cents: 16000, tax_cents: 0, fee_cents: 0, total_cents: 16000,
                    created_at: 1000, paid_at: 1000, refunded_at: null,
                    customer_id: 'cus_a', notes: null,
                },
                {
                    id: 'bk_2', event_id: 'ev_1', event_title: 'Op Nightfall', event_date_iso: '2026-05-09T08:30:00',
                    full_name: 'Bob', email: 'b@x.c', phone: '555-1234', player_count: 1,
                    status: 'refunded', payment_method: 'card',
                    subtotal_cents: 8000, tax_cents: 0, fee_cents: 0, total_cents: 8000,
                    created_at: 2000, paid_at: 2000, refunded_at: 3000,
                    customer_id: 'cus_b', notes: 'late entry',
                },
            ],
        }, 'all');

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/export.csv', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const body = await res.text();
        const lines = body.split('\n');
        expect(lines).toHaveLength(3); // header + 2 rows
        expect(lines[0]).toBe('id,event_id,event_title,event_date_iso,full_name,email,phone,player_count,status,payment_method,subtotal_cents,tax_cents,fee_cents,total_cents,created_at,paid_at,refunded_at,customer_id,notes');
        expect(lines[1]).toContain('bk_1');
        expect(lines[1]).toContain('Alice');
        expect(lines[2]).toContain('bk_2');
        expect(lines[2]).toContain('555-1234');
    });

    it('escapes commas/quotes/newlines per RFC 4180', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        env.DB.__on(/FROM bookings b\s+LEFT JOIN events/, {
            results: [
                {
                    id: 'bk_x', event_id: 'ev_x', event_title: 'Op, with comma', event_date_iso: '2026-05-09',
                    full_name: 'O\'Brien, "Doc"', email: 'o@x.c', phone: null, player_count: 1,
                    status: 'paid', payment_method: 'cash',
                    subtotal_cents: 8000, tax_cents: 0, fee_cents: 0, total_cents: 8000,
                    created_at: 1, paid_at: 1, refunded_at: null,
                    customer_id: null, notes: 'multi\nline note',
                },
            ],
        }, 'all');

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/export.csv', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        const body = await res.text();
        // Comma-containing field wrapped in quotes
        expect(body).toContain('"Op, with comma"');
        // Quote-containing field: doubled quote
        expect(body).toContain('"O\'Brien, ""Doc"""');
        // Newline-containing field wrapped
        expect(body).toContain('"multi\nline note"');
    });

    it('writes booking.exported_csv audit row with row_count + filters in meta_json', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        env.DB.__on(/FROM bookings b\s+LEFT JOIN events/, {
            results: [{ id: 'bk_1', event_id: null, event_title: null, event_date_iso: null,
                full_name: 'X', email: null, phone: null, player_count: 1, status: 'paid',
                payment_method: null, subtotal_cents: 0, tax_cents: 0, fee_cents: 0, total_cents: 0,
                created_at: 1, paid_at: null, refunded_at: null, customer_id: null, notes: null }],
        }, 'all');

        // Action 'booking.exported_csv' is hardcoded in the SQL; binds are
        // (user_id, meta_json, created_at).
        let auditMeta = null;
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => {
            if (/'booking\.exported_csv'/.test(sql)) auditMeta = JSON.parse(args[1]);
            return { meta: { changes: 1 } };
        }, 'run');

        await worker.fetch(
            buildReq('/api/admin/bookings/export.csv?status=paid&payment_method=cash', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(auditMeta).not.toBeNull();
        expect(auditMeta.row_count).toBe(1);
        expect(auditMeta.filters).toEqual({ status: 'paid', payment_method: 'cash' });
    });

    it('caps result at EXPORT_LIMIT (10k) — bind on the SELECT', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedBinds = null;
        env.DB.__on(/FROM bookings b\s+LEFT JOIN events/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            buildReq('/api/admin/bookings/export.csv', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(capturedBinds).toContain(10_000);
    });

    it('passes filter through buildBookingsListFilter (status param applies to SELECT)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let capturedSql = '';
        env.DB.__on(/FROM bookings b\s+LEFT JOIN events/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            buildReq('/api/admin/bookings/export.csv?status=paid', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(capturedSql).toMatch(/status = \?/);
    });

    it('403 when caller is staff role', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_s', role: 'staff' });
        const res = await worker.fetch(
            buildReq('/api/admin/bookings/export.csv', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });
});
