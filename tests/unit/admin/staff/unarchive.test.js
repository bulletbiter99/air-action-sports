// B7 (2026-07-27) — POST /api/admin/staff/:id/unarchive.
//
// The audit listed "staff archive/unarchive" as built-with-no-UI. Half true:
// /archive shipped in M5, /unarchive never existed at all. That was tolerable
// while nothing in the UI could archive anyone — it becomes unacceptable the
// moment an Archive button exists, because a misclick would be unrecoverable
// without dropping to SQL.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

const PERSON = 'per_1';
let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    ({ cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' }));
    bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.archive']);
});

const post = (path, e = env, cookie = cookieHeader) => worker.fetch(
    new Request(`https://airactionsport.com${path}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
    }), e, {},
);

describe('POST /api/admin/staff/:id/unarchive', () => {
    it('clears the archive columns and returns the person to active', async () => {
        const updates = [];
        env.DB.__on(/UPDATE persons SET archived_at = NULL/, (sql, args) => {
            updates.push({ sql, args });
            return { meta: { changes: 1 } };
        }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, {}, 'run');

        const res = await post(`/api/admin/staff/${PERSON}/unarchive`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        expect(updates).toHaveLength(1);
        expect(updates[0].sql).toMatch(/archived_reason = NULL/);
        expect(updates[0].sql).toMatch(/status = 'active'/);
        // Guarded, so re-running it is a no-op rather than resurrecting
        // someone who was never archived.
        expect(updates[0].sql).toMatch(/archived_at IS NOT NULL/);
    });

    it('audits the restore', async () => {
        env.DB.__on(/UPDATE persons SET archived_at = NULL/, { meta: { changes: 1 } }, 'run');
        const audits = [];
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => { audits.push(args); return {}; }, 'run');

        await post(`/api/admin/staff/${PERSON}/unarchive`);
        expect(audits.some((a) => a.includes('staff.unarchived'))).toBe(true);
    });

    it('404s when the person is not archived — no silent success', async () => {
        env.DB.__on(/UPDATE persons SET archived_at = NULL/, { meta: { changes: 0 } }, 'run');
        const res = await post(`/api/admin/staff/${PERSON}/unarchive`);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatch(/not archived/);
    });

    it('403s without staff.archive — the same capability that gates archiving', async () => {
        const e = createMockEnv();
        const s = await createAdminSession(e, { id: 'u_ro', role: 'owner' });
        bindCapabilities(e.DB, 'u_ro', ['staff.read']);
        const res = await post(`/api/admin/staff/${PERSON}/unarchive`, e, s.cookieHeader);
        expect(res.status).toBe(403);
    });
});
