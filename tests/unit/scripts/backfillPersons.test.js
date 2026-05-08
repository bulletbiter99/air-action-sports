// M5 Batch 3 — tests for scripts/backfill-persons.js (pure helpers).
//
// The CLI portion of the script is excluded from import-time execution
// via the `if (isMain)` guard. Tests import only the pure helpers.

import { describe, it, expect } from 'vitest';
import {
    legacyRoleToPersonRoleId,
    randomId,
    planBackfill,
} from '../../../scripts/backfill-persons.js';

describe('legacyRoleToPersonRoleId', () => {
    it('owner -> role_event_director', () => {
        expect(legacyRoleToPersonRoleId('owner')).toBe('role_event_director');
    });

    it('manager -> role_booking_coordinator', () => {
        expect(legacyRoleToPersonRoleId('manager')).toBe('role_booking_coordinator');
    });

    it('staff -> role_check_in_staff', () => {
        expect(legacyRoleToPersonRoleId('staff')).toBe('role_check_in_staff');
    });

    it('unknown role -> null (caller flags for review)', () => {
        expect(legacyRoleToPersonRoleId('admin_super')).toBe(null);
        expect(legacyRoleToPersonRoleId('')).toBe(null);
        expect(legacyRoleToPersonRoleId(null)).toBe(null);
        expect(legacyRoleToPersonRoleId(undefined)).toBe(null);
    });
});

describe('randomId', () => {
    it('returns a string with the given prefix and a 12-char alphanumeric body', () => {
        const id = randomId('prs');
        expect(id).toMatch(/^prs_[0-9A-Za-z]{12}$/);
    });

    it('produces unique IDs across calls', () => {
        const set = new Set();
        for (let i = 0; i < 1000; i++) set.add(randomId('xyz'));
        expect(set.size).toBe(1000);
    });
});

describe('planBackfill', () => {
    const now = Date.now();
    const usersFixture = [
        { id: 'u_owner_1',   role: 'owner',   email: 'owner@aas.com',   display_name: 'Paul', created_at: now - 1000 },
        { id: 'u_manager_1', role: 'manager', email: 'mgr@aas.com',     display_name: 'Manager One', created_at: now - 500 },
        { id: 'u_staff_1',   role: 'staff',   email: 'staff1@aas.com',  display_name: 'Field Staff', created_at: now - 200 },
        { id: 'u_unknown_1', role: 'super_admin', email: 'super@aas.com', display_name: 'Super', created_at: now - 100 },
    ];

    it('plans creates for users with no existing person + flags unknown roles', () => {
        const plan = planBackfill(usersFixture, []);
        expect(plan.toCreate).toHaveLength(3);
        expect(plan.toSkip).toHaveLength(0);
        expect(plan.toFlag).toHaveLength(1);
        expect(plan.toFlag[0]).toMatchObject({ user_id: 'u_unknown_1', reason: 'unknown_legacy_role', role: 'super_admin' });
    });

    it('plan create rows include person_id, person_role_id, role_id', () => {
        const plan = planBackfill(usersFixture, []);
        const ownerCreate = plan.toCreate.find((c) => c.user_id === 'u_owner_1');
        expect(ownerCreate).toBeDefined();
        expect(ownerCreate.role_id).toBe('role_event_director');
        expect(ownerCreate.person_id).toMatch(/^prs_[0-9A-Za-z]{12}$/);
        expect(ownerCreate.person_role_id).toMatch(/^pr_[0-9A-Za-z]{12}$/);
    });

    it('skips users that already have a persons row', () => {
        const existing = [{ user_id: 'u_owner_1' }];
        const plan = planBackfill(usersFixture, existing);
        expect(plan.toSkip).toHaveLength(1);
        expect(plan.toSkip[0]).toMatchObject({ user_id: 'u_owner_1', reason: 'already_has_person' });
        // 2 normal-role users still create; the unknown role still flags
        expect(plan.toCreate).toHaveLength(2);
        expect(plan.toFlag).toHaveLength(1);
    });

    it('idempotent: re-running with all users already backfilled produces zero creates', () => {
        const existing = usersFixture.map((u) => ({ user_id: u.id }));
        const plan = planBackfill(usersFixture, existing);
        expect(plan.toCreate).toHaveLength(0);
        expect(plan.toSkip).toHaveLength(4);
        expect(plan.toFlag).toHaveLength(0);
    });

    it('full_name falls back to email then to user.id when display_name is empty', () => {
        const users = [
            { id: 'u1', role: 'staff', email: 'a@b.com', display_name: '', created_at: now },
            { id: 'u2', role: 'staff', email: '',         display_name: '', created_at: now },
            { id: 'u3', role: 'staff', display_name: 'Has Name', email: '', created_at: now },
        ];
        const plan = planBackfill(users, []);
        expect(plan.toCreate[0].full_name).toBe('a@b.com');
        expect(plan.toCreate[1].full_name).toBe('u2');
        expect(plan.toCreate[2].full_name).toBe('Has Name');
    });

    it('preserves users.created_at as the persons.created_at when present', () => {
        const users = [
            { id: 'u1', role: 'owner', email: 'o@x.com', display_name: 'O', created_at: 1700000000000 },
        ];
        const plan = planBackfill(users, []);
        expect(plan.toCreate[0].created_at).toBe(1700000000000);
    });

    it('uses Date.now() when users.created_at is missing', () => {
        const users = [
            { id: 'u1', role: 'owner', email: 'o@x.com', display_name: 'O' },
        ];
        const plan = planBackfill(users, []);
        const diff = Math.abs(plan.toCreate[0].created_at - Date.now());
        // Within 1 second of "now"
        expect(diff).toBeLessThan(1000);
    });

    it('handles empty inputs gracefully', () => {
        expect(planBackfill([], [])).toEqual({ toCreate: [], toSkip: [], toFlag: [] });
    });
});

describe('integration: planBackfill against a realistic 4-user fixture', () => {
    it('produces the expected breakdown for the post-M4 production state', () => {
        // M4 closing-state HANDOFF §12: 4 admin user rows on remote, all
        // backfilled by 0028 to persona='owner'. Their underlying users.role
        // is `owner`. The backfill should produce 4 persons rows mapped to
        // role_event_director and 0 flags.
        const users = [
            { id: 'u1', role: 'owner', email: 'paul@aas.com',   display_name: 'Paul Keddington', created_at: 1700000000000 },
            { id: 'u2', role: 'owner', email: 'second@aas.com', display_name: 'Backup Admin',     created_at: 1714000000000 },
            { id: 'u3', role: 'owner', email: 'third@aas.com',  display_name: 'Third Admin',      created_at: 1715000000000 },
            { id: 'u4', role: 'owner', email: 'fourth@aas.com', display_name: 'Fourth Admin',     created_at: 1716000000000 },
        ];
        const plan = planBackfill(users, []);
        expect(plan.toCreate).toHaveLength(4);
        expect(plan.toFlag).toHaveLength(0);
        for (const c of plan.toCreate) {
            expect(c.role_id).toBe('role_event_director');
        }
    });
});
