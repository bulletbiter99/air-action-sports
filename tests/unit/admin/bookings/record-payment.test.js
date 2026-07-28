// C7 (2026-07-27) — POST /api/admin/bookings/:id/record-payment.
//
// The inverse of /refund-external, which existed while its counterpart did
// not. This is the flow the Stripe live-cutover invoices needed in June and
// which was done by hand with SQL.
//
// The load-bearing rule is the PROVISIONING guard. A `pending` or `abandoned`
// booking has no attendees (verified in production: all 10 abandoned rows have
// zero), so flipping one to paid would mint a paid booking with no attendee
// records, no QR tickets and no waiver links — a ghost that fails at the gate.
// Only an already-provisioned booking may be recorded as paid.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

const BOOKING_ID = 'bk_unpaid_1';
const req = (path, init = {}) => new Request(`https://airactionsport.com${path}`, init);

let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    ({ cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' }));
});

function bindBooking({ status = 'unpaid', hasAttendee = true, customer_id = 'cus_1' } = {}) {
    env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, {
        id: BOOKING_ID, status, customer_id,
        total_cents: 5550, event_id: 'ev_1', line_items_json: '[]',
        email: 'buyer@example.com', full_name: 'Buyer X', player_count: 1,
    }, 'first');
    env.DB.__on(/SELECT id FROM attendees WHERE booking_id = \?/, hasAttendee ? { id: 'att_1' } : null, 'first');
}

function captureWrites() {
    const updates = [];
    const audits = [];
    env.DB.__on(/UPDATE bookings SET status = 'paid'/, (sql, args) => { updates.push(args); return {}; }, 'run');
    // The action string is a SQL literal here (matching the sibling
    // refund-external handler), so it is not in args — capture sql too.
    env.DB.__on(/INSERT INTO audit_log/, (sql, args) => { audits.push({ sql, args }); return {}; }, 'run');
    return { updates, audits };
}

const post = (body, id = BOOKING_ID) => worker.fetch(
    req(`/api/admin/bookings/${id}/record-payment`, {
        method: 'POST',
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }), env, {},
);

describe('POST /:id/record-payment — happy path', () => {
    it('flips an unpaid booking to paid, stamps the method and audits the prior status', async () => {
        bindBooking({ status: 'unpaid' });
        const { updates, audits } = captureWrites();

        const res = await post({ method: 'invoice', reference: 'INV-204' });
        expect(res.status).toBe(200);
        const j = await res.json();
        expect(j).toMatchObject({
            bookingId: BOOKING_ID, status: 'paid', priorStatus: 'unpaid',
            method: 'invoice', reference: 'INV-204', amountCents: 5550,
        });

        expect(updates).toHaveLength(1);
        expect(updates[0][0]).toBe('invoice');            // payment_method
        expect(typeof updates[0][1]).toBe('number');      // paid_at = now
        expect(updates[0][2]).toBe(BOOKING_ID);

        const audit = audits.find((a) => a.sql.includes('booking.payment_recorded'));
        expect(audit).toBeTruthy();
        const meta = JSON.parse(audit.args.find((v) => typeof v === 'string' && v.startsWith('{')));
        expect(meta).toMatchObject({
            method: 'invoice', reference: 'INV-204', amount_cents: 5550, prior_status: 'unpaid',
        });
    });

    it('sets paid_at to NOW, not the booking creation time — revenue buckets on it', async () => {
        bindBooking({ status: 'unpaid' });
        const { updates } = captureWrites();
        const before = Date.now();

        await post({ method: 'cash' });
        expect(updates[0][1]).toBeGreaterThanOrEqual(before);
    });

    it('recomputes customer aggregates so LTV and system tags are not stale', async () => {
        bindBooking({ status: 'unpaid', customer_id: 'cus_1' });
        captureWrites();
        let recomputed = false;
        env.DB.__on(/FROM bookings WHERE customer_id/, () => { recomputed = true; return { results: [] }; }, 'all');

        expect((await post({ method: 'cash' })).status).toBe(200);
        expect(recomputed).toBe(true);
    });

    it('accepts every documented method and rejects anything else', async () => {
        for (const method of ['cash', 'venmo', 'paypal', 'check', 'invoice', 'other']) {
            const e = createMockEnv();
            const s = await createAdminSession(e, { id: 'u_owner', role: 'owner' });
            e.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, {
                id: BOOKING_ID, status: 'unpaid', customer_id: null, total_cents: 100, line_items_json: '[]',
            }, 'first');
            e.DB.__on(/SELECT id FROM attendees WHERE booking_id = \?/, { id: 'att_1' }, 'first');
            e.DB.__on(/UPDATE bookings SET status = 'paid'/, {}, 'run');
            e.DB.__on(/INSERT INTO audit_log/, {}, 'run');
            const res = await worker.fetch(
                req(`/api/admin/bookings/${BOOKING_ID}/record-payment`, {
                    method: 'POST',
                    headers: { cookie: s.cookieHeader, 'content-type': 'application/json' },
                    body: JSON.stringify({ method }),
                }), e, {},
            );
            expect(res.status, `method ${method}`).toBe(200);
        }

        bindBooking();
        const bad = await post({ method: 'bitcoin' });
        expect(bad.status).toBe(400);
        expect((await bad.json()).error).toMatch(/method must be one of/);
    });
});

describe('POST /:id/record-payment — the provisioning guard', () => {
    // The whole reason this endpoint is narrow. Without attendees there is
    // nothing to scan at the gate, so "paid" would be a lie.
    it('refuses a booking with no attendees and names the correct alternative', async () => {
        bindBooking({ status: 'abandoned', hasAttendee: false });
        const { updates } = captureWrites();

        const res = await post({ method: 'cash' });
        expect(res.status).toBe(409);
        const err = (await res.json()).error;
        expect(err).toMatch(/no attendee records/);
        expect(err).toMatch(/New Booking/);
        expect(updates).toHaveLength(0);
    });

    it('allows a pending booking that HAS been provisioned', async () => {
        bindBooking({ status: 'pending', hasAttendee: true });
        const { updates } = captureWrites();
        expect((await post({ method: 'cash' })).status).toBe(200);
        expect(updates).toHaveLength(1);
    });

    it('never touches ticket inventory — the seats were already counted', async () => {
        bindBooking({ status: 'unpaid' });
        captureWrites();
        const inventory = [];
        env.DB.__on(/UPDATE ticket_types SET sold/, (sql, args) => { inventory.push(args); return {}; }, 'run');

        await post({ method: 'cash' });
        expect(inventory).toHaveLength(0);
    });
});

describe('POST /:id/record-payment — refusals', () => {
    it('404s for an unknown booking', async () => {
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, null, 'first');
        expect((await post({ method: 'cash' })).status).toBe(404);
    });

    it.each(['paid', 'comp'])('409s when the booking is already %s', async (status) => {
        bindBooking({ status });
        const res = await post({ method: 'cash' });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(new RegExp(`already ${status}`));
    });

    it.each(['refunded', 'cancelled'])('409s on a %s booking rather than silently reviving it', async (status) => {
        bindBooking({ status });
        const { updates } = captureWrites();
        const res = await post({ method: 'cash' });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/Reinstate it first/);
        expect(updates).toHaveLength(0);
    });

    it('400s on a missing body', async () => {
        bindBooking();
        const res = await worker.fetch(
            req(`/api/admin/bookings/${BOOKING_ID}/record-payment`, {
                method: 'POST', headers: { cookie: cookieHeader },
            }), env, {},
        );
        expect(res.status).toBe(400);
    });

    it('403s for staff — writes stay gated under the open-reads model', async () => {
        const e = createMockEnv();
        const s = await createAdminSession(e, { id: 'u_staff', role: 'staff' });
        const res = await worker.fetch(
            req(`/api/admin/bookings/${BOOKING_ID}/record-payment`, {
                method: 'POST',
                headers: { cookie: s.cookieHeader, 'content-type': 'application/json' },
                body: JSON.stringify({ method: 'cash' }),
            }), e, {},
        );
        expect(res.status).toBe(403);
    });
});
