// M5 R5 — staff documents retire endpoint tests.
// POST /api/admin/staff-documents/:id/retire — retires a doc without
// replacement (e.g., legal-required takedown). Capability-gated by
// staff.documents.write. 404 on unknown id; 409 on already-retired.

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

describe('POST /api/admin/staff-documents/:id/retire', () => {
    it('returns 403 when caller lacks staff.documents.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/retire', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.documents.write');
    });

    it('returns 404 when the document does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);
        env.DB.__on(/SELECT \* FROM staff_documents WHERE id = \?/, null, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_nonexistent/retire', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when the document is already retired', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);
        env.DB.__on(/SELECT \* FROM staff_documents WHERE id = \?/, {
            id: 'sd_001',
            retired_at: Date.now() - 86400000,
        }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/retire', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toMatch(/Already retired/i);
    });

    it('happy path: marks retired_at + retired_by_user_id, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);
        env.DB.__on(/SELECT \* FROM staff_documents WHERE id = \?/, {
            id: 'sd_001',
            retired_at: null,
            kind: 'jd',
            slug: 'event-director',
            version: 'v1.0',
        }, 'first');
        env.DB.__on(/UPDATE staff_documents SET retired_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents/sd_001/retire', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);

        const writes = env.DB.__writes();
        const updateWrite = writes.find((w) => /UPDATE staff_documents SET retired_at/.test(w.sql));
        expect(updateWrite).toBeDefined();
        // user.id should be bound as retired_by_user_id (second arg after retired_at)
        expect(updateWrite.args).toContain('u_owner');

        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'staff_document.retired')).toBe(true);
    });
});
