// Tests for worker/lib/auditLog.js writeAudit helper.
// Covers both SQL shapes (6-col admin / 7-col webhook+waiver), null
// handling, meta serialization, and error surfacing.

import { describe, it, expect, vi } from 'vitest';
import { writeAudit } from '../../../worker/lib/auditLog.js';
import { createMockD1 } from '../../helpers/mockD1.js';

function makeEnv(overrides = {}) {
    return { DB: createMockD1(), ...overrides };
}

describe('writeAudit — input validation', () => {
    it('throws when action is missing', async () => {
        const env = makeEnv();
        await expect(
            writeAudit(env, { userId: 'u1', action: '', targetType: 't', targetId: '1', meta: {} }),
        ).rejects.toThrow(/action is required/);
    });

    it('throws when action is not a string', async () => {
        const env = makeEnv();
        await expect(
            writeAudit(env, { userId: 'u1', action: 123, targetType: 't', targetId: '1', meta: {} }),
        ).rejects.toThrow(/action is required/);
    });

    it('throws when env.DB is missing', async () => {
        await expect(
            writeAudit({}, { action: 'foo', userId: null, targetType: null, targetId: null, meta: null }),
        ).rejects.toThrow(/env\.DB is required/);
    });

    it('throws when env is null', async () => {
        await expect(
            writeAudit(null, { action: 'foo' }),
        ).rejects.toThrow(/env\.DB is required/);
    });
});

describe('writeAudit — 6-col shape (admin routes)', () => {
    it('happy path: writes the standard 6-col INSERT with all binds in order', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: 'u_actor',
            action: 'user.invited',
            targetType: 'invitation',
            targetId: 'tok_abc',
            meta: { email: 'a@x.com', role: 'manager' },
        });

        const writes = env.DB.__writes();
        expect(writes).toHaveLength(1);
        expect(writes[0].kind).toBe('run');
        expect(writes[0].sql).toMatch(/INSERT INTO audit_log/);
        expect(writes[0].sql).toMatch(/user_id, action, target_type, target_id, meta_json, created_at/);
        expect(writes[0].sql).not.toMatch(/ip_address/);

        const args = writes[0].args;
        expect(args).toHaveLength(6);
        expect(args[0]).toBe('u_actor');
        expect(args[1]).toBe('user.invited');
        expect(args[2]).toBe('invitation');
        expect(args[3]).toBe('tok_abc');
        expect(args[4]).toBe(JSON.stringify({ email: 'a@x.com', role: 'manager' }));
        expect(typeof args[5]).toBe('number');  // Date.now()
    });

    it('null userId is allowed (system actions)', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: null,
            action: 'cron.swept',
            targetType: 'cron',
            targetId: '*/15 * * * *',
            meta: { duration_ms: 42 },
        });
        expect(env.DB.__writes()[0].args[0]).toBeNull();
    });

    it('omitted userId is treated as null', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            action: 'system.startup',
            targetType: null,
            targetId: null,
            meta: null,
        });
        expect(env.DB.__writes()[0].args[0]).toBeNull();
    });

    it('null targetType and targetId allowed', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: 'u1',
            action: 'login.success',
            targetType: null,
            targetId: null,
            meta: { ip: '203.0.113.1' },
        });
        const args = env.DB.__writes()[0].args;
        expect(args[2]).toBeNull();
        expect(args[3]).toBeNull();
    });

    it('meta=null serializes to SQL NULL', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: 'u1',
            action: 'foo',
            targetType: null,
            targetId: null,
            meta: null,
        });
        expect(env.DB.__writes()[0].args[4]).toBeNull();
    });

    it('meta=undefined serializes to SQL NULL', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: 'u1',
            action: 'foo',
            targetType: null,
            targetId: null,
            // meta omitted → undefined
        });
        expect(env.DB.__writes()[0].args[4]).toBeNull();
    });

    it('meta with nested objects + arrays JSON-serializes correctly', async () => {
        const env = makeEnv();
        const meta = {
            fields: ['role', 'active'],
            prev: { role: 'staff', active: true },
            counts: [1, 2, 3],
        };
        await writeAudit(env, {
            userId: 'u1',
            action: 'user.updated',
            targetType: 'user',
            targetId: 'u2',
            meta,
        });
        expect(env.DB.__writes()[0].args[4]).toBe(JSON.stringify(meta));
        // Round-trip: parse it back and confirm structural equality
        expect(JSON.parse(env.DB.__writes()[0].args[4])).toEqual(meta);
    });

    it('returns { id, changes } from D1 result', async () => {
        const db = createMockD1();
        db.__on(/INSERT INTO audit_log/, () => ({
            meta: { last_row_id: 4242, changes: 1 },
            success: true,
        }), 'run');
        const result = await writeAudit({ DB: db }, {
            userId: 'u1',
            action: 'foo',
            targetType: 't',
            targetId: '1',
            meta: {},
        });
        expect(result).toEqual({ id: 4242, changes: 1 });
    });
});

describe('writeAudit — 7-col shape (webhook + waiver, used in M3+)', () => {
    it('uses 7-col INSERT when ipAddress is provided', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: null,
            action: 'waiver.signed',
            targetType: 'attendee',
            targetId: 'at_1',
            meta: { waiver_id: 'wv_1' },
            ipAddress: '203.0.113.1',
        });

        const writes = env.DB.__writes();
        expect(writes[0].sql).toMatch(/INSERT INTO audit_log/);
        expect(writes[0].sql).toMatch(/ip_address/);
        expect(writes[0].sql).toMatch(/user_id, action, target_type, target_id, meta_json, ip_address, created_at/);

        const args = writes[0].args;
        expect(args).toHaveLength(7);
        expect(args[5]).toBe('203.0.113.1');
        expect(typeof args[6]).toBe('number');  // Date.now()
    });

    it('ipAddress=null still uses 7-col shape (column present, value NULL)', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: null,
            action: 'waiver.signed',
            targetType: 'attendee',
            targetId: 'at_1',
            meta: {},
            ipAddress: null,
        });
        expect(env.DB.__writes()[0].sql).toMatch(/ip_address/);
        expect(env.DB.__writes()[0].args[5]).toBeNull();
    });

    it('ipAddress=undefined uses 6-col shape (no ip_address column)', async () => {
        const env = makeEnv();
        await writeAudit(env, {
            userId: null,
            action: 'foo',
            targetType: null,
            targetId: null,
            meta: {},
            ipAddress: undefined,
        });
        expect(env.DB.__writes()[0].sql).not.toMatch(/ip_address/);
    });
});

describe('writeAudit — error surfacing', () => {
    it('DB failure surfaces as a thrown error', async () => {
        const db = createMockD1();
        db.__on(/INSERT INTO audit_log/, () => {
            throw new Error('D1 unavailable');
        }, 'run');
        await expect(
            writeAudit({ DB: db }, {
                userId: 'u1',
                action: 'foo',
                targetType: 't',
                targetId: '1',
                meta: {},
            }),
        ).rejects.toThrow('D1 unavailable');
    });
});
