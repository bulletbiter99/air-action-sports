// M5 R9 — admin event staffing route tests.
// POST /api/admin/event-staffing assigns a person to an event in a role;
// PUT updates RSVP/pay/notes; DELETE removes pending assignments;
// /:id/no-show + /:id/complete are post-event status transitions.

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

describe('GET /api/admin/event-staffing', () => {
    it('returns 400 when neither event_id nor person_id is provided', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.read']);

        const req = new Request('https://airactionsport.com/api/admin/event-staffing', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 403 when caller lacks staff.events.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);

        const req = new Request('https://airactionsport.com/api/admin/event-staffing?event_id=evt_001', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('binds event_id parameter to the SQL query', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.read']);
        env.DB.__on(/FROM event_staffing es/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/event-staffing?event_id=evt_001', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const listQuery = writes.find((w) => /FROM event_staffing es/.test(w.sql));
        expect(listQuery).toBeDefined();
        expect(listQuery.args).toContain('evt_001');
    });
});

describe('POST /api/admin/event-staffing', () => {
    it('returns 400 when required fields missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.assign']);

        const req = new Request('https://airactionsport.com/api/admin/event-staffing', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: 'evt_001' }), // missing personId + roleId
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 403 when caller lacks staff.events.assign', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.read']);

        const req = new Request('https://airactionsport.com/api/admin/event-staffing', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: 'evt_001', personId: 'prs_1', roleId: 'role_field_marshal' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('happy path: inserts row, returns 201, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.assign']);
        env.DB.__on(/INSERT INTO event_staffing/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/event-staffing', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: 'evt_001', personId: 'prs_1', roleId: 'role_field_marshal',
                payKind: 'volunteer', notes: 'first event',
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toMatch(/^es_/);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'event_staffing.assigned')).toBe(true);
    });

    it('returns 409 when the (event, person, role) tuple is already assigned', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.assign']);
        env.DB.__on(/INSERT INTO event_staffing/, () => {
            throw new Error('UNIQUE constraint failed');
        }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/event-staffing', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: 'evt_001', personId: 'prs_1', roleId: 'role_field_marshal' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toMatch(/Already assigned/i);
    });
});

describe('POST /api/admin/event-staffing/:id/no-show', () => {
    it('returns 403 when caller lacks staff.events.mark_no_show', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.assign']);

        const req = new Request('https://airactionsport.com/api/admin/event-staffing/es_001/no-show', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
    });

    it('returns 404 when the row was not in pending/confirmed state', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.mark_no_show']);
        env.DB.__on(/UPDATE event_staffing SET status = 'no_show'/, { meta: { changes: 0 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/event-staffing/es_001/no-show', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('happy path: flips status, audit-logs', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.mark_no_show']);
        env.DB.__on(/UPDATE event_staffing SET status = 'no_show'/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/event-staffing/es_001/no-show', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'event_staffing.no_show')).toBe(true);
    });
});

describe('DELETE /api/admin/event-staffing/:id', () => {
    it('returns 404 when the row is not in pending state', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.assign']);
        env.DB.__on(/DELETE FROM event_staffing/, { meta: { changes: 0 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/event-staffing/es_001', {
            method: 'DELETE',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('happy path: deletes pending row, audit-logs removed', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.events.assign']);
        env.DB.__on(/DELETE FROM event_staffing/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/admin/event-staffing/es_001', {
            method: 'DELETE',
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'event_staffing.removed')).toBe(true);
    });
});
