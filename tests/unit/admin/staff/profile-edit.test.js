// Post-M5.5 P1 — tests for PUT /api/admin/staff/:id (profile edit).
//
// Endpoint accepts an allow-list of 8 columns: full_name, preferred_name,
// pronouns, email, phone, status, hired_at, separated_at. Gated by
// staff.write. The Profile-tab edit modal added in P1 hits this endpoint.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

async function put(body) {
    return worker.fetch(
        new Request('https://airactionsport.com/api/admin/staff/prs_1', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env, {},
    );
}

describe('PUT /api/admin/staff/:id — capability gating', () => {
    it('returns 403 when caller lacks staff.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);

        const res = await put({ full_name: 'New Name' });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('staff.write');
    });
});

describe('PUT /api/admin/staff/:id — request body handling', () => {
    beforeEach(() => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
    });

    it('returns 400 when body has no fields to update', async () => {
        const res = await put({});
        expect(res.status).toBe(400);
    });

    it('returns 400 when only non-allowed keys are passed', async () => {
        // notes_sensitive belongs to the /notes endpoint, not /:id
        const res = await put({ notes_sensitive: 'whatever', compensation_rate_cents: 5000 });
        expect(res.status).toBe(400);
    });

    it('returns 404 when person does not exist (no rows updated)', async () => {
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 0 } }, 'run');
        const res = await put({ full_name: 'X' });
        expect(res.status).toBe(404);
    });

    it('updates full_name + emits staff.updated audit row', async () => {
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 1 } }, 'run');

        const res = await put({ full_name: 'Updated Name' });
        expect(res.status).toBe(200);

        const updates = env.DB.__writes().filter((w) => w.sql.includes('UPDATE persons SET'));
        expect(updates).toHaveLength(1);
        // bind order ends with id; first bound arg is the new full_name
        expect(updates[0].args[0]).toBe('Updated Name');

        const audits = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO audit_log'));
        const staffUpdated = audits.find((a) => a.args.some((x) => x === 'staff.updated'));
        expect(staffUpdated).toBeDefined();
    });

    it('updates multiple allowed columns in one call', async () => {
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 1 } }, 'run');

        const res = await put({
            full_name: 'Casey Quinn',
            preferred_name: 'CQ',
            pronouns: 'they/them',
            email: 'casey@example.com',
            phone: '5551231234',
            status: 'active',
            hired_at: 1700000000000,
            separated_at: null,
        });
        expect(res.status).toBe(200);

        const update = env.DB.__writes().find((w) => w.sql.includes('UPDATE persons SET'));
        // 8 set columns + updated_at + WHERE id => 10 bind args
        expect(update.args.length).toBeGreaterThanOrEqual(9);
        // First arg should be the first key from the allow-list iteration: full_name
        expect(update.args[0]).toBe('Casey Quinn');
    });

    it('accepts an empty hired_at/separated_at value as null', async () => {
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 1 } }, 'run');

        const res = await put({ separated_at: null });
        expect(res.status).toBe(200);

        const update = env.DB.__writes().find((w) => w.sql.includes('UPDATE persons SET'));
        expect(update.args[0]).toBe(null); // separated_at = null
    });
});
