// M5 R4 — staff list endpoint tests.
// Original M5 B4 spec called for split test files per endpoint; the M5
// rework restored that split. Covers capability gating + PII masking
// behavior on GET /api/admin/staff. Search-query (`?q=`) behavior moves
// to typeahead.test.js since the list endpoint doubles as the typeahead
// backend.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import {
    defaultPerson,
    bindCapabilities,
    bindStaffList,
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
        bindCapabilities(env.DB, 'u_owner', []);

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
});
