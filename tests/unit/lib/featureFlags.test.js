// Tests for worker/lib/featureFlags.js — exhaustive across all 4 states.
// Readiness (table-missing) tests live in
// tests/unit/admin/featureFlags-readiness.test.js.

import { describe, it, expect } from 'vitest';
import {
    isEnabled,
    listFlags,
    setUserOverride,
} from '../../../worker/lib/featureFlags.js';
import { createMockD1 } from '../../helpers/mockD1.js';

function makeEnv() {
    return { DB: createMockD1() };
}

// Note: regex patterns avoid `.*` between clauses because `.` doesn't
// match newlines by default and the lib's SQL spans multiple lines.
// Anchoring on FROM <table>\s+(WHERE|ORDER) cleanly disambiguates.

function seedFlag(db, flag) {
    // Per-flag lookup: ... FROM feature_flags WHERE key = ?
    db.__on(/FROM feature_flags\s+WHERE key/, flag, 'first');
}

function seedFlagList(db, flags) {
    // List query: ... FROM feature_flags ORDER BY key
    db.__on(/FROM feature_flags\s+ORDER BY key/, { results: flags }, 'all');
}

function seedOverride(db, override) {
    // Override lookup: ... FROM feature_flag_user_overrides WHERE flag_key
    db.__on(/FROM feature_flag_user_overrides\s+WHERE flag_key/, override, 'first');
}

const OWNER = { id: 'u_owner', role: 'owner' };
const MANAGER = { id: 'u_mgr', role: 'manager' };
const STAFF = { id: 'u_staff', role: 'staff' };

describe('isEnabled — input validation', () => {
    it('returns false for empty flagKey', async () => {
        const env = makeEnv();
        expect(await isEnabled(env, '', MANAGER)).toBe(false);
    });

    it('returns false when flag does not exist (no row)', async () => {
        const env = makeEnv();
        seedFlag(env.DB, null);
        expect(await isEnabled(env, 'unknown', MANAGER)).toBe(false);
    });
});

describe('isEnabled — state="off"', () => {
    it('returns false regardless of user', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'off' });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(false);
        expect(await isEnabled(env, 'foo', null)).toBe(false);
    });
});

describe('isEnabled — state="on"', () => {
    it('returns true regardless of user', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'on' });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(true);
        expect(await isEnabled(env, 'foo', null)).toBe(true);
    });
});

describe('isEnabled — state="user_opt_in"', () => {
    it('returns user_opt_in_default=0 when no override exists', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'user_opt_in', user_opt_in_default: 0 });
        seedOverride(env.DB, null);
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(false);
    });

    it('returns user_opt_in_default=1 when no override exists', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'user_opt_in', user_opt_in_default: 1 });
        seedOverride(env.DB, null);
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(true);
    });

    it('user override enabled=1 returns true (overrides default=0)', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'user_opt_in', user_opt_in_default: 0 });
        seedOverride(env.DB, { enabled: 1 });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(true);
    });

    it('user override enabled=0 returns false (overrides default=1)', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'user_opt_in', user_opt_in_default: 1 });
        seedOverride(env.DB, { enabled: 0 });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(false);
    });

    it('null user falls back to user_opt_in_default', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'user_opt_in', user_opt_in_default: 1 });
        // No override seeded — but with null user, no lookup happens anyway
        expect(await isEnabled(env, 'foo', null)).toBe(true);
    });

    it('user without id falls back to user_opt_in_default', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'user_opt_in', user_opt_in_default: 0 });
        expect(await isEnabled(env, 'foo', { role: 'manager' })).toBe(false);
    });
});

describe('isEnabled — state="role_scoped"', () => {
    it('returns true when user.role is in role_scope', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'role_scoped', role_scope: 'owner,manager' });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(true);
        expect(await isEnabled(env, 'foo', OWNER)).toBe(true);
    });

    it('returns false when user.role is NOT in role_scope', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'role_scoped', role_scope: 'owner' });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(false);
        expect(await isEnabled(env, 'foo', STAFF)).toBe(false);
    });

    it('returns false when role_scope is empty string', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'role_scoped', role_scope: '' });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(false);
    });

    it('returns false when role_scope is null', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'role_scoped', role_scope: null });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(false);
    });

    it('handles whitespace in comma-separated role_scope', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'role_scoped', role_scope: ' owner , manager , staff ' });
        expect(await isEnabled(env, 'foo', STAFF)).toBe(true);
    });

    it('returns false when user is null (no role to match)', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'role_scoped', role_scope: 'owner' });
        expect(await isEnabled(env, 'foo', null)).toBe(false);
    });

    it('returns false when user has no role property', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'role_scoped', role_scope: 'owner' });
        expect(await isEnabled(env, 'foo', { id: 'u1' })).toBe(false);
    });
});

describe('isEnabled — unknown state (defensive)', () => {
    it('returns false for unrecognized state value (CHECK constraint guards in SQL; this is belt-and-suspenders)', async () => {
        const env = makeEnv();
        seedFlag(env.DB, { key: 'foo', state: 'wat' });
        expect(await isEnabled(env, 'foo', MANAGER)).toBe(false);
    });
});

describe('listFlags', () => {
    it('returns empty array when no flags exist', async () => {
        const env = makeEnv();
        seedFlagList(env.DB, []);
        expect(await listFlags(env, MANAGER)).toEqual([]);
    });

    it('returns each flag with key, description, state, and resolved enabled', async () => {
        const env = makeEnv();
        const flags = [
            { key: 'flag_a', description: 'Flag A', state: 'on', user_opt_in_default: 0, role_scope: null },
            { key: 'flag_b', description: 'Flag B', state: 'off', user_opt_in_default: 0, role_scope: null },
        ];
        seedFlagList(env.DB, flags);
        // Per-flag isEnabled lookup uses the WHERE key = ? query
        env.DB.__on(/WHERE key = /, (sql, args) => {
            return flags.find((f) => f.key === args[0]) || null;
        }, 'first');

        const result = await listFlags(env, MANAGER);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            key: 'flag_a',
            description: 'Flag A',
            state: 'on',
            enabled: true,
        });
        expect(result[1]).toMatchObject({
            key: 'flag_b',
            description: 'Flag B',
            state: 'off',
            enabled: false,
        });
    });

    it('resolves user_opt_in flags via the user override lookup', async () => {
        const env = makeEnv();
        const flags = [
            { key: 'density_compact', description: 'Compact', state: 'user_opt_in', user_opt_in_default: 0, role_scope: null },
        ];
        seedFlagList(env.DB, flags);
        env.DB.__on(/WHERE key = /, (sql, args) => flags.find((f) => f.key === args[0]) || null, 'first');
        // User has override enabled=1
        seedOverride(env.DB, { enabled: 1 });

        const result = await listFlags(env, MANAGER);
        expect(result[0].enabled).toBe(true);
    });
});

describe('setUserOverride', () => {
    it('writes INSERT OR REPLACE with correct binds (enabled=true)', async () => {
        const env = makeEnv();
        await setUserOverride(env, 'density_compact', 'u_mgr', true);

        const writes = env.DB.__writes().filter((w) => w.kind === 'run');
        expect(writes).toHaveLength(1);
        expect(writes[0].sql).toMatch(/INSERT OR REPLACE INTO feature_flag_user_overrides/);
        expect(writes[0].args[0]).toBe('density_compact');
        expect(writes[0].args[1]).toBe('u_mgr');
        expect(writes[0].args[2]).toBe(1);
        expect(typeof writes[0].args[3]).toBe('number');
    });

    it('binds enabled=0 when passed false', async () => {
        const env = makeEnv();
        await setUserOverride(env, 'density_compact', 'u1', false);
        const writes = env.DB.__writes().filter((w) => w.kind === 'run');
        expect(writes[0].args[2]).toBe(0);
    });

    it('binds set_at as Date.now()', async () => {
        const env = makeEnv();
        const before = Date.now();
        await setUserOverride(env, 'density_compact', 'u1', true);
        const after = Date.now();
        const writes = env.DB.__writes().filter((w) => w.kind === 'run');
        const setAt = writes[0].args[3];
        expect(setAt).toBeGreaterThanOrEqual(before);
        expect(setAt).toBeLessThanOrEqual(after);
    });

    it('throws when flagKey is missing', async () => {
        const env = makeEnv();
        await expect(setUserOverride(env, '', 'u1', true)).rejects.toThrow(/flagKey/);
    });

    it('throws when userId is missing', async () => {
        const env = makeEnv();
        await expect(setUserOverride(env, 'foo', '', true)).rejects.toThrow(/userId/);
    });

    it('returns { changes } from D1 result', async () => {
        const db = createMockD1();
        db.__on(/INSERT OR REPLACE/, () => ({ meta: { changes: 1 }, success: true }), 'run');
        const result = await setUserOverride({ DB: db }, 'foo', 'u1', true);
        expect(result).toEqual({ changes: 1 });
    });
});
