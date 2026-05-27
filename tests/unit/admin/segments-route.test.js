// Marketing B1 — admin segments route tests.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

let env;
let cookieHeader;

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

function jsonReq(path, method, body, init = {}) {
    return req(path, {
        method,
        headers: { cookie: cookieHeader, 'content-type': 'application/json', ...(init.headers || {}) },
        body: JSON.stringify(body),
    });
}

const sampleSegmentRow = (overrides = {}) => ({
    id: 'seg_test1',
    name: 'VIP locals',
    type: 'customer_segment',
    query_json: JSON.stringify({ v: 1, tags: { any: ['vip'] } }),
    owner_id: 'u_owner',
    shared: 0,
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
});

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/segments — list', () => {
    it('returns segments owned by viewer or shared', async () => {
        env.DB.__on(/FROM segments WHERE/, {
            results: [sampleSegmentRow()],
        }, 'all');

        const res = await worker.fetch(req('/api/admin/segments', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.segments).toHaveLength(1);
        expect(data.segments[0].id).toBe('seg_test1');
        expect(data.segments[0].querySummary).toMatch(/tags/);
    });

    it('owner=me filter scopes to viewer only', async () => {
        let capturedSql = '';
        env.DB.__on(/FROM segments WHERE/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/segments?owner=me', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/owner_id = \?/);
        // The 'all' path uses OR shared=1; 'me' path is owner-only
        expect(capturedSql).not.toMatch(/OR shared = 1/);
    });

    it('returns empty list gracefully when segments table missing', async () => {
        // No __on registered for segments query → mockD1 returns its default
        // shape which works for `.all()`. Test passes that the route doesn't 500.
        const res = await worker.fetch(req('/api/admin/segments', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
    });
});

describe('GET /api/admin/segments/:id — detail', () => {
    it('returns 404 when missing', async () => {
        env.DB.__on(/FROM segments WHERE id = \? AND type/, null, 'first');
        const res = await worker.fetch(req('/api/admin/segments/missing', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(404);
    });

    it('returns parsed query JSON on the segment', async () => {
        env.DB.__on(/FROM segments WHERE id = \? AND type/, sampleSegmentRow(), 'first');
        const res = await worker.fetch(req('/api/admin/segments/seg_test1', { headers: { cookie: cookieHeader } }), env, {});
        const data = await res.json();
        expect(data.segment.query.tags.any).toEqual(['vip']);
    });
});

describe('POST /api/admin/segments — create', () => {
    it('returns 400 when name missing', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/segments', 'POST', { query: { v: 1 } }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when query is malformed', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/segments', 'POST', { name: 'X', query: { v: 99 } }), env, {});
        expect(res.status).toBe(400);
    });

    it('creates segment + writes audit + returns 201', async () => {
        env.DB.__on(/INSERT INTO segments/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM segments WHERE id = \?/, sampleSegmentRow(), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/segments', 'POST', {
            name: 'New Segment',
            query: { v: 1, tags: { any: ['vip'] } },
            shared: true,
        }), env, {});
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.segment.id).toMatch(/^seg_/);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('segment.created'));
        expect(audit).toBeDefined();
    });
});

describe('PUT /api/admin/segments/:id — update', () => {
    it('returns 404 when missing', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/segments/missing', 'PUT', { name: 'X' }), env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when target is a saved_view (not customer_segment)', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, { id: 'seg_test1', type: 'saved_view' }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/segments/seg_test1', 'PUT', { name: 'X' }), env, {});
        expect(res.status).toBe(409);
    });

    it('returns 400 when name is empty string', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, { id: 'seg_test1', type: 'customer_segment' }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/segments/seg_test1', 'PUT', { name: '' }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when no fields provided', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, { id: 'seg_test1', type: 'customer_segment' }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/segments/seg_test1', 'PUT', {}), env, {});
        expect(res.status).toBe(400);
    });

    it('updates name + writes audit', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, { id: 'seg_test1', type: 'customer_segment' }, 'first');
        env.DB.__on(/UPDATE segments SET/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM segments WHERE id = \?/, sampleSegmentRow({ name: 'Renamed' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/segments/seg_test1', 'PUT', { name: 'Renamed' }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('segment.updated'));
        expect(audit).toBeDefined();
    });
});

describe('DELETE /api/admin/segments/:id', () => {
    it('returns 404 when missing', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, null, 'first');
        const res = await worker.fetch(req('/api/admin/segments/missing', {
            method: 'DELETE', headers: { cookie: cookieHeader },
        }), env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when target is a saved_view', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, { id: 'seg_test1', type: 'saved_view' }, 'first');
        const res = await worker.fetch(req('/api/admin/segments/seg_test1', {
            method: 'DELETE', headers: { cookie: cookieHeader },
        }), env, {});
        expect(res.status).toBe(409);
    });

    it('deletes + writes audit', async () => {
        env.DB.__on(/SELECT id, type FROM segments WHERE id = \?/, { id: 'seg_test1', type: 'customer_segment' }, 'first');
        env.DB.__on(/DELETE FROM segments WHERE id = \?/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(req('/api/admin/segments/seg_test1', {
            method: 'DELETE', headers: { cookie: cookieHeader },
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('segment.deleted'));
        expect(audit).toBeDefined();
    });
});

describe('POST /api/admin/segments/preview — ad-hoc count', () => {
    it('returns count + sample for valid query', async () => {
        env.DB.__on(/COUNT\(\*\) AS n FROM customers/, { n: 12 }, 'first');
        env.DB.__on(/customers\.id, customers\.email/, { results: [{ id: 'cus_a', email: 'a@x.com', name: 'Alice', lifetime_value_cents: 5000, total_bookings: 1 }] }, 'all');

        const res = await worker.fetch(jsonReq('/api/admin/segments/preview', 'POST', {
            query: { v: 1, tags: { any: ['vip'] } },
        }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.count).toBe(12);
        expect(data.sampleCustomers).toHaveLength(1);
    });

    it('returns 400 on malformed query', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/segments/preview', 'POST', { query: { v: 99 } }), env, {});
        expect(res.status).toBe(400);
    });
});

describe('POST /api/admin/segments/:id/preview — saved spec count', () => {
    it('returns 404 when segment missing', async () => {
        env.DB.__on(/FROM segments WHERE id = \? AND type/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/segments/missing/preview', 'POST', {}), env, {});
        expect(res.status).toBe(404);
    });

    it('runs count against stored spec', async () => {
        env.DB.__on(/FROM segments WHERE id = \? AND type/, sampleSegmentRow(), 'first');
        env.DB.__on(/COUNT\(\*\) AS n FROM customers/, { n: 7 }, 'first');
        env.DB.__on(/customers\.id, customers\.email/, { results: [] }, 'all');

        const res = await worker.fetch(jsonReq('/api/admin/segments/seg_test1/preview', 'POST', {}), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.count).toBe(7);
    });
});
