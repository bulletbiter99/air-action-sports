// M5 R4 — staff archive endpoint tests.
// POST /api/admin/staff/:id/archive — soft-archives the person record.
// Not in the original M5 B4 spec's 5-file split (list/detail/typeahead/
// roles/notes), but the pre-rework combined route.test.js had archive
// coverage that should not regress. Kept in its own file rather than
// folded into detail.test.js so concerns stay split.

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
