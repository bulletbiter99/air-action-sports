// Post-M6 Track D-1a — tests for the business fields decryption surface
// on GET /api/admin/customers/:id + the PUT /:id/business edit endpoint.
// Resolves the M5.5 polish item where AdminCustomerDetail showed "(lands
// in M5.5 B10)" stub text for EIN + billing address.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';
import { encrypt } from '../../../worker/lib/personEncryption.js';

let env;
let cookieHeader;

const customerRow = (overrides = {}) => ({
    id: 'cus_biz',
    email: 'ops@business.com',
    email_normalized: 'ops@business.com',
    name: 'Business Customer',
    phone: null,
    total_bookings: 0,
    total_attendees: 0,
    lifetime_value_cents: 0,
    refund_count: 0,
    first_booking_at: null,
    last_booking_at: null,
    email_transactional: 1,
    email_marketing: 1,
    sms_transactional: 0,
    sms_marketing: 0,
    notes: null,
    archived_at: null,
    archived_reason: null,
    archived_by: null,
    merged_into: null,
    client_type: 'business',
    business_name: 'Acme Corp',
    business_website: 'https://acme.example',
    business_tax_id: null,
    business_billing_address: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
});

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

function jsonReq(path, method, body, init = {}) {
    return req(path, {
        method,
        headers: { cookie: cookieHeader, 'content-type': 'application/json', ...(init.headers || {}) },
        body: JSON.stringify(body),
    });
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/customers/:id — business fields decryption', () => {
    it('returns hasEncryptedTaxId=false when row has no encrypted EIN', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read', 'customers.read.business_fields']);
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, customerRow({ business_tax_id: null }), 'first');
        env.DB.__on(/FROM bookings b/, { results: [] }, 'all');
        env.DB.__on(/FROM customer_tags/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');

        const res = await worker.fetch(req('/api/admin/customers/cus_biz', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.customer.businessTaxId).toBe(null);
        expect(data.customer.hasEncryptedTaxId).toBe(false);
        expect(data.customer.viewerCanSeeBusinessFields).toBe(true);
    });

    it('returns decrypted businessTaxId when viewer has customers.read.business_fields', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read', 'customers.read.business_fields']);
        const encryptedEin = await encrypt('12-3456789', env.SESSION_SECRET);
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, customerRow({ business_tax_id: encryptedEin }), 'first');
        env.DB.__on(/FROM bookings b/, { results: [] }, 'all');
        env.DB.__on(/FROM customer_tags/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');

        const res = await worker.fetch(req('/api/admin/customers/cus_biz', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.customer.businessTaxId).toBe('12-3456789');
        expect(data.customer.hasEncryptedTaxId).toBe(true);
    });

    it('returns hasEncryptedTaxId=true but null businessTaxId without capability', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read']); // no business_fields cap
        const encryptedEin = await encrypt('12-3456789', env.SESSION_SECRET);
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, customerRow({ business_tax_id: encryptedEin }), 'first');
        env.DB.__on(/FROM bookings b/, { results: [] }, 'all');
        env.DB.__on(/FROM customer_tags/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');

        const res = await worker.fetch(req('/api/admin/customers/cus_biz', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.customer.businessTaxId).toBe(null);
        expect(data.customer.hasEncryptedTaxId).toBe(true);
        expect(data.customer.viewerCanSeeBusinessFields).toBe(false);
    });

    it('decrypts billing address as parsed JSON object', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read', 'customers.read.business_fields']);
        const addr = { line1: '123 Main St', city: 'Salt Lake', state: 'UT', postal: '84101', country: 'US' };
        const encrypted = await encrypt(JSON.stringify(addr), env.SESSION_SECRET);
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, customerRow({ business_billing_address: encrypted }), 'first');
        env.DB.__on(/FROM bookings b/, { results: [] }, 'all');
        env.DB.__on(/FROM customer_tags/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');

        const res = await worker.fetch(req('/api/admin/customers/cus_biz', { headers: { cookie: cookieHeader } }), env, {});
        const data = await res.json();
        expect(data.customer.businessBillingAddress).toEqual(addr);
    });

    it('writes customer.business_fields_unmasked audit when encrypted data present + capable', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read', 'customers.read.business_fields']);
        const encryptedEin = await encrypt('12-3456789', env.SESSION_SECRET);
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, customerRow({ business_tax_id: encryptedEin }), 'first');
        env.DB.__on(/FROM bookings b/, { results: [] }, 'all');
        env.DB.__on(/FROM customer_tags/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/customers/cus_biz', { headers: { cookie: cookieHeader } }), env, {});

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('customer.business_fields_unmasked'));
        expect(audit).toBeDefined();
    });

    it('does NOT audit unmask when no encrypted fields present (even with capability)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read', 'customers.read.business_fields']);
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, customerRow({ business_tax_id: null, business_billing_address: null }), 'first');
        env.DB.__on(/FROM bookings b/, { results: [] }, 'all');
        env.DB.__on(/FROM customer_tags/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/customers/cus_biz', { headers: { cookie: cookieHeader } }), env, {});

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('customer.business_fields_unmasked'));
        expect(audit).toBeUndefined();
    });

    it('does NOT decrypt when viewer lacks capability (no audit either)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read']);
        const encryptedEin = await encrypt('12-3456789', env.SESSION_SECRET);
        env.DB.__on(/SELECT \* FROM customers WHERE id = \?/, customerRow({ business_tax_id: encryptedEin }), 'first');
        env.DB.__on(/FROM bookings b/, { results: [] }, 'all');
        env.DB.__on(/FROM customer_tags/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/customers/cus_biz', { headers: { cookie: cookieHeader } }), env, {});

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('customer.business_fields_unmasked'));
        expect(audit).toBeUndefined();
    });
});

describe('PUT /api/admin/customers/:id/business', () => {
    it('returns 403 without customers.write.business_fields', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read', 'customers.write']);
        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', { clientType: 'business' }), env, {});
        expect(res.status).toBe(403);
    });

    it('returns 404 when customer does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers/missing/business', 'PUT', { clientType: 'business' }), env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when customer is archived', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: 1000 }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', { clientType: 'business' }), env, {});
        expect(res.status).toBe(409);
    });

    it('returns 400 when EIN is malformed', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', { businessTaxId: 'not-real' }), env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/XX-XXXXXXX/);
    });

    it('returns 400 when no fields provided', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', {}), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when clientType is not in {individual, business}', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', { clientType: 'unknown' }), env, {});
        expect(res.status).toBe(400);
    });

    it('encrypts EIN before storing (binds ciphertext, not plaintext)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        let captured = null;
        env.DB.__on(/UPDATE customers SET/, (sql, args) => { captured = args; return { meta: { changes: 1 } }; }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', { businessTaxId: '12-3456789' }), env, {});
        expect(res.status).toBe(200);
        // First bind is the encrypted EIN (base64 string), not the plaintext.
        expect(captured[0]).not.toBe('12-3456789');
        expect(typeof captured[0]).toBe('string');
        expect(captured[0].length).toBeGreaterThan(0);
    });

    it('encrypts billing address as JSON before storing (no plaintext in binds)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        let captured = null;
        env.DB.__on(/UPDATE customers SET/, (sql, args) => { captured = args; return { meta: { changes: 1 } }; }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', {
            businessBillingAddress: { line1: '123 Main', city: 'Salt Lake', state: 'UT' },
        }), env, {});
        expect(res.status).toBe(200);
        // The encrypted address ciphertext is stored — not the plain JSON. Confirm
        // that neither the recognizable line1 substring nor city appears in binds.
        expect(captured[0]).not.toMatch(/Main/);
        expect(captured[0]).not.toMatch(/Salt Lake/);
    });

    it('sets businessBillingAddress to NULL when explicit null sent', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        let captured = null;
        env.DB.__on(/UPDATE customers SET/, (sql, args) => { captured = args; return { meta: { changes: 1 } }; }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', {
            businessBillingAddress: null,
        }), env, {});
        expect(res.status).toBe(200);
        expect(captured[0]).toBe(null);
    });

    it('writes customer.business_fields_updated audit on success', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        env.DB.__on(/UPDATE customers SET/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', { businessName: 'New Name' }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('customer.business_fields_updated'));
        expect(audit).toBeDefined();
    });

    it('accepts EIN=null to clear the field', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write.business_fields']);
        env.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/, { id: 'cus_biz', archived_at: null }, 'first');
        let captured = null;
        env.DB.__on(/UPDATE customers SET/, (sql, args) => { captured = args; return { meta: { changes: 1 } }; }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers/cus_biz/business', 'PUT', { businessTaxId: null }), env, {});
        expect(res.status).toBe(200);
        // null EIN bound as null (no encryption attempt for empty input).
        expect(captured[0]).toBe(null);
    });
});
