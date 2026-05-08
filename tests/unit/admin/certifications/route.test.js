// M5 Batch 8 — admin certifications route tests.

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

describe('GET /api/admin/certifications', () => {
    it('returns 400 without person_id', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.certifications.read']);
        const req = new Request('https://airactionsport.com/api/admin/certifications', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 403 without staff.certifications.read', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        const req = new Request('https://airactionsport.com/api/admin/certifications?person_id=prs_1', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns paginated certs for a person', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.certifications.read']);
        env.DB.__on(/FROM certifications WHERE person_id/, {
            results: [{
                id: 'cert_1', person_id: 'prs_1', kind: 'cpr',
                display_name: 'CPR/AED', status: 'active',
                expires_at: Date.now() + 86400000 * 365,
            }],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/certifications?person_id=prs_1', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.certifications).toHaveLength(1);
        expect(body.certifications[0].kind).toBe('cpr');
    });
});

describe('POST /api/admin/certifications', () => {
    it('returns 400 when required fields missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.certifications.write']);

        const req = new Request('https://airactionsport.com/api/admin/certifications', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('happy path: creates cert + audit row', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.certifications.write']);
        env.DB.__on(/INSERT INTO certifications/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/certifications', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: 'prs_1', kind: 'cpr', displayName: 'CPR/AED',
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toMatch(/^cert_/);
    });
});

describe('POST /api/admin/certifications/:id/renew', () => {
    it('creates new cert linked via previous_cert_id and expires the old', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.certifications.write']);
        env.DB.__on(/SELECT \* FROM certifications WHERE id = \?/, {
            id: 'cert_old', person_id: 'prs_1', kind: 'cpr',
            display_name: 'CPR/AED', issuing_authority: 'AHA',
            certificate_number: 'OLD123',
        }, 'first');
        env.DB.__on(/INSERT INTO certifications/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE certifications SET status = 'expired'/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/certifications/cert_old/renew', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ certificateNumber: 'NEW456', issuedAt: Date.now() }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toMatch(/^cert_/);
        expect(body.previousCertId).toBe('cert_old');
    });
});

describe('GET /api/admin/certifications/expiring', () => {
    it('clamps days to 1-365', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.certifications.read']);
        env.DB.__on(/c\.expires_at < \?/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/certifications/expiring?days=9999', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.days).toBe(365);
    });

    it('returns expiring certs joined with person info', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.certifications.read']);
        env.DB.__on(/c\.expires_at < \?/, {
            results: [{
                id: 'cert_1', person_id: 'prs_1', kind: 'cpr', display_name: 'CPR',
                status: 'active', expires_at: Date.now() + 30 * 86400000,
                person_name: 'Jane Doe', person_email: 'jane@example.com',
            }],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/certifications/expiring?days=60', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.certifications).toHaveLength(1);
        expect(body.certifications[0].personName).toBe('Jane Doe');
    });
});
