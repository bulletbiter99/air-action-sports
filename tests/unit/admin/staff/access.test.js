// Post-M5.5 P3 — tests for the Access tab endpoints on /admin/staff/:id.
//
// GET  /api/admin/staff/:id/portal-sessions               (staff.read)
// POST /api/admin/staff/:id/portal-sessions/:sid/revoke   (staff.invite)
//
// Status derivation server-side:
//   revoked_at set                              → 'revoked'
//   consumed_at set + cookie_expires_at >= now  → 'active'
//   consumed_at set + cookie_expires_at < now   → 'expired'
//   consumed_at null + expires_at >= now        → 'pending'
//   consumed_at null + expires_at < now         → 'expired'

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;
const now = Date.now();
const PERSON_ID = 'prs_1';

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

function bindSessionList(rows) {
    env.DB.__on(/FROM portal_sessions\s+WHERE person_id = \?/, { results: rows }, 'all');
}

async function listSessions() {
    return worker.fetch(
        new Request(`https://airactionsport.com/api/admin/staff/${PERSON_ID}/portal-sessions`, {
            headers: { cookie: cookieHeader },
        }),
        env, {},
    );
}

async function revokeSession(sid, body = {}) {
    return worker.fetch(
        new Request(`https://airactionsport.com/api/admin/staff/${PERSON_ID}/portal-sessions/${sid}/revoke`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env, {},
    );
}

describe('GET /api/admin/staff/:id/portal-sessions — gating + shape', () => {
    it('returns 403 when caller lacks staff.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await listSessions();
        expect(res.status).toBe(403);
    });

    it('returns empty list when person has no portal sessions', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindSessionList([]);
        const res = await listSessions();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sessions).toEqual([]);
    });

    it('computes status correctly across the 4 states + matches the field shape', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindSessionList([
            {
                id: 'ps_revoked', person_id: PERSON_ID,
                consumed_at: null, expires_at: now + 86400000, cookie_expires_at: null,
                ip_address: '1.1.1.1', user_agent: 'UA', created_by_user_id: 'u_owner',
                created_at: now - 3600000, revoked_at: now - 60000, revoked_reason: 'lost_device',
            },
            {
                id: 'ps_active', person_id: PERSON_ID,
                consumed_at: now - 1800000, expires_at: now + 86400000, cookie_expires_at: now + 7200000,
                ip_address: '2.2.2.2', user_agent: 'UA', created_by_user_id: 'u_owner',
                created_at: now - 3600000, revoked_at: null, revoked_reason: null,
            },
            {
                id: 'ps_expired', person_id: PERSON_ID,
                consumed_at: null, expires_at: now - 1000, cookie_expires_at: null,
                ip_address: null, user_agent: null, created_by_user_id: 'u_owner',
                created_at: now - 100000000, revoked_at: null, revoked_reason: null,
            },
            {
                id: 'ps_pending', person_id: PERSON_ID,
                consumed_at: null, expires_at: now + 86400000, cookie_expires_at: null,
                ip_address: null, user_agent: null, created_by_user_id: 'u_owner',
                created_at: now - 60000, revoked_at: null, revoked_reason: null,
            },
        ]);

        const res = await listSessions();
        expect(res.status).toBe(200);
        const body = await res.json();
        const byId = Object.fromEntries(body.sessions.map((s) => [s.id, s]));
        expect(byId.ps_revoked.status).toBe('revoked');
        expect(byId.ps_revoked.revokedReason).toBe('lost_device');
        expect(byId.ps_active.status).toBe('active');
        expect(byId.ps_expired.status).toBe('expired');
        expect(byId.ps_pending.status).toBe('pending');
        // Camel-cased contract
        expect(byId.ps_active).toHaveProperty('createdAt');
        expect(byId.ps_active).toHaveProperty('consumedAt');
        expect(byId.ps_active).toHaveProperty('expiresAt');
        expect(byId.ps_active).toHaveProperty('cookieExpiresAt');
    });
});

describe('POST /:id/portal-sessions/:sessionId/revoke — gating + flow', () => {
    it('returns 403 when caller lacks staff.invite', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        const res = await revokeSession('ps_1');
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.invite');
    });

    it('returns 404 when session does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, person_id, revoked_at FROM portal_sessions WHERE id = \?/, null, 'first');
        const res = await revokeSession('ps_unknown');
        expect(res.status).toBe(404);
    });

    it('returns 400 when session belongs to a different person', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, person_id, revoked_at FROM portal_sessions WHERE id = \?/, {
            id: 'ps_other', person_id: 'prs_someone_else', revoked_at: null,
        }, 'first');
        const res = await revokeSession('ps_other');
        expect(res.status).toBe(400);
    });

    it('returns 409 when session is already revoked (idempotent guard)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, person_id, revoked_at FROM portal_sessions WHERE id = \?/, {
            id: 'ps_already', person_id: PERSON_ID, revoked_at: now - 1000,
        }, 'first');
        const res = await revokeSession('ps_already');
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.revokedAt).toBe(now - 1000);
    });

    it('revokes + writes audit row + returns ok + revokedAt', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, person_id, revoked_at FROM portal_sessions WHERE id = \?/, {
            id: 'ps_target', person_id: PERSON_ID, revoked_at: null,
        }, 'first');
        env.DB.__on(/UPDATE portal_sessions SET revoked_at = \?/, { meta: { changes: 1 } }, 'run');

        const res = await revokeSession('ps_target', { reason: 'manual cleanup' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(typeof body.revokedAt).toBe('number');

        const updates = env.DB.__writes().filter((w) => w.sql.includes('UPDATE portal_sessions SET revoked_at'));
        expect(updates).toHaveLength(1);
        expect(updates[0].args[1]).toBe('manual cleanup');
        expect(updates[0].args[2]).toBe('ps_target');

        const audits = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO audit_log'));
        const revokeAudit = audits.find((a) => a.args.some((x) => x === 'portal.session.revoked'));
        expect(revokeAudit).toBeDefined();
    });

    it('uses admin_revoked as default reason when none supplied', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.invite']);
        env.DB.__on(/SELECT id, person_id, revoked_at FROM portal_sessions WHERE id = \?/, {
            id: 'ps_target', person_id: PERSON_ID, revoked_at: null,
        }, 'first');
        env.DB.__on(/UPDATE portal_sessions SET revoked_at = \?/, { meta: { changes: 1 } }, 'run');

        await revokeSession('ps_target', {});
        const updates = env.DB.__writes().filter((w) => w.sql.includes('UPDATE portal_sessions SET revoked_at'));
        expect(updates[0].args[1]).toBe('admin_revoked');
    });
});
