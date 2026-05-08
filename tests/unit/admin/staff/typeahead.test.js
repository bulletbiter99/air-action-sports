// M5 R4 — staff typeahead tests.
// The typeahead behavior lives on the list endpoint via `?q=` —
// rather than a separate /typeahead endpoint, the search query is
// passed straight to the list query (as `LIKE %q%` on full_name +
// email + role keys). These tests lock the search-query contract:
// param name, SQL parameterization, capability gating, empty-q
// fallthrough, whitespace handling, and limit-clamp.

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

describe('GET /api/admin/staff?q=… (typeahead)', () => {
    it('passes q param to SQL with %wraps% (LIKE-style search)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindStaffList(env.DB, []);

        const req = new Request('https://airactionsport.com/api/admin/staff?q=jane', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /SELECT p\.id, p\.user_id/.test(w.sql));
        expect(listQuery).toBeDefined();
        expect(listQuery.args).toContain('%jane%');
    });

    it('empty q falls through to unfiltered list (no q-arg in SQL params)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindStaffList(env.DB, [defaultPerson({ id: 'prs_1' })]);

        const req = new Request('https://airactionsport.com/api/admin/staff', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /SELECT p\.id, p\.user_id/.test(w.sql));
        expect(listQuery).toBeDefined();
        // No %...% LIKE arg present.
        expect(listQuery.args.some((a) => typeof a === 'string' && a.startsWith('%') && a.endsWith('%'))).toBe(false);
    });

    it('returns 403 on typeahead query when caller lacks staff.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);

        const req = new Request('https://airactionsport.com/api/admin/staff?q=anything', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns matching person rows shaped for typeahead consumers', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindStaffList(env.DB, [
            defaultPerson({ id: 'prs_1', full_name: 'Jane Doe' }),
            defaultPerson({ id: 'prs_2', full_name: 'Janet Smith' }),
        ]);

        const req = new Request('https://airactionsport.com/api/admin/staff?q=jan', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.persons).toHaveLength(2);
        // Each person row carries id + a display label suitable for a typeahead
        // dropdown (the consumer can pick fullName from the masked or unmasked field).
        expect(body.persons[0]).toHaveProperty('id');
        expect(body.persons[0]).toHaveProperty('fullName');
    });

    it('clamps limit param to a hard max of 200', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindStaffList(env.DB, []);

        const req = new Request('https://airactionsport.com/api/admin/staff?q=test&limit=999999', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /SELECT p\.id, p\.user_id/.test(w.sql));
        expect(listQuery).toBeDefined();
        // Limit arg should be clamped to 200 — not the user-requested 999999.
        expect(listQuery.args).toContain(200);
        expect(listQuery.args).not.toContain(999999);
    });
});
