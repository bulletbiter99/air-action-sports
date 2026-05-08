// M5 Batch 4 — admin staff route integration tests.
// Covers: list (capability-gated), detail (PII masking), role-assign,
// notes update (with sensitive-notes capability gate), and archive.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import {
    defaultPerson,
    bindCapabilities,
    bindStaffList,
    bindStaffDetail,
} from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/staff (list)', () => {
    it('returns 403 when caller lacks staff.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []); // no caps

        const req = new Request('https://airactionsport.com/api/admin/staff', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.read');
    });

    it('returns paginated list with masked PII when caller lacks staff.read.pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindStaffList(env.DB, [
            defaultPerson({ id: 'prs_1', full_name: 'Jane Doe', email: 'jane@example.com', phone: '5551234567' }),
            defaultPerson({ id: 'prs_2', full_name: 'John Smith', email: 'john.smith@example.com', phone: '5559876543' }),
        ]);

        const req = new Request('https://airactionsport.com/api/admin/staff', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.viewerCanSeePii).toBe(false);
        expect(body.persons).toHaveLength(2);
        // Email/phone masked
        expect(body.persons[0].email).toMatch(/^j\*\*\*@example\.com$/);
        expect(body.persons[0].phone).toMatch(/^\(\*\*\*\) \*\*\*-4567$/);
    });

    it('returns full PII when caller has staff.read.pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.read.pii']);
        bindStaffList(env.DB, [
            defaultPerson({ email: 'visible@example.com', phone: '5551234567' }),
        ]);

        const req = new Request('https://airactionsport.com/api/admin/staff', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.viewerCanSeePii).toBe(true);
        expect(body.persons[0].email).toBe('visible@example.com');
        expect(body.persons[0].phone).toBe('5551234567');
    });

    it('honors search query (q) param', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindStaffList(env.DB, []);

        const req = new Request('https://airactionsport.com/api/admin/staff?q=jane', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        // Verify the query went out with q=jane
        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /SELECT p\.id, p\.user_id/.test(w.sql));
        expect(listQuery).toBeDefined();
        expect(listQuery.args).toContain('%jane%');
    });
});

describe('GET /api/admin/staff/:id (detail)', () => {
    it('returns 404 when person not found', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        // Default mockD1 returns null for SELECT * FROM persons WHERE id = ?
        const req = new Request('https://airactionsport.com/api/admin/staff/prs_nonexistent', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns person with primary role + tags; masks PII without staff.read.pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindStaffDetail(env.DB,
            defaultPerson({ id: 'prs_1', email: 'private@example.com' }),
            [{
                id: 'pr_1', role_id: 'role_event_director', key: 'event_director',
                name: 'Event Director', tier: 1, is_primary: 1,
                effective_from: Date.now() - 86400000, effective_to: null, notes: null,
                created_at: Date.now() - 86400000,
            }],
            [{ id: 'pt_1', tag: 'cpr_cert', source: 'manual', created_at: Date.now() }],
        );

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.person.email).toMatch(/^p\*\*\*@example\.com$/);
        expect(body.roles).toHaveLength(1);
        expect(body.roles[0].name).toBe('Event Director');
        expect(body.roles[0].isPrimary).toBe(true);
        expect(body.tags).toHaveLength(1);
    });

    it('emits staff.pii.unmasked audit row when PII access granted', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.read.pii']);
        bindStaffDetail(env.DB, defaultPerson({ id: 'prs_1' }));

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1', {
            headers: { cookie: cookieHeader },
        });
        await worker.fetch(req, env, {});
        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'staff.pii.unmasked')).toBe(true);
    });
});

describe('POST /api/admin/staff/:id/role-assign', () => {
    it('returns 400 when roleId missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.role.assign']);

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/role-assign', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when roleId unknown', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.role.assign']);
        // The role lookup returns null (not found)
        env.DB.__on(/FROM roles WHERE id = \?/, null, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/role-assign', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_nonexistent' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Unknown roleId/);
    });

    it('returns 403 when caller lacks staff.role.assign', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/role-assign', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_event_director' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('happy path: ends current primary, inserts new primary, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.role.assign']);
        env.DB.__on(/FROM roles WHERE id = \?/, { id: 'role_event_director' }, 'first');
        env.DB.__on(/FROM persons WHERE id = \?/, { id: 'prs_1' }, 'first');
        env.DB.__on(/UPDATE person_roles SET is_primary = 0/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO person_roles/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/role-assign', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId: 'role_event_director' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.personRoleId).toMatch(/^pr_/);
    });
});

describe('PUT /api/admin/staff/:id/notes', () => {
    it('updates notes when caller has staff.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/notes', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: 'Some general note' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
    });

    it('returns 403 when caller writes notesSensitive without staff.notes.write_sensitive', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/notes', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notesSensitive: 'HR-only content' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.notes.write_sensitive');
    });

    it('updates both notes + notesSensitive when caller has both caps', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write', 'staff.notes.write_sensitive']);
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/notes', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: 'public', notesSensitive: 'private' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
    });
});

describe('POST /api/admin/staff/:id/archive', () => {
    it('soft-archives the person and audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.archive']);
        env.DB.__on(/UPDATE persons SET archived_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/archive', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'departed' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
    });

    it('returns 404 when no row was changed (already archived or not found)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.archive']);
        env.DB.__on(/UPDATE persons SET archived_at/, { meta: { changes: 0 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/archive', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'departed' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });
});
