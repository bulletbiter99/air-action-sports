// Post-M5.5 wiring fix — tests for the create-person endpoint and the
// roles-catalog endpoint that backs the role dropdown in the form.
//
// POST /api/admin/staff (staff.write) — fixes the "+ New Person" button
// that previously routed to a blank page because no POST endpoint or
// frontend form existed.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities, defaultPerson } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

async function post(body) {
    return worker.fetch(
        new Request('https://airactionsport.com/api/admin/staff', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env,
        {},
    );
}

describe('POST /api/admin/staff — capability gating', () => {
    it('returns 403 when caller lacks staff.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);

        const res = await post({ fullName: 'New Person' });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.write');
    });
});

describe('POST /api/admin/staff — validation', () => {
    beforeEach(() => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
    });

    it('returns 400 when fullName is missing', async () => {
        const res = await post({});
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/fullName/i);
    });

    it('returns 400 when fullName is only whitespace', async () => {
        const res = await post({ fullName: '   ' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when fullName exceeds 200 chars', async () => {
        const res = await post({ fullName: 'x'.repeat(201) });
        expect(res.status).toBe(400);
    });

    it('returns 400 when email is malformed', async () => {
        const res = await post({ fullName: 'Test', email: 'not-an-email' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/email/i);
    });

    it('returns 400 when status is not in the allowed enum', async () => {
        const res = await post({ fullName: 'Test', status: 'frozen' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when primaryRoleId does not exist in roles', async () => {
        env.DB.__on(/SELECT id FROM roles WHERE id = \?/, null, 'first');
        const res = await post({ fullName: 'Test', primaryRoleId: 'role_bogus' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/unknown primaryRoleId/i);
    });
});

describe('POST /api/admin/staff — happy paths', () => {
    beforeEach(() => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write', 'staff.read.pii']);
    });

    it('creates a minimal person (just fullName) and returns 201', async () => {
        // The post-insert SELECT * FROM persons WHERE id = ? returns the row we just inserted.
        env.DB.__on(/SELECT \* FROM persons WHERE id = \?/, defaultPerson({
            id: 'prs_minimal', full_name: 'Solo Name', email: null, phone: null, status: 'onboarding',
        }), 'first');

        const res = await post({ fullName: 'Solo Name' });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.person.fullName).toBe('Solo Name');
        expect(body.personRoleId).toBe(null);

        const personInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO persons'));
        expect(personInserts).toHaveLength(1);
        // (id, user_id=NULL, full_name, preferred_name, email, phone, notes, status, created_at, updated_at)
        expect(personInserts[0].args[1]).toBe('Solo Name'); // full_name
        expect(personInserts[0].args[2]).toBe(null);        // preferred_name
        expect(personInserts[0].args[3]).toBe(null);        // email
        expect(personInserts[0].args[6]).toBe('onboarding'); // status

        const roleInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO person_roles'));
        expect(roleInserts).toHaveLength(0);

        const auditInserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO audit_log'));
        expect(auditInserts.some((a) => a.args[1] === 'staff.created')).toBe(true);
    });

    it('creates a full person with primary role and returns 201 + personRoleId', async () => {
        env.DB.__on(/SELECT id FROM roles WHERE id = \?/, { id: 'role_field_marshal' }, 'first');
        env.DB.__on(/SELECT \* FROM persons WHERE id = \?/, defaultPerson({
            id: 'prs_full', full_name: 'Casey Quinn', email: 'casey@example.com', phone: '5551231234',
            preferred_name: 'CQ', status: 'active',
        }), 'first');

        const res = await post({
            fullName: '  Casey Quinn  ', // whitespace tolerance
            preferredName: 'CQ',
            email: 'CASEY@example.com', // case normalization
            phone: '5551231234',
            status: 'active',
            primaryRoleId: 'role_field_marshal',
            notes: 'Joined via field trial',
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.person.fullName).toBe('Casey Quinn');
        expect(body.personRoleId).toMatch(/^pr_[0-9A-Za-z]{12}$/);

        const personInsert = env.DB.__writes().find((w) => w.sql.includes('INSERT INTO persons'));
        expect(personInsert.args[1]).toBe('Casey Quinn');
        expect(personInsert.args[3]).toBe('casey@example.com'); // lower-cased
        expect(personInsert.args[6]).toBe('active');

        const roleInsert = env.DB.__writes().find((w) => w.sql.includes('INSERT INTO person_roles'));
        // SQL hard-codes is_primary=1; bind order is (id, person_id, role_id,
        // effective_from, created_by_user_id, created_at).
        expect(roleInsert.sql).toContain('is_primary');
        expect(roleInsert.sql).toContain('VALUES (?, ?, ?, 1,');
        expect(roleInsert.args[2]).toBe('role_field_marshal');
        expect(roleInsert.args[4]).toBe('u_owner'); // created_by_user_id is the actor
    });
});

describe('GET /api/admin/staff/roles-catalog', () => {
    it('returns 403 without staff.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff/roles-catalog', {
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('returns the role catalog ordered by tier + name', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        env.DB.__on(/SELECT id, key, name, tier FROM roles ORDER BY tier/, {
            results: [
                { id: 'role_event_director', key: 'event_director', name: 'Event Director', tier: 1 },
                { id: 'role_field_marshal',  key: 'field_marshal',  name: 'Field Marshal',  tier: 3 },
            ],
        }, 'all');

        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff/roles-catalog', {
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.roles).toHaveLength(2);
        expect(body.roles[0].id).toBe('role_event_director');
        expect(body.roles[1].tier).toBe(3);
    });
});
