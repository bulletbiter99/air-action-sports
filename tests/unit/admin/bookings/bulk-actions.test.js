// M4 Batch 2b — bulk action endpoints on /api/admin/bookings.
//
//   POST /bulk/resend-confirmation   body: { bookingIds: string[] }
//   POST /bulk/resend-waiver-request body: { bookingIds: string[] }
//
// Both endpoints require role manager+ (staff is 403). Per-booking
// outcomes aggregated into { sent, skipped, failed, errors }. Audit
// row written per successful send.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockResendFetch } from '../../../helpers/mockResend.js';

function buildReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

async function postBulk(env, cookieHeader, path, body) {
    return await worker.fetch(
        buildReq(path, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env,
        {},
    );
}

// Stub loadTemplate's SELECT — without it, sendBookingConfirmation /
// sendWaiverRequest short-circuit with { skipped: 'template_missing' }.
function bindTemplateLookup(env) {
    env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, (sql, args) => ({
        slug: args[0],
        subject_html: 'Subject',
        body_html: '<p>Body</p>',
        body_text: 'Body',
        variables_json: '[]',
    }), 'first');
}

describe('POST /api/admin/bookings/bulk/resend-confirmation', () => {
    it('sends confirmations to paid + comp bookings, audits each, returns aggregate counts', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });
        bindTemplateLookup(env);

        const bookings = {
            bk_1: { id: 'bk_1', event_id: 'ev_1', email: 'a@b.c', status: 'paid', full_name: 'A', total_cents: 8000, player_count: 1 },
            bk_2: { id: 'bk_2', event_id: 'ev_1', email: 'c@d.e', status: 'comp', full_name: 'C', total_cents: 0, player_count: 1 },
        };
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, (sql, args) => bookings[args[0]] ?? null, 'first');
        env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
            id: 'ev_1', title: 'Op', display_date: 'May 9', location: 'Ghost Town',
        }, 'first');
        env.DB.__on(/SELECT id, waiver_id FROM attendees WHERE booking_id = \?/, { results: [] }, 'all');

        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', {
            bookingIds: ['bk_1', 'bk_2'],
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sent).toBe(2);
        expect(json.skipped).toBe(0);
        expect(json.failed).toBe(0);

        // Action 'booking.confirmation_resent_bulk' is hardcoded in the SQL
        // string; the binds are (user_id, booking_id, meta_json, created_at).
        const writes = env.DB.__writes();
        const audits = writes.filter((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            /'booking\.confirmation_resent_bulk'/.test(w.sql)
        );
        expect(audits).toHaveLength(2);
        expect(audits.map((a) => a.args[1]).sort()).toEqual(['bk_1', 'bk_2']);
    });

    it('skips bookings whose status is not paid or comp', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });
        bindTemplateLookup(env);

        const bookings = {
            bk_paid: { id: 'bk_paid', event_id: 'ev_1', email: 'a@b.c', status: 'paid', full_name: 'A', total_cents: 8000, player_count: 1 },
            bk_pending: { id: 'bk_pending', event_id: 'ev_1', email: 'b@b.c', status: 'pending', full_name: 'B', total_cents: 0, player_count: 1 },
            bk_cancelled: { id: 'bk_cancelled', event_id: 'ev_1', email: 'c@b.c', status: 'cancelled', full_name: 'C', total_cents: 0, player_count: 1 },
        };
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, (sql, args) => bookings[args[0]] ?? null, 'first');
        env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
            id: 'ev_1', title: 'Op', display_date: 'May 9', location: 'Ghost Town',
        }, 'first');
        env.DB.__on(/SELECT id, waiver_id FROM attendees WHERE booking_id = \?/, { results: [] }, 'all');

        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', {
            bookingIds: ['bk_paid', 'bk_pending', 'bk_cancelled'],
        });
        const json = await res.json();
        expect(json.sent).toBe(1);
        expect(json.skipped).toBe(2);
    });

    it('counts not_found bookings as failed with reason', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, null, 'first');

        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', {
            bookingIds: ['bk_missing'],
        });
        const json = await res.json();
        expect(json.failed).toBe(1);
        expect(json.errors[0]).toEqual({ id: 'bk_missing', reason: 'not_found' });
    });

    it('403 when caller is staff role', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', {
            bookingIds: ['bk_1'],
        });
        expect(res.status).toBe(403);
    });

    it('400 when bookingIds is missing or empty', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        let res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', {});
        expect(res.status).toBe(400);

        res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', { bookingIds: [] });
        expect(res.status).toBe(400);
    });

    it('400 when bookingIds contains non-string entries', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });
        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', {
            bookingIds: ['ok', 123, null],
        });
        expect(res.status).toBe(400);
    });

    it('400 when bookingIds exceeds BULK_MAX (100)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });
        const ids = Array.from({ length: 101 }, (_, i) => `bk_${i}`);
        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-confirmation', {
            bookingIds: ids,
        });
        expect(res.status).toBe(400);
    });
});

describe('POST /api/admin/bookings/bulk/resend-waiver-request', () => {
    it('sends per-attendee waiver request for attendees with waiver_id IS NULL, audits each', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });
        bindTemplateLookup(env);

        // Booking bk_1 has 2 attendees missing waivers
        const attendeeRows = {
            bk_1: {
                results: [
                    { id: 'at_1', booking_id: 'bk_1', booking_event_id: 'ev_1', email: 'p1@x.c', first_name: 'P1', last_name: 'X', qr_token: 'qr1', waiver_id: null },
                    { id: 'at_2', booking_id: 'bk_1', booking_event_id: 'ev_1', email: 'p2@x.c', first_name: 'P2', last_name: 'X', qr_token: 'qr2', waiver_id: null },
                ],
            },
        };
        env.DB.__on(/FROM attendees a\s+JOIN bookings b/, (sql, args) => attendeeRows[args[0]] ?? { results: [] }, 'all');
        env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
            id: 'ev_1', title: 'Op', display_date: 'May 9', location: 'Ghost Town',
        }, 'first');

        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-waiver-request', {
            bookingIds: ['bk_1'],
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sent).toBe(2);

        // Action 'attendee.waiver_request_resent_bulk' is hardcoded in the
        // SQL string; binds are (user_id, attendee_id, meta_json, created_at).
        const writes = env.DB.__writes();
        const audits = writes.filter((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            /'attendee\.waiver_request_resent_bulk'/.test(w.sql)
        );
        expect(audits).toHaveLength(2);
    });

    it('skips bookings where all attendees already have waivers', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });

        // The query is "WHERE a.waiver_id IS NULL" — if everyone signed,
        // the result set is empty. The route counts that as 'skipped'.
        env.DB.__on(/FROM attendees a\s+JOIN bookings b/, { results: [] }, 'all');

        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-waiver-request', {
            bookingIds: ['bk_signed'],
        });
        const json = await res.json();
        expect(json.sent).toBe(0);
        expect(json.skipped).toBe(1);
    });

    it('403 when caller is staff role', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_s', role: 'staff' });
        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-waiver-request', {
            bookingIds: ['bk_1'],
        });
        expect(res.status).toBe(403);
    });

    it('400 on missing bookingIds', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'manager' });
        const res = await postBulk(env, cookieHeader, '/api/admin/bookings/bulk/resend-waiver-request', {});
        expect(res.status).toBe(400);
    });
});
