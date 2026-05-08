// M5 R4 — staff detail endpoint tests.
// GET /api/admin/staff/:id — returns full person record with primary
// role + tags. Capability-gated PII masking with audit row when granted.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import {
    defaultPerson,
    bindCapabilities,
    bindStaffDetail,
} from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/staff/:id (detail)', () => {
    it('returns 404 when person not found', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);

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
