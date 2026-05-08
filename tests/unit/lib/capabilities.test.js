// M5 Batch 2 — tests for worker/lib/capabilities.js (DB-backed).
//
// Replaces the implicit M4 stub coverage (which was tested via
// tests/unit/admin/bookings/detail-view.test.js). The new lib has its
// own dedicated tests covering listCapabilities + userHasCapability +
// hasCapability + requireCapability.

import { describe, it, expect, vi } from 'vitest';
import {
    listCapabilities,
    userHasCapability,
    hasCapability,
    requireCapability,
    userCapabilities,
    __LEGACY_ROLE_CAPABILITIES,
} from '../../../worker/lib/capabilities.js';
import { createMockD1 } from '../../helpers/mockD1.js';

function envWithDb(db) {
    return { DB: db };
}

describe('hasCapability (sync)', () => {
    it('returns true when user.capabilities array contains the key', () => {
        const user = { id: 'u1', role: 'staff', capabilities: ['staff.read', 'roster.read'] };
        expect(hasCapability(user, 'staff.read')).toBe(true);
        expect(hasCapability(user, 'roster.read')).toBe(true);
        expect(hasCapability(user, 'bookings.refund')).toBe(false);
    });

    it('falls back to legacy role mapping when user.capabilities is undefined', () => {
        // owner gets all 5 booking caps in legacy mapping
        expect(hasCapability({ role: 'owner' }, 'bookings.refund')).toBe(true);
        expect(hasCapability({ role: 'owner' }, 'bookings.read.pii')).toBe(true);

        // manager same
        expect(hasCapability({ role: 'manager' }, 'bookings.email')).toBe(true);

        // staff has none in legacy
        expect(hasCapability({ role: 'staff' }, 'bookings.read.pii')).toBe(false);
    });

    it('returns false for null user / missing capability arg', () => {
        expect(hasCapability(null, 'x')).toBe(false);
        expect(hasCapability(undefined, 'x')).toBe(false);
        expect(hasCapability({ role: 'owner' }, '')).toBe(false);
        expect(hasCapability({ role: 'owner' }, null)).toBe(false);
    });

    it('user.capabilities array empty → returns false even if legacy fallback would match', () => {
        // The empty array is an explicit "this user has no capabilities" signal,
        // distinct from "no array, fall back to legacy".
        const user = { role: 'owner', capabilities: [] };
        expect(hasCapability(user, 'bookings.refund')).toBe(false);
    });
});

describe('userCapabilities (legacy/sync)', () => {
    it('returns the array unchanged when user.capabilities is set', () => {
        const u = { capabilities: ['a', 'b'] };
        expect(userCapabilities(u)).toEqual(['a', 'b']);
    });

    it('returns legacy role caps when user.capabilities is undefined', () => {
        expect(userCapabilities({ role: 'owner' })).toEqual(__LEGACY_ROLE_CAPABILITIES.owner);
        expect(userCapabilities({ role: 'staff' })).toEqual([]);
    });

    it('returns [] for null/undefined user', () => {
        expect(userCapabilities(null)).toEqual([]);
        expect(userCapabilities(undefined)).toEqual([]);
    });
});

describe('listCapabilities (DB-backed)', () => {
    it('reads role_preset_capabilities when users.role_preset_key is set', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1',
            role: 'manager',
            role_preset_key: 'booking_coordinator',
        }, 'first');
        db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, {
            results: [
                { capability_key: 'bookings.read.pii' },
                { capability_key: 'customers.read' },
            ],
        }, 'all');
        db.__on(/FROM user_capability_overrides/, { results: [] }, 'all');

        const caps = await listCapabilities(envWithDb(db), 'u1');
        expect(caps.sort()).toEqual(['bookings.read.pii', 'customers.read']);
    });

    it('falls back to legacy role mapping when role_preset_key is NULL', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1',
            role: 'owner',
            role_preset_key: null,
        }, 'first');
        // role_preset_capabilities returns empty (no preset assigned)
        db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, { results: [] }, 'all');
        db.__on(/FROM user_capability_overrides/, { results: [] }, 'all');

        const caps = await listCapabilities(envWithDb(db), 'u1');
        // Legacy owner mapping: 5 booking caps
        expect(caps).toContain('bookings.read.pii');
        expect(caps).toContain('bookings.refund');
        expect(caps).toContain('bookings.refund.external');
        expect(caps.length).toBe(5);
    });

    it('applies user_capability_overrides on top (granted=1 adds, granted=0 removes)', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1',
            role: 'manager',
            role_preset_key: 'marketing_manager',
        }, 'first');
        db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, {
            results: [
                { capability_key: 'bookings.email' },
                { capability_key: 'bookings.export' },
            ],
        }, 'all');
        db.__on(/FROM user_capability_overrides/, {
            results: [
                { capability_key: 'bookings.refund', granted: 1 },  // add
                { capability_key: 'bookings.export', granted: 0 },  // remove
            ],
        }, 'all');

        const caps = await listCapabilities(envWithDb(db), 'u1');
        expect(caps).toContain('bookings.email');
        expect(caps).toContain('bookings.refund');     // added by override
        expect(caps).not.toContain('bookings.export'); // removed by override
    });

    it('returns [] for unknown userId', async () => {
        const db = createMockD1();
        // matchHandler returns null when no handler; that's the "user not found" case
        const caps = await listCapabilities(envWithDb(db), 'nonexistent');
        expect(caps).toEqual([]);
    });

    it('returns [] when env.DB is missing', async () => {
        expect(await listCapabilities({}, 'u1')).toEqual([]);
        expect(await listCapabilities(null, 'u1')).toEqual([]);
    });

    it('returns [] when userId is missing', async () => {
        expect(await listCapabilities(envWithDb(createMockD1()), null)).toEqual([]);
        expect(await listCapabilities(envWithDb(createMockD1()), '')).toEqual([]);
    });
});

describe('userHasCapability (DB-backed)', () => {
    it('returns true when user holds the capability and no dependency exists', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1', role: 'owner', role_preset_key: 'owner',
        }, 'first');
        db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, {
            results: [{ capability_key: 'bookings.refund' }],
        }, 'all');
        db.__on(/FROM user_capability_overrides/, { results: [] }, 'all');
        db.__on(/FROM capabilities WHERE key = \?/, {
            key: 'bookings.refund',
            requires_capability_key: null,
        }, 'first');

        expect(await userHasCapability(envWithDb(db), 'u1', 'bookings.refund')).toBe(true);
    });

    it('returns false when user does NOT hold the capability', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1', role: 'manager', role_preset_key: 'marketing_manager',
        }, 'first');
        db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, {
            results: [{ capability_key: 'customers.read' }],
        }, 'all');
        db.__on(/FROM user_capability_overrides/, { results: [] }, 'all');

        expect(await userHasCapability(envWithDb(db), 'u1', 'bookings.refund')).toBe(false);
    });

    it('returns false on missing inputs', async () => {
        expect(await userHasCapability(null, 'u1', 'x')).toBe(false);
        expect(await userHasCapability({ DB: createMockD1() }, '', 'x')).toBe(false);
        expect(await userHasCapability({ DB: createMockD1() }, 'u1', '')).toBe(false);
    });
});

describe('requireCapability (Hono middleware factory)', () => {
    it('returns 401 when no user is set on context', async () => {
        const middleware = requireCapability('bookings.refund');
        let response = null;
        const c = {
            get: () => null,
            set: () => {},
            json: (body, status) => { response = { body, status }; return response; },
            env: { DB: createMockD1() },
        };
        const next = vi.fn(async () => {});
        await middleware(c, next);
        expect(response.status).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('lazy-loads capabilities onto user when not pre-populated', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1', role: 'manager', role_preset_key: 'event_director',
        }, 'first');
        db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, {
            results: [{ capability_key: 'bookings.refund' }],
        }, 'all');
        db.__on(/FROM user_capability_overrides/, { results: [] }, 'all');

        const user = { id: 'u1', role: 'manager' };
        const c = {
            get: () => user,
            set: () => {},
            json: (body, status) => ({ body, status }),
            env: envWithDb(db),
        };
        const next = vi.fn(async () => {});
        await requireCapability('bookings.refund')(c, next);
        expect(user.capabilities).toBeDefined();
        expect(user.capabilities).toContain('bookings.refund');
        expect(next).toHaveBeenCalled();
    });

    it('returns 403 with requiresCapability hint when user lacks the cap', async () => {
        const user = { id: 'u1', role: 'staff', capabilities: [] };
        let response = null;
        const c = {
            get: () => user,
            set: () => {},
            json: (body, status) => { response = { body, status }; return response; },
            env: { DB: createMockD1() },
        };
        const next = vi.fn(async () => {});
        await requireCapability('bookings.refund')(c, next);
        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Forbidden');
        expect(response.body.requiresCapability).toBe('bookings.refund');
        expect(next).not.toHaveBeenCalled();
    });

    it('uses cached capabilities array when already pre-loaded', async () => {
        const db = createMockD1();
        // No DB handlers — if the middleware tries to query, it'll get nulls
        // and the test will fail. Asserting the cached path doesn't hit DB.
        const user = { id: 'u1', role: 'manager', capabilities: ['bookings.email'] };
        const c = {
            get: () => user,
            set: () => {},
            json: (body, status) => ({ body, status }),
            env: envWithDb(db),
        };
        const next = vi.fn(async () => {});
        await requireCapability('bookings.email')(c, next);
        expect(next).toHaveBeenCalled();
        // mockD1 records every prepare() call — verify none happened in this path
        expect(db.__writes()).toEqual([]);
    });
});

describe('graceful-degradation: M5 tables missing (e.g., wrangler dev local without 0031)', () => {
    it('falls back to legacy mapping when role_preset_capabilities table query throws', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1', role: 'owner', role_preset_key: 'owner',
        }, 'first');
        // Simulate missing table by registering a handler that throws
        db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, () => {
            throw new Error('no such table: role_preset_capabilities');
        }, 'all');
        db.__on(/FROM user_capability_overrides/, () => {
            throw new Error('no such table: user_capability_overrides');
        }, 'all');

        const caps = await listCapabilities(envWithDb(db), 'u1');
        // Legacy owner caps preserved
        expect(caps).toContain('bookings.refund');
        expect(caps.length).toBe(5);
    });
});
