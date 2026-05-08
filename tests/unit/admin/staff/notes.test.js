// M5 R4 — staff notes endpoint tests.
// PUT /api/admin/staff/:id/notes — accepts plain `notes` (general)
// and `notesSensitive` (HR-only). Sensitive write requires the
// staff.notes.write_sensitive capability separately from staff.write.

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
