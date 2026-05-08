// M5 Batch 6 — portal auth + portalSession + admin invite tests.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';
import {
    mintInviteToken,
    createPortalCookie,
    verifyPortalCookie,
} from '../../../worker/lib/portalSession.js';

let env;
let adminCookie;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    adminCookie = session.cookieHeader;
});

describe('mintInviteToken', () => {
    it('produces a hex token + matching SHA-256 hash', async () => {
        const { token, tokenHash } = await mintInviteToken();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces unique tokens across calls', async () => {
        const set = new Set();
        for (let i = 0; i < 200; i++) {
            const { token } = await mintInviteToken();
            set.add(token);
        }
        expect(set.size).toBe(200);
    });
});

describe('createPortalCookie + verifyPortalCookie', () => {
    it('roundtrip: creates a cookie that verifies to the same payload', async () => {
        const cookie = await createPortalCookie('ps_abc', 1, 'test-secret-must-be-32-bytes-or-more-pad');
        const payload = await verifyPortalCookie(cookie, 'test-secret-must-be-32-bytes-or-more-pad');
        expect(payload).not.toBeNull();
        expect(payload.psi).toBe('ps_abc');
        expect(payload.tv).toBe(1);
    });

    it('returns null for a tampered signature', async () => {
        const cookie = await createPortalCookie('ps_abc', 1, 'secret-padding-32bytes-or-more-x');
        const tampered = cookie.slice(0, -2) + 'XX';
        const payload = await verifyPortalCookie(tampered, 'secret-padding-32bytes-or-more-x');
        expect(payload).toBeNull();
    });

    it('returns null for a wrong-secret signature', async () => {
        const cookie = await createPortalCookie('ps_abc', 1, 'secret-A-32bytes-or-more-padding-');
        const payload = await verifyPortalCookie(cookie, 'secret-B-32bytes-or-more-padding-');
        expect(payload).toBeNull();
    });

    it('returns null for malformed input', async () => {
        expect(await verifyPortalCookie(null, 'sec')).toBeNull();
        expect(await verifyPortalCookie('', 'sec')).toBeNull();
        expect(await verifyPortalCookie('not-two-parts', 'sec')).toBeNull();
    });
});

describe('POST /api/admin/staff/:id/invite', () => {
    it('mints a portal_sessions row and returns ok', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, full_name, email, archived_at FROM persons WHERE id = \?/, {
            id: 'prs_1', full_name: 'Jane Doe', email: 'jane@example.com', archived_at: null,
        }, 'first');
        env.DB.__on(/INSERT INTO portal_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/invite', {
            method: 'POST',
            headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.sessionId).toMatch(/^ps_/);
        // In test env, Resend isn't configured so the magic link is
        // surfaced in debugLink for operator testing.
        expect(body.debugLink).toMatch(/portal\/auth\/consume\?token=/);
    });

    it('returns 404 when person not found', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_nonexistent/invite', {
            method: 'POST',
            headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when person is archived', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, full_name, email, archived_at FROM persons WHERE id = \?/, {
            id: 'prs_1', full_name: 'Jane', email: 'j@x.com', archived_at: Date.now(),
        }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/invite', {
            method: 'POST',
            headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
    });

    it('returns 400 when person has no email', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, full_name, email, archived_at FROM persons WHERE id = \?/, {
            id: 'prs_1', full_name: 'Jane', email: null, archived_at: null,
        }, 'first');

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/invite', {
            method: 'POST',
            headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 403 when caller lacks staff.invite', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);

        const req = new Request('https://airactionsport.com/api/admin/staff/prs_1/invite', {
            method: 'POST',
            headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });
});

describe('POST /api/portal/auth/consume', () => {
    it('returns 400 when token missing from body', async () => {
        const req = new Request('https://airactionsport.com/api/portal/auth/consume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 401 when token does not match any portal_session', async () => {
        // Default mockD1 returns null for first()
        const req = new Request('https://airactionsport.com/api/portal/auth/consume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'badtoken' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 410 when token already consumed', async () => {
        env.DB.__on(/FROM portal_sessions[\s\S]+token_hash = \?/, {
            id: 'ps_1', person_id: 'prs_1', token_version: 1,
            expires_at: Date.now() + 60_000,
            consumed_at: Date.now() - 1000,
            revoked_at: null,
        }, 'first');

        const req = new Request('https://airactionsport.com/api/portal/auth/consume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'consumedtoken' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(410);
    });

    it('returns 410 when token expired', async () => {
        env.DB.__on(/FROM portal_sessions[\s\S]+token_hash = \?/, {
            id: 'ps_1', person_id: 'prs_1', token_version: 1,
            expires_at: Date.now() - 1000,
            consumed_at: null, revoked_at: null,
        }, 'first');

        const req = new Request('https://airactionsport.com/api/portal/auth/consume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'expiredtoken' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(410);
    });

    it('happy path: marks consumed_at, sets cookie, audit-logs', async () => {
        env.DB.__on(/FROM portal_sessions[\s\S]+token_hash = \?/, {
            id: 'ps_1', person_id: 'prs_1', token_version: 1,
            expires_at: Date.now() + 60_000,
            consumed_at: null, revoked_at: null,
        }, 'first');
        env.DB.__on(/SELECT id, archived_at FROM persons WHERE id = \?/, {
            id: 'prs_1', archived_at: null,
        }, 'first');
        env.DB.__on(/UPDATE portal_sessions SET consumed_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/portal/auth/consume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'goodtoken' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const setCookie = res.headers.get('Set-Cookie');
        expect(setCookie).toContain('aas_portal_session=');
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('SameSite=Lax');
    });
});
