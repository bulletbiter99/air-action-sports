// M6 Batch 2 — POST /api/admin/vendor-package-templates/:id/clone-to-event tests.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const PATH = '/api/admin/vendor-package-templates/vtpl_X/clone-to-event';

function templateRow(overrides = {}) {
    return {
        id: 'vtpl_X',
        name: 'Food Truck Package',
        description: 'desc',
        sections_json: JSON.stringify([
            { kind: 'overview', title: 'Setup', body_html: '<p>setup</p>', sort_order: 0 },
            { kind: 'schedule', title: 'Times', body_html: '<p>times</p>', sort_order: 1 },
        ]),
        requires_signature: 0,
        deleted_at: null,
        created_by: 'u_owner',
        created_at: 1000,
        updated_at: 1000,
        ...overrides,
    };
}

function wireHappyPath(env) {
    // 1) Look up the template
    env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');
    // 2) Look up the event
    env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'evt_X' }, 'first');
    // 3) Look up the vendor
    env.DB.__on(/SELECT id, deleted_at FROM vendors WHERE id = \?/, { id: 'vnd_X', deleted_at: null }, 'first');
    // 4) Check for existing (event, vendor) pair — none
    env.DB.__on(/SELECT id FROM event_vendors WHERE event_id = \? AND vendor_id = \?/, null, 'first');
}

describe('POST /:id/clone-to-event', () => {
    it('happy path: creates event_vendor, clones sections via batch, writes audit, returns 201', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        wireHappyPath(env);

        let insertEvBinds = null;
        env.DB.__on(/INSERT INTO event_vendors/, (sql, args) => {
            insertEvBinds = args;
            return { results: [] };
        }, 'run');

        // The clone helper uses env.DB.batch — wire the mock to capture stmts.
        const batchCaptured = [];
        env.DB.batch = async (stmts) => {
            for (const s of stmts) batchCaptured.push(s);
            return [];
        };

        let auditBinds = null;
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => {
            auditBinds = args;
            return { results: [] };
        }, 'run');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.eventVendorId).toMatch(/^evnd_/);
        expect(json.sectionsCloned).toBe(2);
        expect(json.contractRequired).toBe(false);

        // event_vendors INSERT bind shape: id, event_id, vendor_id, primary_contact_id,
        // template_id, contract_required, created_at, updated_at
        expect(insertEvBinds[0]).toMatch(/^evnd_/);
        expect(insertEvBinds[1]).toBe('evt_X');
        expect(insertEvBinds[2]).toBe('vnd_X');
        expect(insertEvBinds[3]).toBeNull(); // primary_contact_id default
        expect(insertEvBinds[4]).toBe('vtpl_X'); // template_id
        expect(insertEvBinds[5]).toBe(0); // contract_required (template.requires_signature=0)

        // batch captured 2 section INSERTs
        expect(batchCaptured).toHaveLength(2);

        // Audit row: event_vendor.created_from_template
        expect(auditBinds[1]).toBe('event_vendor.created_from_template');
        expect(auditBinds[2]).toBe('event_vendor');
        const meta = JSON.parse(auditBinds[4]);
        expect(meta.templateId).toBe('vtpl_X');
        expect(meta.eventId).toBe('evt_X');
        expect(meta.vendorId).toBe('vnd_X');
        expect(meta.sectionsCloned).toBe(2);
    });

    it('contract_required flips to 1 when template.requires_signature=1', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow({ requires_signature: 1 }), 'first');
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'evt_X' }, 'first');
        env.DB.__on(/SELECT id, deleted_at FROM vendors WHERE id = \?/, { id: 'vnd_X', deleted_at: null }, 'first');
        env.DB.__on(/SELECT id FROM event_vendors WHERE event_id = \? AND vendor_id = \?/, null, 'first');

        let insertBinds = null;
        env.DB.__on(/INSERT INTO event_vendors/, (sql, args) => {
            insertBinds = args;
            return { results: [] };
        }, 'run');
        env.DB.batch = async () => [];
        env.DB.__on(/INSERT INTO audit_log/, { results: [] }, 'run');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.contractRequired).toBe(true);
        expect(insertBinds[5]).toBe(1); // contract_required column
    });

    it('returns 409 + eventVendorId when (event, vendor) pair already exists', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'evt_X' }, 'first');
        env.DB.__on(/SELECT id, deleted_at FROM vendors WHERE id = \?/, { id: 'vnd_X', deleted_at: null }, 'first');
        env.DB.__on(/SELECT id FROM event_vendors WHERE event_id = \? AND vendor_id = \?/, { id: 'evnd_existing' }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.eventVendorId).toBe('evnd_existing');
        expect(json.error).toMatch(/already attached/i);
    });

    it('returns 404 when template not found', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });

    it('returns 409 when template is archived', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow({ deleted_at: 99 }), 'first');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(409);
        const d = await res.json();
        expect(d.error).toMatch(/archived/i);
    });

    it('returns 404 when event not found', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_missing', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });

    it('returns 404 when vendor not found', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'evt_X' }, 'first');
        env.DB.__on(/SELECT id, deleted_at FROM vendors WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_missing' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });

    it('returns 409 when vendor is archived', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'evt_X' }, 'first');
        env.DB.__on(/SELECT id, deleted_at FROM vendors WHERE id = \?/, { id: 'vnd_X', deleted_at: 12345 }, 'first');

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(409);
    });

    it('returns 400 when eventId or vendorId is missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        const res1 = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res1.status).toBe(400);
        expect((await res1.json()).error).toMatch(/eventId required/i);

        const res2 = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X' }),
            }),
            env,
            {},
        );
        expect(res2.status).toBe(400);
        expect((await res2.json()).error).toMatch(/vendorId required/i);
    });

    it('returns 403 for staff role', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(
            makeReq(PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: 'evt_X', vendorId: 'vnd_X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(401);
    });
});
