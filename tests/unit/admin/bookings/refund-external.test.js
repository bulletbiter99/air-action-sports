// M4 Batch 3a — POST /api/admin/bookings/:id/refund-external
//
// Records a refund processed outside Stripe (cash / venmo / paypal /
// comp / waived). Mirrors Stripe-refund effects on bookings + ticket
// inventory + customer aggregates, and ALWAYS sends the customer a
// `refund_recorded_external` email (D06 — no opt-out).
//
// requireRole('owner', 'manager') — staff is 403.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { mockResendFetch } from '../../../helpers/mockResend.js';

function buildReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

function bindBookingFixture(env, overrides = {}) {
    const booking = {
        id: 'bk_1',
        event_id: 'ev_1',
        full_name: 'Alice',
        email: 'alice@example.com',
        phone: null,
        player_count: 2,
        line_items_json: '[{"type":"ticket","ticket_type_id":"tt_1","qty":2,"line_total_cents":16000}]',
        subtotal_cents: 16000, discount_cents: 0, tax_cents: 0, fee_cents: 0, total_cents: 16000,
        status: 'paid', payment_method: 'cash',
        stripe_payment_intent: 'cash_bk_1',
        created_at: 1000, paid_at: 1000, refunded_at: null,
        customer_id: 'cus_alice',
        refund_external: 0, refund_external_method: null, refund_external_reference: null,
        refund_requested_at: null,
        ...overrides,
    };
    env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, booking, 'first');
    env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
        id: 'ev_1', title: 'Op Nightfall', display_date: '9 May 2026',
    }, 'first');
    // Template lookup for sendRefundRecordedExternal
    env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, (sql, args) => ({
        slug: args[0],
        subject: 'Refund issued for your AAS booking',
        body_html: '<p>Refund {{amount_refunded}} via {{method_label}}</p>',
        body_text: 'Refund {{amount_refunded}} via {{method_label}}',
        variables_json: '[]',
    }), 'first');
    return booking;
}

async function postExternal(env, cookieHeader, id, body) {
    return await worker.fetch(
        buildReq(`/api/admin/bookings/${id}/refund-external`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env, {},
    );
}

describe('POST /api/admin/bookings/:id/refund-external — happy path', () => {
    it('cash: updates booking + writes audit + sends email + returns 200', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'cash', reference: 'envelope-7', reason: 'customer requested',
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.bookingId).toBe('bk_1');
        expect(json.status).toBe('refunded');
        expect(json.method).toBe('cash');
        expect(json.reference).toBe('envelope-7');
        expect(json.amountCents).toBe(16000);

        const writes = env.DB.__writes();

        // UPDATE bookings sets all 6 expected columns + status='refunded'
        const update = writes.find((w) =>
            /UPDATE bookings/.test(w.sql) && /refund_external/.test(w.sql)
        );
        expect(update).toBeDefined();
        expect(update.sql).toMatch(/SET status = 'refunded'/);
        expect(update.sql).toMatch(/refunded_at = \?/);
        expect(update.sql).toMatch(/refund_external = 1/);
        // Args: refunded_at, method, reference, refund_requested_at, id
        expect(update.args[1]).toBe('cash');
        expect(update.args[2]).toBe('envelope-7');
        expect(update.args[4]).toBe('bk_1');

        // Inventory release
        const inventoryUpdate = writes.find((w) =>
            /UPDATE ticket_types SET sold = MAX/.test(w.sql)
        );
        expect(inventoryUpdate).toBeDefined();

        // Audit row
        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) && /'booking\.refunded_external'/.test(w.sql)
        );
        expect(audit).toBeDefined();
        expect(audit.args[0]).toBe('u_actor');
        expect(audit.args[1]).toBe('bk_1');
        const auditMeta = JSON.parse(audit.args[2]);
        expect(auditMeta).toEqual({
            method: 'cash', reference: 'envelope-7', amount_cents: 16000, reason: 'customer requested',
        });

        // Customer denormalized recompute (sees a SELECT for refund_count or similar)
        // recomputeCustomerDenormalizedFields runs SQL against bookings/customers;
        // we just verify it was invoked by checking that the customers table was queried.
        const custRecompute = writes.find((w) =>
            /UPDATE customers/.test(w.sql) && /SET/.test(w.sql)
        );
        expect(custRecompute).toBeDefined();
    });

    const ALL_METHODS = ['cash', 'venmo', 'paypal', 'comp', 'waived'];
    for (const method of ALL_METHODS) {
        it(`accepts method=${method} and binds it into UPDATE`, async () => {
            const env = createMockEnv();
            mockResendFetch();
            const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
            bindBookingFixture(env);

            const res = await postExternal(env, cookieHeader, 'bk_1', {
                method, reference: 'ref-x', reason: 'r',
            });
            expect(res.status).toBe(200);
            const update = env.DB.__writes().find((w) =>
                /UPDATE bookings/.test(w.sql) && /refund_external/.test(w.sql)
            );
            expect(update.args[1]).toBe(method);
        });
    }

    it('reference is optional (binds null when omitted)', async () => {
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'comp', reason: 'comp from owner',
        });
        expect(res.status).toBe(200);
        const update = env.DB.__writes().find((w) =>
            /UPDATE bookings/.test(w.sql) && /refund_external/.test(w.sql)
        );
        expect(update.args[2]).toBeNull();
    });
});

describe('POST /api/admin/bookings/:id/refund-external — D06 always-notify', () => {
    it('sends refund_recorded_external email even when no Stripe involvement', async () => {
        const env = createMockEnv();
        const fetchMock = mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        await postExternal(env, cookieHeader, 'bk_1', {
            method: 'cash', reference: 'envelope-7', reason: 'r',
        });

        const resendCalls = (fetchMock.mock.calls || []).filter(
            ([url]) => typeof url === 'string' && url === 'https://api.resend.com/emails'
        );
        expect(resendCalls).toHaveLength(1);
        const emailBody = JSON.parse(resendCalls[0][1].body);
        // Resend accepts `to` as either string or array; sendEmail wraps it
        // in an array for the API call.
        const toRecipients = Array.isArray(emailBody.to) ? emailBody.to : [emailBody.to];
        expect(toRecipients).toContain('alice@example.com');
        expect(emailBody.subject).toMatch(/Refund issued/i);
        expect(emailBody.tags).toEqual(expect.arrayContaining([
            { name: 'type', value: 'refund_recorded_external' },
            { name: 'method', value: 'cash' },
        ]));
    });

    it('refund still succeeds when email sender returns skipped (template missing)', async () => {
        // Register the template-missing override BEFORE the fixture so
        // it wins handler matching. The fixture's template handler returns
        // a valid row; this override returns null so loadTemplate skips.
        const env = createMockEnv();
        mockResendFetch();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');
        bindBookingFixture(env);

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'cash', reason: 'r',
        });
        // Refund itself succeeded; email gracefully skipped.
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.emailResult.skipped).toBe('template_missing');
    });
});

describe('POST /api/admin/bookings/:id/refund-external — error paths', () => {
    it('400 on invalid method', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'stripe', reason: 'r',
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/method must be one of/i);
    });

    it('400 on missing reason', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        const res = await postExternal(env, cookieHeader, 'bk_1', { method: 'cash' });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/reason/i);
    });

    it('400 on whitespace-only reason', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'cash', reason: '   ',
        });
        expect(res.status).toBe(400);
    });

    it('400 on missing JSON body', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env);

        const res = await worker.fetch(
            buildReq('/api/admin/bookings/bk_1/refund-external', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: '{not valid',
            }),
            env, {},
        );
        expect(res.status).toBe(400);
    });

    it('404 on missing booking', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, null, 'first');

        const res = await postExternal(env, cookieHeader, 'bk_missing', {
            method: 'cash', reason: 'r',
        });
        expect(res.status).toBe(404);
    });

    it('409 when booking already refunded', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env, { status: 'refunded', refunded_at: 500 });

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'cash', reason: 'r',
        });
        // status='refunded' fails the paid/comp check first; either 409 is fine here.
        expect(res.status).toBe(409);
    });

    it('409 when booking status is pending (cannot refund unpaid)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindBookingFixture(env, { status: 'pending' });

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'cash', reason: 'r',
        });
        expect(res.status).toBe(409);
    });

    it('403 when caller is staff', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindBookingFixture(env);

        const res = await postExternal(env, cookieHeader, 'bk_1', {
            method: 'cash', reason: 'r',
        });
        expect(res.status).toBe(403);
    });
});
