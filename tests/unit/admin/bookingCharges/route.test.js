// M5 R16 — admin booking-charges queue route tests.
// Covers GET / + POST /:id/{approve,waive,mark-paid}.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { signPaymentToken, verifyPaymentToken } from '../../../../worker/lib/bookingCharges.js';

const CHARGE_ID = 'bc_test_001';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/booking-charges
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/booking-charges', () => {
    it('returns 403 when caller is staff (not manager+)', async () => {
        // Use a fresh env so the prior beforeEach owner row doesn't shadow
        // the staff user row in mockD1's first-match handler resolution.
        const staffEnv = createMockEnv();
        const staff = await createAdminSession(staffEnv, { id: 'u_staff', role: 'staff' });
        const req = new Request('https://airactionsport.com/api/admin/booking-charges', {
            headers: { cookie: staff.cookieHeader },
        });
        const res = await worker.fetch(req, staffEnv, {});
        expect(res.status).toBe(403);
    });

    it('returns 200 with charges list and default pending,sent filter', async () => {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings/, {
            results: [
                {
                    id: CHARGE_ID,
                    booking_id: 'b_1', attendee_id: 'att_1', rental_assignment_id: 'ra_1',
                    reason_kind: 'damage', description: null, amount_cents: 5000,
                    status: 'pending', approval_required: 1,
                    approved_at: null, approved_by_user_id: null,
                    payment_link: null, payment_link_expires_at: null,
                    paid_at: null, payment_method: null, payment_reference: null,
                    waived_at: null, waived_by_user_id: null, waived_reason: null,
                    created_by_person_id: 'prs_1', created_by_user_id: null,
                    created_at: 1700000000000,
                    buyer_name: 'Customer X', buyer_email: 'x@e.com', event_id: 'evt_1',
                    item_name: 'Marker', item_sku: 'MK-001',
                },
            ],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/booking-charges', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.charges).toHaveLength(1);
        expect(body.charges[0]).toMatchObject({
            id: CHARGE_ID,
            reasonKind: 'damage',
            amountCents: 5000,
            status: 'pending',
            approvalRequired: true,
        });
        expect(body.charges[0].booking).toMatchObject({ fullName: 'Customer X', email: 'x@e.com' });
        expect(body.charges[0].item).toMatchObject({ name: 'Marker', sku: 'MK-001' });
        expect(body.filter.status).toBe('pending,sent');

        const writes = env.DB.__writes();
        const list = writes.find((w) => /FROM booking_charges bc/.test(w.sql));
        expect(list.args).toContain('pending');
        expect(list.args).toContain('sent');
    });

    it('respects ?status= filter', async () => {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/booking-charges?status=paid', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.filter.status).toBe('paid');

        const writes = env.DB.__writes();
        const list = writes.find((w) => /FROM booking_charges bc/.test(w.sql));
        expect(list.args).toContain('paid');
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/approve
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/booking-charges/:id/approve', () => {
    function bindCharge(overrides = {}) {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings b/, {
            id: CHARGE_ID,
            booking_id: 'b_1', attendee_id: 'att_1', rental_assignment_id: 'ra_1',
            reason_kind: 'damage', amount_cents: 5000,
            status: 'pending', approval_required: 1,
            buyer_name: 'Customer X', buyer_email: 'x@e.com', event_id: 'evt_1',
            item_name: 'Marker', item_sku: 'MK-001',
            ...overrides,
        }, 'first');
    }

    it('returns 404 charge_not_found', async () => {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings b/, null, 'first');
        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/approve`, {
            method: 'POST',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 not_pending when status is not pending', async () => {
        bindCharge({ status: 'sent' });
        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/approve`, {
            method: 'POST',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toBe('not_pending');
        expect(data.currentStatus).toBe('sent');
    });

    it('returns 200 + flips to sent + writes audit + generates payment link', async () => {
        bindCharge();
        env.DB.__on(/UPDATE booking_charges[\s\S]+approval_required = 0/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');

        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/approve`, {
            method: 'POST',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.status).toBe('sent');
        expect(body.paymentLink).toMatch(/\/admin\/booking-charges\/pay\//);

        const writes = env.DB.__writes();
        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'charge.approved')
        );
        expect(audit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/waive
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/booking-charges/:id/waive', () => {
    it('returns 400 reason_required when reason missing or whitespace', async () => {
        for (const body of [{}, { reason: '   ' }]) {
            const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/waive`, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const res = await worker.fetch(req, env, {});
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('reason_required');
        }
    });

    it('returns 404 charge_not_found', async () => {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings b/, null, 'first');
        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/waive`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'test' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 already_finalized when status is paid or waived', async () => {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings b/, {
            id: CHARGE_ID, status: 'paid', amount_cents: 5000, buyer_email: 'x@e.com',
        }, 'first');
        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/waive`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'too late' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toBe('already_finalized');
        expect(data.currentStatus).toBe('paid');
    });

    it('returns 200 + status=waived + reason positionally bound + audit', async () => {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings b/, {
            id: CHARGE_ID, status: 'pending', amount_cents: 5000, buyer_email: 'x@e.com', buyer_name: 'X',
        }, 'first');
        env.DB.__on(/UPDATE booking_charges[\s\S]+SET status = 'waived'/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');

        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/waive`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Equipment was already worn before rental' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.status).toBe('waived');

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE booking_charges[\s\S]+SET status = 'waived'/.test(w.sql));
        expect(update.args).toContain('Equipment was already worn before rental');

        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'charge.waived')
        );
        expect(audit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/mark-paid
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/booking-charges/:id/mark-paid', () => {
    it('returns 400 payment_method_required when missing', async () => {
        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/mark-paid`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('payment_method_required');
    });

    it('returns 200 + status=paid + payment_method bound + audit', async () => {
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings b/, {
            id: CHARGE_ID, status: 'sent', amount_cents: 5000, buyer_email: 'x@e.com', buyer_name: 'X',
        }, 'first');
        env.DB.__on(/UPDATE booking_charges[\s\S]+SET status = 'paid'/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');

        const req = new Request(`https://airactionsport.com/api/admin/booking-charges/${CHARGE_ID}/mark-paid`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentMethod: 'venmo', paymentReference: '@user123' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('paid');

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE booking_charges[\s\S]+SET status = 'paid'/.test(w.sql));
        expect(update.args).toContain('venmo');
        expect(update.args).toContain('@user123');

        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'charge.marked_paid')
        );
        expect(audit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// HMAC payment-link round-trip
// ────────────────────────────────────────────────────────────────────

describe('signPaymentToken / verifyPaymentToken', () => {
    const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';

    it('round-trips a token with chargeId + expiresAt', async () => {
        const exp = Date.now() + 86400000;
        const token = await signPaymentToken('bc_xyz', exp, SECRET);
        const verified = await verifyPaymentToken(token, SECRET);
        expect(verified).not.toBeNull();
        expect(verified.chargeId).toBe('bc_xyz');
        expect(verified.expiresAt).toBe(exp);
    });

    it('rejects a tampered token (signature mismatch)', async () => {
        const exp = Date.now() + 86400000;
        const token = await signPaymentToken('bc_xyz', exp, SECRET);
        const tampered = token.slice(0, -2) + 'XX';
        const verified = await verifyPaymentToken(tampered, SECRET);
        expect(verified).toBeNull();
    });

    it('rejects an expired token', async () => {
        const past = Date.now() - 1000;
        const token = await signPaymentToken('bc_xyz', past, SECRET);
        const verified = await verifyPaymentToken(token, SECRET);
        expect(verified).toBeNull();
    });

    it('rejects a token signed with a different secret', async () => {
        const exp = Date.now() + 86400000;
        const token = await signPaymentToken('bc_xyz', exp, SECRET);
        const verified = await verifyPaymentToken(token, 'different_secret_padding_to_32bytes_or_more');
        expect(verified).toBeNull();
    });
});
