// M5 R5 — staff documents create endpoint tests.
// POST /api/admin/staff-documents — creates a new doc or new version.
// Mirrors waiver_documents pattern: retires the previous live version
// of the same slug at the same instant the new version takes effect.
// Validates kind, slug, title, bodyHtml, version. Computes SHA-256.
// Audit-logs staff_document.created.

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

const validBody = (overrides = {}) => ({
    kind: 'jd',
    slug: 'event-director',
    title: 'Event Director',
    bodyHtml: '<h1>Event Director</h1><p>Coordinates event-day staff.</p>',
    version: 'v1.0',
    ...overrides,
});

describe('POST /api/admin/staff-documents (create)', () => {
    it('returns 403 when caller lacks staff.documents.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.documents.write');
    });

    it('returns 400 on invalid body (non-JSON)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: 'not json',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 on unknown kind', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody({ kind: 'unknown' })),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/kind must be one of/);
    });

    it('returns 400 when required fields missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'jd', slug: 'event-director' }), // missing title/bodyHtml/version
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/required/);
    });

    it('returns 400 when bodyHtml exceeds 500,000 chars', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody({ bodyHtml: 'a'.repeat(500001) })),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/too long/);
    });

    it('returns 409 when (slug, version) already exists', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);
        env.DB.__on(/FROM staff_documents WHERE slug = \? AND version = \?/, { id: 'sd_existing' }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toMatch(/already exists/);
    });

    it('happy path: retires previous version, inserts new, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);
        env.DB.__on(/FROM staff_documents WHERE slug = \? AND version = \?/, null, 'first');
        env.DB.__on(/UPDATE staff_documents SET retired_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO staff_documents/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM staff_documents WHERE id = \?/, {
            id: 'sd_new',
            kind: 'jd',
            slug: 'event-director',
            title: 'Event Director',
            body_html: '<h1>Event Director</h1>',
            body_sha256: 'a'.repeat(64),
            version: 'v1.0',
            primary_role_id: null,
            description: null,
            retired_at: null,
            created_at: Date.now(),
        }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody()),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.document).toBeDefined();
        expect(body.document.kind).toBe('jd');
        expect(body.document.version).toBe('v1.0');

        const writes = env.DB.__writes();
        // Verify retire-previous, insert-new, and audit-log all ran
        expect(writes.some((w) => /UPDATE staff_documents SET retired_at/.test(w.sql))).toBe(true);
        expect(writes.some((w) => /INSERT INTO staff_documents/.test(w.sql))).toBe(true);
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'staff_document.created')).toBe(true);
    });

    it('computes SHA-256 of bodyHtml and binds it to the INSERT', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.write']);
        env.DB.__on(/FROM staff_documents WHERE slug = \? AND version = \?/, null, 'first');
        env.DB.__on(/UPDATE staff_documents SET retired_at/, { meta: { changes: 0 } }, 'run');
        env.DB.__on(/INSERT INTO staff_documents/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM staff_documents WHERE id = \?/, {
            id: 'sd_x', kind: 'jd', slug: 'x', title: 'X',
            body_html: 'X', body_sha256: 'x'.repeat(64), version: 'v1.0',
            primary_role_id: null, description: null, retired_at: null, created_at: Date.now(),
        }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff-documents', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody({ bodyHtml: 'predictable body' })),
        });
        await worker.fetch(req, env, {});

        const writes = env.DB.__writes();
        const insertWrite = writes.find((w) => /INSERT INTO staff_documents/.test(w.sql));
        expect(insertWrite).toBeDefined();
        // The hash should be a 64-char lowercase hex string
        const hashArg = insertWrite.args.find((a) => typeof a === 'string' && /^[0-9a-f]{64}$/.test(a));
        expect(hashArg).toBeDefined();
    });
});
