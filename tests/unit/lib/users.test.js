// M5 Batch 2 — tests for worker/lib/users.js (legacy-role to role_preset
// migration helpers).

import { describe, it, expect } from 'vitest';
import {
    legacyRoleToRolePreset,
    migrateUserToRolePreset,
    migrateAllUsersToRolePresets,
} from '../../../worker/lib/users.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('legacyRoleToRolePreset', () => {
    it('owner -> event_director', () => {
        expect(legacyRoleToRolePreset('owner')).toBe('event_director');
    });

    it('manager -> booking_coordinator', () => {
        expect(legacyRoleToRolePreset('manager')).toBe('booking_coordinator');
    });

    it('staff -> staff_legacy', () => {
        expect(legacyRoleToRolePreset('staff')).toBe('staff_legacy');
    });

    it('unknown roles -> staff_legacy (defensive default)', () => {
        expect(legacyRoleToRolePreset('admin_super')).toBe('staff_legacy');
        expect(legacyRoleToRolePreset('')).toBe('staff_legacy');
        expect(legacyRoleToRolePreset(null)).toBe('staff_legacy');
        expect(legacyRoleToRolePreset(undefined)).toBe('staff_legacy');
    });
});

describe('migrateUserToRolePreset', () => {
    it('happy path: owner with no preset migrates to event_director', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1', role: 'owner', role_preset_key: null,
        }, 'first');
        db.__on(/UPDATE users SET role_preset_key/, { meta: { changes: 1 } }, 'run');

        const result = await migrateUserToRolePreset({ DB: db }, 'u1');
        expect(result.migrated).toBe(true);
        expect(result.fromRole).toBe('owner');
        expect(result.toPreset).toBe('event_director');
    });

    it('happy path: manager -> booking_coordinator', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1', role: 'manager', role_preset_key: null,
        }, 'first');
        db.__on(/UPDATE users SET role_preset_key/, { meta: { changes: 1 } }, 'run');

        const result = await migrateUserToRolePreset({ DB: db }, 'u1');
        expect(result.migrated).toBe(true);
        expect(result.toPreset).toBe('booking_coordinator');
    });

    it('idempotent: already-assigned user returns no-op', async () => {
        const db = createMockD1();
        db.__on(/FROM users WHERE id = \?/, {
            id: 'u1', role: 'owner', role_preset_key: 'event_director',
        }, 'first');

        const result = await migrateUserToRolePreset({ DB: db }, 'u1');
        expect(result.migrated).toBe(false);
        expect(result.reason).toBe('already_assigned');
        expect(result.toPreset).toBe('event_director');

        // Verify no UPDATE was issued
        const writes = db.__writes();
        const updateWrites = writes.filter((w) => /UPDATE users/.test(w.sql));
        expect(updateWrites).toEqual([]);
    });

    it('returns user_not_found for unknown userId', async () => {
        const db = createMockD1();
        // Default mockD1 returns null for unmatched first()
        const result = await migrateUserToRolePreset({ DB: db }, 'nonexistent');
        expect(result.migrated).toBe(false);
        expect(result.reason).toBe('user_not_found');
    });

    it('returns invalid_input for missing env or userId', async () => {
        expect((await migrateUserToRolePreset(null, 'u1')).reason).toBe('invalid_input');
        expect((await migrateUserToRolePreset({}, 'u1')).reason).toBe('invalid_input');
        expect((await migrateUserToRolePreset({ DB: createMockD1() }, '')).reason).toBe('invalid_input');
        expect((await migrateUserToRolePreset({ DB: createMockD1() }, null)).reason).toBe('invalid_input');
    });
});

describe('migrateAllUsersToRolePresets', () => {
    it('migrates only users with NULL role_preset_key; counts breakdown', async () => {
        const db = createMockD1();
        db.__on(/SELECT id, role, role_preset_key FROM users/, {
            results: [
                { id: 'u1', role: 'owner',   role_preset_key: null },
                { id: 'u2', role: 'manager', role_preset_key: null },
                { id: 'u3', role: 'staff',   role_preset_key: null },
                { id: 'u4', role: 'manager', role_preset_key: 'event_director' }, // already
            ],
        }, 'all');
        db.__on(/UPDATE users SET role_preset_key/, { meta: { changes: 1 } }, 'run');

        const summary = await migrateAllUsersToRolePresets({ DB: db });
        expect(summary.migrated).toBe(3);
        expect(summary.alreadyAssigned).toBe(1);
        expect(summary.errors).toBe(0);
        expect(summary.breakdown.event_director).toBe(1);
        expect(summary.breakdown.booking_coordinator).toBe(1);
        expect(summary.breakdown.staff_legacy).toBe(1);
    });

    it('returns errors=1 when env.DB is missing', async () => {
        const summary = await migrateAllUsersToRolePresets(null);
        expect(summary.errors).toBe(1);
        expect(summary.migrated).toBe(0);
    });

    it('returns errors=1 when SELECT throws (table missing)', async () => {
        const db = createMockD1();
        db.__on(/SELECT id, role, role_preset_key FROM users/, () => {
            throw new Error('no such table: users');
        }, 'all');

        const summary = await migrateAllUsersToRolePresets({ DB: db });
        expect(summary.errors).toBe(1);
        expect(summary.migrated).toBe(0);
    });

    it('continues past per-user UPDATE errors and counts them', async () => {
        const db = createMockD1();
        db.__on(/SELECT id, role, role_preset_key FROM users/, {
            results: [
                { id: 'u1', role: 'owner',   role_preset_key: null },
                { id: 'u2', role: 'staff',   role_preset_key: null },
            ],
        }, 'all');
        let updateCount = 0;
        db.__on(/UPDATE users SET role_preset_key/, () => {
            updateCount += 1;
            if (updateCount === 1) throw new Error('disk full');
            return { meta: { changes: 1 } };
        }, 'run');

        const summary = await migrateAllUsersToRolePresets({ DB: db });
        expect(summary.migrated).toBe(1);
        expect(summary.errors).toBe(1);
    });
});
