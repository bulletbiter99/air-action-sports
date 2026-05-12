// Post-M5.5 wiring fix — unit tests for createPersonForUser.
//
// This helper is called from worker/routes/admin/auth.js inside the
// /setup (first-owner bootstrap) and /accept-invite handlers, so that
// every newly-created admin user automatically gets a corresponding
// persons row + primary role assignment. Without this wire-up, the
// /admin/staff list would diverge from the users list (the bug that
// shipped at M5 close — staff page was empty even though 4 admins
// existed).
//
// The helper is also idempotent: when invoked for a user_id that
// already has a persons row, it returns the existing row without
// inserting again.

import { describe, it, expect, beforeEach } from 'vitest';
import { createPersonForUser } from '../../../worker/routes/admin/personsHelpers.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

let env;

beforeEach(() => {
    env = createMockEnv();
});

describe('createPersonForUser — input guards', () => {
    it('returns null when env is missing', async () => {
        expect(await createPersonForUser(null, { id: 'u1', role: 'owner' })).toBe(null);
    });

    it('returns null when env.DB is missing', async () => {
        expect(await createPersonForUser({}, { id: 'u1', role: 'owner' })).toBe(null);
    });

    it('returns null when user is missing', async () => {
        expect(await createPersonForUser(env, null)).toBe(null);
    });

    it('returns null when user.id is missing', async () => {
        expect(await createPersonForUser(env, { role: 'owner' })).toBe(null);
    });
});

describe('createPersonForUser — idempotency', () => {
    it('returns existing person without inserting when user_id already has one', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, { id: 'prs_existing' }, 'first');

        const result = await createPersonForUser(env, {
            id: 'u_alpha', role: 'owner', email: 'a@b.com', display_name: 'Alpha',
        });

        expect(result).toEqual({ person_id: 'prs_existing', role_id: null, alreadyExists: true });

        const inserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO persons'));
        expect(inserts).toHaveLength(0);
    });

    it('proceeds to insert when no persons row exists for the user_id', async () => {
        // existing-row lookup returns null → falls through to INSERT path
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');

        const result = await createPersonForUser(env, {
            id: 'u_new', role: 'owner', email: 'new@aas.com', display_name: 'New Admin',
        });

        expect(result).not.toBeNull();
        expect(result.alreadyExists).toBe(false);
        expect(result.person_id).toMatch(/^prs_[0-9A-Za-z]{12}$/);
        expect(result.role_id).toBe('role_event_director');

        const personInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO persons'));
        expect(personInserts).toHaveLength(1);
        expect(personInserts[0].args[0]).toBe(result.person_id);
        expect(personInserts[0].args[1]).toBe('u_new');
        expect(personInserts[0].args[2]).toBe('New Admin');
        expect(personInserts[0].args[3]).toBe('new@aas.com');
    });
});

describe('createPersonForUser — role assignment by legacy role', () => {
    it('maps owner → role_event_director', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        const r = await createPersonForUser(env, { id: 'u1', role: 'owner', email: 'o@x.com', display_name: 'Owner' });
        expect(r.role_id).toBe('role_event_director');

        const roleInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO person_roles'));
        expect(roleInserts).toHaveLength(1);
        expect(roleInserts[0].args[2]).toBe('role_event_director');
    });

    it('maps manager → role_booking_coordinator', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        const r = await createPersonForUser(env, { id: 'u2', role: 'manager', email: 'm@x.com', display_name: 'Mgr' });
        expect(r.role_id).toBe('role_booking_coordinator');
    });

    it('maps staff → role_check_in_staff', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        const r = await createPersonForUser(env, { id: 'u3', role: 'staff', email: 's@x.com', display_name: 'Staff' });
        expect(r.role_id).toBe('role_check_in_staff');
    });

    it('skips role assignment when legacy role is unknown but still creates person', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        const r = await createPersonForUser(env, { id: 'u4', role: 'super_admin', email: 'x@x.com', display_name: 'X' });
        expect(r.role_id).toBe(null);

        const personInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO persons'));
        expect(personInserts).toHaveLength(1);
        const roleInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO person_roles'));
        expect(roleInserts).toHaveLength(0);
    });
});

describe('createPersonForUser — full_name fallback', () => {
    it('uses display_name when present', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        await createPersonForUser(env, { id: 'u1', role: 'owner', email: 'a@b.com', display_name: 'Display Name' });

        const personInsert = env.DB.__writes().find((w) => w.sql.includes('INSERT INTO persons'));
        expect(personInsert.args[2]).toBe('Display Name');
    });

    it('falls back to email when display_name is empty', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        await createPersonForUser(env, { id: 'u1', role: 'owner', email: 'fallback@aas.com', display_name: '' });

        const personInsert = env.DB.__writes().find((w) => w.sql.includes('INSERT INTO persons'));
        expect(personInsert.args[2]).toBe('fallback@aas.com');
    });

    it('falls back to user.id when both display_name and email are empty', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        await createPersonForUser(env, { id: 'u_naked', role: 'owner', email: '', display_name: '' });

        const personInsert = env.DB.__writes().find((w) => w.sql.includes('INSERT INTO persons'));
        expect(personInsert.args[2]).toBe('u_naked');
    });
});

describe('createPersonForUser — audit log emission', () => {
    it('emits person.created_via_invite audit row on net-new create', async () => {
        env.DB.__on(/SELECT id FROM persons WHERE user_id = \?/, null, 'first');
        await createPersonForUser(env, {
            id: 'u_audit', role: 'owner', email: 'aud@aas.com', display_name: 'Aud',
        }, { actorUserId: 'u_inviter' });

        const auditInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO audit_log'));
        expect(auditInserts).toHaveLength(1);
        // 6-col writeAudit shape: user_id, action, target_type, target_id, meta_json, created_at
        expect(auditInserts[0].args[0]).toBe('u_inviter');        // userId
        expect(auditInserts[0].args[1]).toBe('person.created_via_invite');
        expect(auditInserts[0].args[2]).toBe('person');
        // args[3] is the new person id; args[4] is meta_json
        expect(JSON.parse(auditInserts[0].args[4])).toMatchObject({
            user_id: 'u_audit',
            primary_role: 'role_event_director',
        });
    });
});
