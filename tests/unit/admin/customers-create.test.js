// Post-M6 Track D-1b — tests for the admin POST /api/admin/customers
// endpoint. Resolves the M5.5 polish item where phone-intake operators
// had no UI to create customers (SQL-only workaround prior).

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';

let env;
let cookieHeader;

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

describe('POST /api/admin/customers', () => {
    it('returns 403 without customers.write capability', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.read']);
        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', { email: 'a@b.com' }), env, {});
        expect(res.status).toBe(403);
    });

    it('returns 400 when email is missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', { name: 'Alice' }), env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/email/i);
    });

    it('returns 400 when email is malformed', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', { email: 'not-an-email' }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 409 with existingCustomerId when email is taken', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, { id: 'cus_existing' }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'taken@example.com',
        }), env, {});
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.existingCustomerId).toBe('cus_existing');
    });

    it('returns 400 when clientType not in {individual, business}', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'new@example.com',
            clientType: 'unknown',
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when businessTaxId is malformed', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'new@example.com',
            clientType: 'business',
            businessTaxId: 'not-real',
        }), env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/XX-XXXXXXX/);
    });

    it('creates individual customer with minimal payload + writes audit', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, null, 'first');
        env.DB.__on(/INSERT INTO customers/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'new@example.com',
            name: 'Alice',
        }), env, {});
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.customerId).toMatch(/^cus_/);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO customers/.test(w.sql) && w.kind === 'run');
        expect(insert).toBeDefined();
        // email_normalized is lowercased
        expect(insert.args).toContain('new@example.com');

        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('customer.created'));
        expect(audit).toBeDefined();
    });

    it('normalizes email to lowercase for email_normalized column', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, null, 'first');
        env.DB.__on(/INSERT INTO customers/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'NewUser@Example.COM',
        }), env, {});
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO customers/.test(w.sql) && w.kind === 'run');
        // Position 1 = email (original casing), position 2 = email_normalized (lowercased).
        expect(insert.args[1]).toBe('NewUser@Example.COM');
        expect(insert.args[2]).toBe('newuser@example.com');
    });

    it('encrypts businessTaxId before storing (no plaintext in binds)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, null, 'first');
        env.DB.__on(/INSERT INTO customers/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'biz@example.com',
            clientType: 'business',
            businessName: 'Acme Corp',
            businessTaxId: '12-3456789',
        }), env, {});
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO customers/.test(w.sql) && w.kind === 'run');
        // Confirm the plaintext EIN does NOT appear anywhere in the binds.
        const argsStr = insert.args.map((a) => String(a ?? '')).join('|');
        expect(argsStr).not.toMatch(/12-3456789/);
    });

    it('encrypts billing address as JSON before storing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, null, 'first');
        env.DB.__on(/INSERT INTO customers/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'biz@example.com',
            clientType: 'business',
            businessName: 'Acme Corp',
            businessBillingAddress: { line1: '500 Logan Ave', city: 'Salt Lake City', state: 'UT', postal: '84101' },
        }), env, {});
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO customers/.test(w.sql) && w.kind === 'run');
        const argsStr = insert.args.map((a) => String(a ?? '')).join('|');
        // Plaintext address parts should NOT appear in binds.
        expect(argsStr).not.toMatch(/Logan Ave/);
        expect(argsStr).not.toMatch(/Salt Lake City/);
    });

    it('preserves email_marketing/transactional defaults when not specified', async () => {
        bindCapabilities(env.DB, 'u_owner', ['customers.write']);
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, null, 'first');
        env.DB.__on(/INSERT INTO customers/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/customers', 'POST', {
            email: 'new@example.com',
        }), env, {});
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO customers/.test(w.sql) && w.kind === 'run');
        // emailTransactional default true → binds as 1; emailMarketing default true → 1
        expect(insert.args).toContain(1);
    });
});
