// Sprint 4 — the persona dropdown's server side (PUT /api/admin/users/:id
// gains `persona`; GET / exposes it).
//
// users.persona has existed since M4 migration 0028 (decision D08: a
// dashboard-layout LENS, decoupled from the role hierarchy that gates
// access) but no UI or API could ever change it — persona was SQL-only.
// The audit's "persona-system decision"; the operator chose to give it a UI.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

let env;

function bindTargetUser(extra = {}) {
    env.DB.__on(/SELECT \* FROM users WHERE id = \?/, {
        id: 'u_target', email: 'target@example.com', display_name: 'Target',
        role: 'manager', persona: null, active: 1,
        created_at: 1, last_login_at: null,
        ...extra,
    }, 'first');
}

async function put(cookieHeader, body) {
    return worker.fetch(
        new Request('https://airactionsport.com/api/admin/users/u_target', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env, {},
    );
}

beforeEach(() => {
    env = createMockEnv();
});

describe('PUT /api/admin/users/:id — persona (Sprint 4)', () => {
    it('403 for a non-owner (the endpoint is owner-gated)', async () => {
        const { cookieHeader } = await createAdminSession(env, { id: 'u_mgr', role: 'manager' });
        bindTargetUser();
        expect((await put(cookieHeader, { persona: 'bookkeeper' })).status).toBe(403);
    });

    it('400 for a value outside the D08 enum', async () => {
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
        bindTargetUser();
        const res = await put(cookieHeader, { persona: 'wizard' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/persona/i);
    });

    it('sets a persona, audits with prev_persona, returns it in the user shape', async () => {
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
        bindTargetUser();
        env.DB.__on(/UPDATE users SET persona = \?/, { meta: { changes: 1 } }, 'run');

        const res = await put(cookieHeader, { persona: 'bookkeeper' });
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE users SET persona = \?/.test(w.sql));
        expect(update).toBeDefined();
        expect(update.args[0]).toBe('bookkeeper');

        const audit = writes.find((w) => w.args?.some?.((a) => a === 'user.updated'));
        expect(audit).toBeDefined();
        const meta = JSON.parse(audit.args.find((a) => typeof a === 'string' && a.startsWith('{')));
        expect(meta.fields).toContain('persona');
        expect(meta.prev_persona).toBeNull();
    });

    it('persona: null clears back to the role-derived default', async () => {
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
        bindTargetUser({ persona: 'bookkeeper' });
        env.DB.__on(/UPDATE users SET persona = \?/, { meta: { changes: 1 } }, 'run');

        const res = await put(cookieHeader, { persona: null });
        expect(res.status).toBe(200);
        const update = env.DB.__writes().find((w) => /UPDATE users SET persona = \?/.test(w.sql));
        expect(update.args[0]).toBeNull();
    });

    it('GET /api/admin/users includes persona in every row', async () => {
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
        env.DB.__on(/SELECT id, email, display_name, role, persona, active/, {
            results: [{
                id: 'u_1', email: 'a@example.com', display_name: 'A',
                role: 'owner', persona: 'marketing', active: 1, created_at: 1, last_login_at: null,
            }],
        }, 'all');

        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/users', {
                headers: { cookie: cookieHeader },
            }),
            env, {},
        );
        expect(res.status).toBe(200);
        const { users } = await res.json();
        expect(users[0].persona).toBe('marketing');
    });
});
