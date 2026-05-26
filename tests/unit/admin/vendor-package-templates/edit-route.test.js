// M6 Batch 2 — PUT /api/admin/vendor-package-templates/:id tests.

import { describe, it, expect } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

function makeReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

const BASE = '/api/admin/vendor-package-templates';

function templateRow(overrides = {}) {
    return {
        id: 'vtpl_X',
        name: 'Original',
        description: 'orig desc',
        sections_json: '[]',
        requires_signature: 0,
        deleted_at: null,
        created_by: 'u_owner',
        created_at: 1000,
        updated_at: 1000,
        ...overrides,
    };
}

describe('PUT /api/admin/vendor-package-templates/:id', () => {
    it('happy path: partial update succeeds, audit emitted, returns updated row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        let firstSelect = true;
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, () => {
            // First call: pre-update existence check. Second call: re-read after update.
            if (firstSelect) {
                firstSelect = false;
                return templateRow();
            }
            return templateRow({ name: 'New name', updated_at: 9999 });
        }, 'first');

        let updateSql = null;
        let updateBinds = null;
        env.DB.__on(/UPDATE vendor_package_templates SET/, (sql, args) => {
            updateSql = sql;
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
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'New name' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.template.name).toBe('New name');

        // SQL only includes the columns sent + updated_at
        expect(updateSql).toMatch(/name = \?/);
        expect(updateSql).toMatch(/updated_at = \?/);
        expect(updateSql).not.toMatch(/description = \?/);
        expect(updateSql).not.toMatch(/sections_json = \?/);
        expect(updateSql).not.toMatch(/requires_signature = \?/);

        // Binds: [name, updated_at, id] in order
        expect(updateBinds[0]).toBe('New name');
        expect(typeof updateBinds[1]).toBe('number');
        expect(updateBinds[2]).toBe('vtpl_X');

        // Audit row written with vendor_template.updated + changedFields meta
        expect(auditBinds[1]).toBe('vendor_template.updated');
        const meta = JSON.parse(auditBinds[4]);
        expect(meta.changedFields).toEqual(['name']);
    });

    it('multi-field update tracks all changed fields in the audit meta', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');
        env.DB.__on(/UPDATE vendor_package_templates SET/, { results: [] }, 'run');

        let auditBinds = null;
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => {
            auditBinds = args;
            return { results: [] };
        }, 'run');

        await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'X',
                    description: 'new desc',
                    sections: [{ kind: 'overview', title: 'T' }],
                    requiresSignature: true,
                }),
            }),
            env,
            {},
        );

        const meta = JSON.parse(auditBinds[4]);
        expect(meta.changedFields).toEqual(['name', 'description', 'sections', 'requiresSignature']);
    });

    it('normalizes sections through the helper before persisting', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });

        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');

        let updateBinds = null;
        env.DB.__on(/UPDATE vendor_package_templates SET/, (sql, args) => {
            updateBinds = args;
            return { results: [] };
        }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { results: [] }, 'run');

        await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sections: [
                        { kind: 'invalid_kind', title: 'A' }, // → coerce to custom
                        { title: 'B' },                         // → custom
                        { foo: 'bar' },                         // → filtered (no title)
                    ],
                }),
            }),
            env,
            {},
        );

        // First bind is the sections_json string (PUT sends only sections + updated_at)
        const sections = JSON.parse(updateBinds[0]);
        expect(sections).toHaveLength(2);
        expect(sections[0].kind).toBe('custom');
        expect(sections[1].kind).toBe('custom');
    });

    it('returns 404 when template not found', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_missing`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });

    it('returns 409 when template is archived', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow({ deleted_at: 1234 }), 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(409);
    });

    it('returns 400 when name is provided but blank', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '   ' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
        const d = await res.json();
        expect(d.error).toMatch(/cannot be empty/i);
    });

    it('returns 400 when name exceeds 200 chars', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'x'.repeat(201) }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });

    it('returns 400 when no updatable fields are present in the body', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        env.DB.__on(/SELECT \* FROM vendor_package_templates WHERE id = \?/, templateRow(), 'first');

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ irrelevant: 'foo' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
        const d = await res.json();
        expect(d.error).toMatch(/no fields/i);
    });

    it('returns 403 for staff role', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'staff' });

        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(
            makeReq(`${BASE}/vtpl_X`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(401);
    });
});
