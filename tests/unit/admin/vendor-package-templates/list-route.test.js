// M6 Batch 1 — Admin vendor_package_templates route tests.
//
// Covers list / get / create / soft-delete on /api/admin/vendor-package-templates.
// Same auth + audit pattern as worker/routes/admin/vendors.js.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const BASE = '/api/admin/vendor-package-templates';

describe('GET /api/admin/vendor-package-templates — list', () => {
    it('returns active templates only by default (deleted hidden)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        env.DB.__on(/FROM vendor_package_templates WHERE deleted_at IS NULL/, {
            results: [
                {
                    id: 'vtpl_A',
                    name: 'Food Truck Package',
                    description: 'Sections for food trucks',
                    sections_json: '[{"kind":"text","title":"Setup","body_html":"<p>...</p>","sort_order":0}]',
                    requires_signature: 0,
                    deleted_at: null,
                    created_by: 'u_owner',
                    created_at: 1000,
                    updated_at: 1000,
                },
                {
                    id: 'vtpl_B',
                    name: 'Medic Package',
                    description: null,
                    sections_json: '[]',
                    requires_signature: 1,
                    deleted_at: null,
                    created_by: 'u_owner',
                    created_at: 2000,
                    updated_at: 2000,
                },
            ],
        }, 'all');

        const res = await worker.fetch(makeReq(BASE, { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.templates).toHaveLength(2);
        expect(json.templates[0].id).toBe('vtpl_A');
        expect(json.templates[0].name).toBe('Food Truck Package');
        expect(json.templates[0].sections).toHaveLength(1);
        expect(json.templates[0].sectionsCount).toBe(1);
        expect(json.templates[0].requiresSignature).toBe(false);
        expect(json.templates[1].requiresSignature).toBe(true);
    });

    it('include_deleted=1 omits the deleted_at filter (returns all)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        let capturedSql = '';
        env.DB.__on(/FROM vendor_package_templates/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        const res = await worker.fetch(
            makeReq(`${BASE}?include_deleted=1`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(capturedSql).not.toMatch(/deleted_at IS NULL/);
    });

    it('q parameter binds LIKE patterns against name + description', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        let capturedBinds = null;
        env.DB.__on(/FROM vendor_package_templates.*name LIKE \? OR description LIKE \?/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            makeReq(`${BASE}?q=truck`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(capturedBinds).toEqual(['%truck%', '%truck%']);
    });

    it('returns 401 without auth', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(makeReq(BASE), env, {});
        expect(res.status).toBe(401);
    });
});

describe('GET /api/admin/vendor-package-templates/:id', () => {
    it('returns the template when found', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        env.DB.__on(/FROM vendor_package_templates WHERE id = \?/, {
            id: 'vtpl_X',
            name: 'X Template',
            description: 'desc',
            sections_json: '[]',
            requires_signature: 0,
            deleted_at: null,
            created_by: 'u_owner',
            created_at: 1000,
            updated_at: 1000,
        }, 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.template.id).toBe('vtpl_X');
        expect(json.template.name).toBe('X Template');
    });

    it('returns 404 when not found', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });
        env.DB.__on(/FROM vendor_package_templates WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_missing`, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });
});

describe('POST /api/admin/vendor-package-templates — create', () => {
    it('happy path: creates template + writes audit + returns 201', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        let insertedBinds = null;
        env.DB.__on(/INSERT INTO vendor_package_templates/, (sql, args) => {
            insertedBinds = args;
            return { results: [] };
        }, 'run');

        let auditBinds = null;
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => {
            auditBinds = args;
            return { results: [] };
        }, 'run');

        // Re-read after insert
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, {
            id: 'will-be-set',
            name: 'Food Truck Package',
            description: 'desc',
            sections_json: '[]',
            requires_signature: 0,
            deleted_at: null,
            created_by: 'u_actor',
            created_at: Date.now(),
            updated_at: Date.now(),
        }, 'first');

        const res = await worker.fetch(
            makeReq(BASE, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Food Truck Package', description: 'desc' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.template).toBeDefined();
        expect(json.template.name).toBe('Food Truck Package');

        // Insert binds: id, name, description, sections_json, requires_signature, created_by, created_at, updated_at
        expect(insertedBinds[0]).toMatch(/^vtpl_/);
        expect(insertedBinds[1]).toBe('Food Truck Package');
        expect(insertedBinds[2]).toBe('desc');
        expect(insertedBinds[3]).toBe('[]'); // empty sections
        expect(insertedBinds[4]).toBe(0); // requires_signature default

        // Audit row written with vendor_template.created
        expect(auditBinds).not.toBeNull();
        expect(auditBinds[1]).toBe('vendor_template.created');
        expect(auditBinds[2]).toBe('vendor_package_template');
    });

    it('returns 400 when name is missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        const res = await worker.fetch(
            makeReq(BASE, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: 'no name here' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/name required/i);
    });

    it('returns 400 when name exceeds 200 chars', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        const res = await worker.fetch(
            makeReq(BASE, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'x'.repeat(201) }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/too long/i);
    });

    it('returns 403 for staff (mutation requires manager+)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        const res = await worker.fetch(
            makeReq(BASE, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Anything' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('normalizes a sections array and stores it as JSON', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        let insertedBinds = null;
        env.DB.__on(/INSERT INTO vendor_package_templates/, (sql, args) => {
            insertedBinds = args;
            return { results: [] };
        }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { results: [] }, 'run');
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, {
            id: 'vtpl_X', name: 'T', description: null, sections_json: '[]',
            requires_signature: 0, deleted_at: null, created_by: 'u_actor', created_at: 1, updated_at: 1,
        }, 'first');

        await worker.fetch(
            makeReq(BASE, {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'T',
                    sections: [
                        { kind: 'text', title: 'Setup', body_html: '<p>x</p>' },
                        { title: 'Cleanup' }, // partial — should normalize to defaults
                        { notATitle: 'skip' }, // invalid — should be filtered out
                    ],
                    requiresSignature: true,
                }),
            }),
            env,
            {},
        );
        const sectionsJsonArg = insertedBinds[3];
        const sections = JSON.parse(sectionsJsonArg);
        expect(sections).toHaveLength(2); // invalid one filtered
        // M6 B2: kind values are coerced to the
        // vendor_package_sections CHECK enum ('overview', 'schedule',
        // 'map', 'contact', 'custom') so templates are always
        // cloneable. Both 'text' (input section[0]) and missing kind
        // (input section[1]) coerce to 'custom'. Pre-B2 this defaulted
        // to 'text' which would have failed at clone time.
        expect(sections[0].title).toBe('Setup');
        expect(sections[0].kind).toBe('custom');
        expect(sections[1].title).toBe('Cleanup');
        expect(sections[1].kind).toBe('custom');
        expect(insertedBinds[4]).toBe(1); // requires_signature: true → 1
    });
});

describe('DELETE /api/admin/vendor-package-templates/:id — soft delete', () => {
    it('happy path: sets deleted_at + writes audit', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        env.DB.__on(/SELECT id, name, deleted_at FROM vendor_package_templates WHERE id = \?/, {
            id: 'vtpl_X', name: 'X', deleted_at: null,
        }, 'first');

        let updateBinds = null;
        env.DB.__on(/UPDATE vendor_package_templates SET deleted_at = \?/, (sql, args) => {
            updateBinds = args;
            return { results: [] };
        }, 'run');

        let auditBinds = null;
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => {
            auditBinds = args;
            return { results: [] };
        }, 'run');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(updateBinds[0]).toBeTypeOf('number'); // deleted_at = Date.now()
        expect(auditBinds[1]).toBe('vendor_template.archived');
    });

    it('returns 404 when template not found', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT id, name, deleted_at FROM vendor_package_templates WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_missing`, {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });

    it('returns 409 when template already archived', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT id, name, deleted_at FROM vendor_package_templates WHERE id = \?/, {
            id: 'vtpl_X', name: 'X', deleted_at: 99999,
        }, 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(409);
    });

    it('returns 403 for staff (mutation requires manager+)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });
});
