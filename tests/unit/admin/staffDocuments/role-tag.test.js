// M5 R5 — staff documents role-tagging endpoint tests.
// POST /api/admin/staff-documents/:id/role-tag — attach a doc to a role
// (with required flag for SOP/policy acknowledgment workflows).
// DELETE /api/admin/staff-documents/:id/role-tag/:tagId — detach.
// Both capability-gated by staff.documents.assign.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('POST /api/admin/staff-documents/:id/role-tag', () => {
    it('returns 403 when caller lacks staff.documents.assign', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_event_director', required: true }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.documents.assign');
    });

    it('returns 400 when roleId missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/roleId required/);
    });

    it('returns 400 when roleId is unknown', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id FROM roles WHERE id = \?/, null, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_nonexistent' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Unknown roleId/);
    });

    it('happy path: inserts tag with required=1, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id FROM roles WHERE id = \?/, { id: 'role_event_director' }, 'first');
        env.DB.__on(/INSERT INTO staff_document_roles/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_event_director', required: true }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.id).toMatch(/^sdr_/);

        const writes = env.DB.__writes();
        const tagWrite = writes.find((w) => /INSERT INTO staff_document_roles/.test(w.sql));
        expect(tagWrite).toBeDefined();
        // required: true → bound as 1
        expect(tagWrite.args).toContain(1);
        expect(tagWrite.args).toContain('role_event_director');

        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'staff_document.role_tagged')).toBe(true);
    });

    it('binds required=0 when payload omits required (default)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id FROM roles WHERE id = \?/, { id: 'role_event_director' }, 'first');
        env.DB.__on(/INSERT INTO staff_document_roles/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_event_director' }),
        });
        await worker.fetch(req, env, {});

        const writes = env.DB.__writes();
        const tagWrite = writes.find((w) => /INSERT INTO staff_document_roles/.test(w.sql));
        expect(tagWrite).toBeDefined();
        // required omitted → bound as 0 (falsy)
        expect(tagWrite.args).toContain(0);
    });

    it('returns 409 when the (doc, role) pair is already tagged (UNIQUE violation)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id FROM roles WHERE id = \?/, { id: 'role_event_director' }, 'first');
        // Simulate UNIQUE constraint violation
        env.DB.__on(/INSERT INTO staff_document_roles/, () => {
            throw new Error('UNIQUE constraint failed');
        }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_event_director' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toMatch(/already exists/i);
    });
});

describe('DELETE /api/admin/staff-documents/:id/role-tag/:tagId', () => {
    it('returns 403 when caller lacks staff.documents.assign', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag/sdr_001', {
            method: 'DELETE',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 404 when the tag does not exist for that doc', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/DELETE FROM staff_document_roles/, { meta: { changes: 0 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag/sdr_nonexistent', {
            method: 'DELETE',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('happy path: removes tag, audit-logs role_untagged', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/DELETE FROM staff_document_roles/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/role-tag/sdr_001', {
            method: 'DELETE',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'staff_document.role_untagged')).toBe(true);
    });
});
