// M5.5 Batch 7b — admin field rental payments route tests.
//
// Covers:
//   - POST capability gating per payment_kind (deposit_record / balance_record / write)
//   - POST kind='refund' rejected (refunds only via /refund endpoint)
//   - POST kind=deposit + received_at triggers aggregate sync onto field_rentals
//   - POST kind=full syncs BOTH deposit_* and balance_*
//   - Auto-transition agreed → paid on first received deposit/balance/full
//   - No auto-transition for non-agreed rental statuses
//   - POST rejected on cancelled/refunded parent rentals
//   - GET capability gating (field_rentals.read.financials) + PII masking on reference
//   - PUT pending → received triggers sync + auto-flip
//   - PUT rejected on refunded/void status
//   - POST /:paymentId/refund: amount ≤ original, status was received
//   - Refund aggregate reversal: clears OR re-binds to newer received row

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

const rentalRow = (overrides = {}) => ({
    id: 'fr_test',
    customer_id: 'cus_x',
    site_id: 'site_g',
    site_field_ids: 'fld_main',
    engagement_type: 'tactical_training',
    lead_source: null,
    scheduled_starts_at: 1000,
    scheduled_ends_at: 2000,
    status: 'agreed',
    status_changed_at: 1000,
    site_fee_cents: 50000,
    addon_fees_json: '[]',
    discount_cents: 0,
    tax_cents: 0,
    total_cents: 50000,
    deposit_received_at: null,
    deposit_method: null,
    deposit_reference: null,
    deposit_received_by: null,
    balance_received_at: null,
    balance_method: null,
    balance_reference: null,
    balance_received_by: null,
    coi_status: 'not_required',
    coi_expires_at: null,
    requirements_coi_received: 0,
    requirements_agreement_signed: 0,
    requirements_deposit_received: 0,
    archived_at: null,
    cancelled_at: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
});

const paymentRow = (overrides = {}) => ({
    id: 'frp_001',
    rental_id: 'fr_test',
    recurrence_id: null,
    payment_kind: 'deposit',
    payment_method: 'venmo',
    reference: '@acme-corp',
    stripe_invoice_id: null,
    amount_cents: 10000,
    status: 'pending',
    due_at: null,
    received_at: null,
    refunded_at: null,
    refund_amount_cents: null,
    refund_reason: null,
    refund_method: null,
    received_by_user_id: null,
    notes: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
});

function jsonReq(path, body, method = 'POST') {
    return new Request(`https://airactionsport.com${path}`, {
        method,
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
}

function getReq(path) {
    return new Request(`https://airactionsport.com${path}`, { headers: { cookie: cookieHeader } });
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

// ────────────────────────────────────────────────────────────────────
// POST / — record payment
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rental-payments — record', () => {
    it('returns 403 on kind=deposit without field_rentals.deposit_record', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'venmo', amount_cents: 10000,
        }), env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('field_rentals.deposit_record');
    });

    it('returns 403 on kind=balance without field_rentals.balance_record', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'balance',
            payment_method: 'cash', amount_cents: 10000,
        }), env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('field_rentals.balance_record');
    });

    it("rejects kind='refund' (use /refund endpoint)", async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record', 'field_rentals.write']);

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'refund',
            payment_method: 'venmo', amount_cents: 10000,
        }), env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Use POST \/:paymentId\/refund/);
    });

    it('rejects payment_method outside CHECK enum', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'bitcoin', amount_cents: 10000,
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('rejects on archived rental', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ archived_at: 1000 }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'venmo', amount_cents: 10000,
        }), env, {});
        expect(res.status).toBe(409);
    });

    it('rejects on cancelled rental', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'cancelled' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'venmo', amount_cents: 10000,
        }), env, {});
        expect(res.status).toBe(409);
    });

    it('kind=deposit + received_at triggers deposit aggregate sync', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({
            status: 'received', received_at: 5000, received_by_user_id: 'u_owner',
        }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'venmo', amount_cents: 10000,
            reference: '@acme-corp', received_at: 5000,
        }), env, {});
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        const denorm = writes.find((w) => /UPDATE field_rentals\s+SET deposit_received_at = \?/.test(w.sql));
        expect(denorm).toBeDefined();
        expect(denorm.args).toContain('venmo');
        expect(denorm.args).toContain('@acme-corp');
    });

    it('kind=full syncs BOTH deposit_* and balance_*', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({
            payment_kind: 'full', status: 'received', received_at: 5000, received_by_user_id: 'u_owner',
        }), 'first');

        await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'full',
            payment_method: 'check', amount_cents: 50000, received_at: 5000,
        }), env, {});

        const writes = env.DB.__writes();
        const depositSync = writes.find((w) => /UPDATE field_rentals\s+SET deposit_received_at = \?/.test(w.sql));
        const balanceSync = writes.find((w) => /UPDATE field_rentals\s+SET balance_received_at = \?/.test(w.sql));
        expect(depositSync).toBeDefined();
        expect(balanceSync).toBeDefined();
    });

    it('auto-transitions agreed → paid on first received deposit + writes status_changed audit', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'agreed' }), 'first');
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({
            status: 'received', received_at: 5000, received_by_user_id: 'u_owner',
        }), 'first');

        await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'venmo', amount_cents: 10000, received_at: 5000,
        }), env, {});

        const writes = env.DB.__writes();
        const flipUpdate = writes.find((w) => /UPDATE field_rentals\s+SET status = 'paid'/.test(w.sql));
        expect(flipUpdate).toBeDefined();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental.status_changed'));
        expect(audit).toBeDefined();
    });

    it('does NOT auto-transition when rental is in lead/draft/sent', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'sent' }), 'first');
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({
            status: 'received', received_at: 5000, received_by_user_id: 'u_owner',
        }), 'first');

        await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'venmo', amount_cents: 10000, received_at: 5000,
        }), env, {});

        const writes = env.DB.__writes();
        const flipUpdate = writes.find((w) => /UPDATE field_rentals\s+SET status = 'paid'/.test(w.sql));
        expect(flipUpdate).toBeUndefined();
    });

    it('pending status (no received_at) writes row without aggregate sync', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({ status: 'pending' }), 'first');

        await worker.fetch(jsonReq('/api/admin/field-rental-payments', {
            rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'venmo', amount_cents: 10000,
        }), env, {});

        const writes = env.DB.__writes();
        const denorm = writes.find((w) => /UPDATE field_rentals\s+SET deposit_received_at = \?/.test(w.sql));
        expect(denorm).toBeUndefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// GET / — list
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rental-payments — list', () => {
    it('returns 403 without field_rentals.read.financials', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);

        const res = await worker.fetch(getReq('/api/admin/field-rental-payments?rental_id=fr_test'), env, {});
        expect(res.status).toBe(403);
    });

    it('returns 400 when rental_id query param missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read.financials']);
        const res = await worker.fetch(getReq('/api/admin/field-rental-payments'), env, {});
        expect(res.status).toBe(400);
    });

    it('masks reference field when viewer lacks field_rentals.read.pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read.financials']);
        env.DB.__on(/FROM field_rental_payments WHERE/, {
            results: [paymentRow({ reference: 'check#1234' })],
        }, 'all');

        const res = await worker.fetch(getReq('/api/admin/field-rental-payments?rental_id=fr_test'), env, {});
        const body = await res.json();
        expect(body.payments[0].reference).toBe('***');
    });

    it('unmasks reference when viewer has field_rentals.read.pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read.financials', 'field_rentals.read.pii']);
        env.DB.__on(/FROM field_rental_payments WHERE/, {
            results: [paymentRow({ reference: 'check#1234' })],
        }, 'all');

        const res = await worker.fetch(getReq('/api/admin/field-rental-payments?rental_id=fr_test'), env, {});
        const body = await res.json();
        expect(body.payments[0].reference).toBe('check#1234');
    });
});

// ────────────────────────────────────────────────────────────────────
// PUT /:paymentId
// ────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/field-rental-payments/:paymentId', () => {
    it('rejects PUT on refunded payment with 409', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({ status: 'refunded' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001', { notes: 'try' }, 'PUT'), env, {});
        expect(res.status).toBe(409);
    });

    it('pending → received transition triggers aggregate sync + auto-flip', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.deposit_record']);
        // Sequence: first SELECT returns pending payment for existence check.
        // Subsequent SELECTs (refreshed after update) return received payment.
        let paymentReads = 0;
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, () => {
            paymentReads += 1;
            if (paymentReads === 1) {
                return paymentRow({ status: 'pending' });
            }
            return paymentRow({ status: 'received', received_at: 6000, received_by_user_id: 'u_owner' });
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'agreed' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001', { received_at: 6000 }, 'PUT'), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const sync = writes.find((w) => /UPDATE field_rentals\s+SET deposit_received_at = \?/.test(w.sql));
        const flip = writes.find((w) => /UPDATE field_rentals\s+SET status = 'paid'/.test(w.sql));
        expect(sync).toBeDefined();
        expect(flip).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:paymentId/refund
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rental-payments/:paymentId/refund', () => {
    it('returns 403 without field_rentals.refund', async () => {
        bindCapabilities(env.DB, 'u_owner', []);

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001/refund', {
            refund_amount_cents: 5000, refund_method: 'venmo',
        }), env, {});
        expect(res.status).toBe(403);
    });

    it('returns 409 when payment status is not received', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.refund']);
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({ status: 'pending' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001/refund', {
            refund_amount_cents: 5000, refund_method: 'venmo',
        }), env, {});
        expect(res.status).toBe(409);
    });

    it('returns 400 when refund_amount > original amount', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.refund']);
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({
            status: 'received', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner',
        }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001/refund', {
            refund_amount_cents: 99999, refund_method: 'venmo',
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('happy path: sets status=refunded + writes field_rental.refunded audit', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.refund']);
        // Initial payment lookup returns received; refresh after UPDATE returns refunded.
        let paymentReads = 0;
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, () => {
            paymentReads += 1;
            if (paymentReads <= 1) {
                return paymentRow({ status: 'received', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner' });
            }
            return paymentRow({ status: 'refunded', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner',
                refund_amount_cents: 10000, refund_method: 'venmo' });
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({
            status: 'paid',
            deposit_received_at: 5000,
            deposit_method: 'venmo',
            deposit_received_by: 'u_owner',
        }), 'first');
        // No replacement payments exist
        env.DB.__on(/SELECT \* FROM field_rental_payments\s+WHERE rental_id = \? AND status = 'received'/, null, 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001/refund', {
            refund_amount_cents: 10000, refund_method: 'venmo', refund_reason: 'Customer changed dates',
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const setRefunded = writes.find((w) => /UPDATE field_rental_payments\s+SET status = 'refunded'/.test(w.sql));
        expect(setRefunded).toBeDefined();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental.refunded'));
        expect(audit).toBeDefined();
    });

    it('clears denormalized deposit_* on parent rental when no replacement received payment exists', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.refund']);
        let paymentReads = 0;
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, () => {
            paymentReads += 1;
            if (paymentReads <= 1) {
                return paymentRow({ status: 'received', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner', payment_method: 'venmo' });
            }
            return paymentRow({ status: 'refunded', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner', payment_method: 'venmo',
                refund_amount_cents: 10000, refund_method: 'venmo' });
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({
            status: 'paid',
            deposit_received_at: 5000,
            deposit_method: 'venmo',
            deposit_received_by: 'u_owner',
        }), 'first');
        env.DB.__on(/SELECT \* FROM field_rental_payments\s+WHERE rental_id = \? AND status = 'received'/, null, 'first');

        await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001/refund', {
            refund_amount_cents: 10000, refund_method: 'venmo',
        }), env, {});

        const writes = env.DB.__writes();
        const clear = writes.find((w) => /UPDATE field_rentals\s+SET deposit_received_at = NULL/.test(w.sql));
        expect(clear).toBeDefined();
    });

    it('re-binds deposit_* on parent rental to newer received payment when one exists', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.refund']);
        let paymentReads = 0;
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, () => {
            paymentReads += 1;
            if (paymentReads <= 1) {
                return paymentRow({ status: 'received', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner', payment_method: 'venmo' });
            }
            return paymentRow({ status: 'refunded', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner', payment_method: 'venmo',
                refund_amount_cents: 10000, refund_method: 'venmo' });
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({
            status: 'paid',
            deposit_received_at: 5000,
            deposit_method: 'venmo',
            deposit_received_by: 'u_owner',
        }), 'first');
        // Replacement deposit payment exists at received_at 6000 (newer)
        env.DB.__on(/SELECT \* FROM field_rental_payments\s+WHERE rental_id = \? AND status = 'received'/, {
            id: 'frp_002', rental_id: 'fr_test', payment_kind: 'deposit',
            payment_method: 'check', reference: '#5678', amount_cents: 10000,
            status: 'received', received_at: 6000, received_by_user_id: 'u_owner',
        }, 'first');

        await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001/refund', {
            refund_amount_cents: 10000, refund_method: 'venmo',
        }), env, {});

        const writes = env.DB.__writes();
        // The re-bind UPDATE should set deposit_received_at to 6000 (the replacement)
        const rebind = writes.find((w) => /UPDATE field_rentals\s+SET deposit_received_at = \?/.test(w.sql) && w.args.includes(6000));
        expect(rebind).toBeDefined();
        // The clear UPDATE should NOT fire
        const clear = writes.find((w) => /UPDATE field_rentals\s+SET deposit_received_at = NULL/.test(w.sql));
        expect(clear).toBeUndefined();
    });

    it('rejects invalid refund_method outside enum', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.refund']);
        env.DB.__on(/SELECT \* FROM field_rental_payments WHERE id = \?/, paymentRow({
            status: 'received', amount_cents: 10000, received_at: 5000, received_by_user_id: 'u_owner',
        }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rental-payments/frp_001/refund', {
            refund_amount_cents: 5000, refund_method: 'bitcoin',
        }), env, {});
        expect(res.status).toBe(400);
    });
});
