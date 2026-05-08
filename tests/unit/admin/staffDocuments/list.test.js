// M5 R5 — staff documents list endpoint tests.
// GET /api/admin/staff-documents — versioned JD/SOP/Checklist/Policy/Training
// document library. Capability-gated by staff.documents.read. Filters:
// kind, include_retired, role_id.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

const sampleDocument = (overrides = {}) => ({
    id: 'sd_001',
    kind: 'jd',
    slug: 'event-director',
    title: 'Event Director',
    body_html: '<h1>Event Director</h1>',
    body_sha256: 'a'.repeat(64),
    version: 'v1.0',
    primary_role_id: 'role_event_director',
    description: null,
    retired_at: null,
    retired_by_user_id: null,
    created_by_user_id: 'u_owner',
    created_at: Date.now() - 86400000,
    ...overrides,
});

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/staff-documents (list)', () => {
    it('returns 403 when caller lacks staff.documents.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.documents.read');
    });

    it('returns formatted documents (no kind filter; defaults to non-retired)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        env.DB.__on(/FROM staff_documents/, {
            results: [
                sampleDocument({ id: 'sd_jd', kind: 'jd', slug: 'event-director', title: 'Event Director' }),
                sampleDocument({ id: 'sd_sop', kind: 'sop', slug: 'check-in', title: 'Check-in SOP' }),
            ],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.documents).toHaveLength(2);
        expect(body.documents[0]).toHaveProperty('id');
        expect(body.documents[0]).toHaveProperty('kind');
        expect(body.documents[0]).toHaveProperty('bodySha256');
        expect(body.documents[0]).toHaveProperty('version');
    });

    it('passes kind filter through to SQL when valid (jd/sop/checklist/policy/training)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        env.DB.__on(/FROM staff_documents/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents?kind=jd', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /FROM staff_documents/.test(w.sql));
        expect(listQuery).toBeDefined();
        expect(listQuery.args).toContain('jd');
    });

    it('ignores kind filter for unknown kinds (treats as no filter)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        env.DB.__on(/FROM staff_documents/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents?kind=notakind', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /FROM staff_documents/.test(w.sql));
        expect(listQuery).toBeDefined();
        // 'notakind' should NOT have been bound as an arg — only valid kinds pass through
        expect(listQuery.args).not.toContain('notakind');
    });

    it('include_retired=1 toggles the retired_at IS NULL filter off', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        env.DB.__on(/FROM staff_documents/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents?include_retired=1', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /FROM staff_documents/.test(w.sql));
        expect(listQuery).toBeDefined();
        // When include_retired is on, the SQL should NOT contain "retired_at IS NULL"
        expect(/retired_at IS NULL/.test(listQuery.sql)).toBe(false);
    });

    it('passes role_id filter through to primary_role_id binding', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        env.DB.__on(/FROM staff_documents/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents?role_id=role_event_director', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /FROM staff_documents/.test(w.sql));
        expect(listQuery).toBeDefined();
        expect(listQuery.args).toContain('role_event_director');
        expect(/primary_role_id = \?/.test(listQuery.sql)).toBe(true);
    });
});
