// Route tests for worker/routes/admin/featureFlags.js — drives the
// Hono router through worker.fetch with a real session cookie minted
// via the same code path as the production login flow.
//
// Covers:
//   - GET /  401 without cookie
//   - GET /  200 list shape
//   - PUT /:key/override  401 without cookie
//   - PUT  400 missing `enabled`
//   - PUT  400 non-boolean `enabled`
//   - PUT  404 unknown flag key
//   - PUT  200 success: writes override row + emits audit row

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

const SEEDED_FLAG = {
    key: 'density_compact',
    description: 'Compact-density admin layout',
    state: 'user_opt_in',
    user_opt_in_default: 0,
    role_scope: null,
};

function bindFeatureFlagsTable(env, flagRows = [SEEDED_FLAG]) {
    // listFlags top query (\s+ matches the newline between FROM line and ORDER BY line)
    env.DB.__on(/FROM feature_flags\s+ORDER BY key/, { results: flagRows }, 'all');
    // isEnabled per-row lookup (N+1)
    env.DB.__on(/FROM feature_flags\s+WHERE key/, (sql, args) => {
        return flagRows.find((r) => r.key === args[0]) || null;
    }, 'first');
    // overrides default to no row (default applies)
    env.DB.__on(/FROM feature_flag_user_overrides/, null, 'first');
}

const URL = 'https://airactionsport.com/api/admin/feature-flags';

describe('GET /api/admin/feature-flags', () => {
    it('returns 401 without a session cookie', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(new Request(URL), env, {});
        expect(res.status).toBe(401);
    });

    it('returns 200 with the flag list when authed', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'manager' });
        bindFeatureFlagsTable(env);

        const res = await worker.fetch(
            new Request(URL, { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.flags).toHaveLength(1);
        expect(body.flags[0]).toEqual({
            key: 'density_compact',
            description: 'Compact-density admin layout',
            state: 'user_opt_in',
            enabled: false,
        });
    });
});

describe('PUT /api/admin/feature-flags/:key/override', () => {
    const overrideUrl = `${URL}/density_compact/override`;

    it('returns 401 without a session cookie', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(
            new Request(overrideUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: true }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(401);
    });

    it('returns 400 when body is missing `enabled`', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1' });
        bindFeatureFlagsTable(env);

        const res = await worker.fetch(
            new Request(overrideUrl, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });

    it('returns 400 when `enabled` is not a boolean', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1' });
        bindFeatureFlagsTable(env);

        const res = await worker.fetch(
            new Request(overrideUrl, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: 'true' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });

    it('returns 404 when the flag key is unknown', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1' });
        bindFeatureFlagsTable(env);  // only knows density_compact

        const res = await worker.fetch(
            new Request(`${URL}/nonexistent_flag/override`, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: true }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });

    it('writes the override row + emits a feature_flag.override_set audit row on success', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        bindFeatureFlagsTable(env);

        const res = await worker.fetch(
            new Request(overrideUrl, {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: true }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });

        const writes = env.DB.__writes();

        const overrideWrite = writes.find(
            (w) => w.kind === 'run' && /INSERT OR REPLACE INTO feature_flag_user_overrides/.test(w.sql),
        );
        expect(overrideWrite).toBeTruthy();
        expect(overrideWrite.args[0]).toBe('density_compact');
        expect(overrideWrite.args[1]).toBe('u_actor');
        expect(overrideWrite.args[2]).toBe(1);  // enabled → 1
        expect(typeof overrideWrite.args[3]).toBe('number');  // set_at

        const auditWrite = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO audit_log/.test(w.sql),
        );
        expect(auditWrite).toBeTruthy();
        // 6-col shape: user_id, action, target_type, target_id, meta_json, created_at
        expect(auditWrite.args[0]).toBe('u_actor');
        expect(auditWrite.args[1]).toBe('feature_flag.override_set');
        expect(auditWrite.args[2]).toBe('feature_flag');
        expect(auditWrite.args[3]).toBe('density_compact');
        expect(JSON.parse(auditWrite.args[4])).toEqual({
            flag_key: 'density_compact',
            enabled: true,
        });
    });
});
