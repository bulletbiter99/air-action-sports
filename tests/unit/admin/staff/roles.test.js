// M5 R4 — staff role-assign endpoint tests.
// POST /api/admin/staff/:id/role-assign — sets the person's primary
// role. Ends the previous primary role (UPDATE is_primary = 0), inserts
// the new primary, audit-logs.

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
