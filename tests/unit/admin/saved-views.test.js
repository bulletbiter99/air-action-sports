// M4 Batch 2a — admin saved-views route tests.
//
// Covers GET /api/admin/saved-views (list), POST (upsert), PUT /:id (rename),
// DELETE /:id, plus the table-missing graceful handling on GET.
//
// Pattern: M3 customers-route.test.js — adminSession helper for cookie minting,
// mockD1 handler registration for return shapes, worker.fetch() for end-to-end
// dispatch through the Hono app.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

function buildReq(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

describe('GET /api/admin/saved-views', () => {
    it('400 when page query parameter is missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });
        const res = await worker.fetch(
            buildReq('/api/admin/saved-views', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/page/i);
    });

    it('returns calling user\'s views scoped to page_key', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/FROM saved_views\s+WHERE user_id = \? AND page_key = \?/, (sql, args) => {
            expect(args).toEqual(['u_a', 'adminFeedback']);
            return {
                results: [
                    {
                        id: 'sv_1', user_id: 'u_a', page_key: 'adminFeedback', name: 'New only',
                        filter_json: '{"status":["new"]}', sort_json: null,
                        created_at: 1000, updated_at: 1000,
                    },
                    {
                        id: 'sv_2', user_id: 'u_a', page_key: 'adminFeedback', name: 'Resolved this week',
                        filter_json: '{"status":["resolved"]}', sort_json: '{"by":"created_at","dir":"desc"}',
                        created_at: 2000, updated_at: 3000,
                    },
                ],
            };
        }, 'all');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views?page=adminFeedback', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.views).toHaveLength(2);
        expect(json.views[0]).toEqual({
            id: 'sv_1', pageKey: 'adminFeedback', name: 'New only',
            filters: { status: ['new'] }, sort: null,
            createdAt: 1000, updatedAt: 1000,
        });
        expect(json.views[1].sort).toEqual({ by: 'created_at', dir: 'desc' });
    });

    it('returns empty list gracefully when saved_views table is missing (pre-migration)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/FROM saved_views/, () => {
            const err = new Error('D1_ERROR: no such table: saved_views');
            throw err;
        }, 'all');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views?page=adminFeedback', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.views).toEqual([]);
    });

    it('401 when no session cookie', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(
            buildReq('/api/admin/saved-views?page=adminFeedback'),
            env,
            {},
        );
        expect(res.status).toBe(401);
    });
});

describe('POST /api/admin/saved-views', () => {
    it('creates a new view with generated id when no row exists', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/SELECT id FROM saved_views WHERE user_id = \? AND page_key = \? AND name = \?/, null, 'first');
        let insertedBinds = null;
        env.DB.__on(/INSERT INTO saved_views/, (sql, args) => {
            insertedBinds = args;
            return { meta: { changes: 1 } };
        }, 'run');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageKey: 'adminFeedback', name: 'Triage', filters: { status: ['new'] } }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.id).toMatch(/^sv_/);
        expect(json.pageKey).toBe('adminFeedback');
        expect(json.name).toBe('Triage');
        expect(json.filters).toEqual({ status: ['new'] });
        // INSERT binds: id, user_id, page_key, name, filter_json, sort_json, created_at, updated_at
        expect(insertedBinds[1]).toBe('u_a');
        expect(insertedBinds[2]).toBe('adminFeedback');
        expect(insertedBinds[3]).toBe('Triage');
        expect(JSON.parse(insertedBinds[4])).toEqual({ status: ['new'] });
        expect(insertedBinds[5]).toBeNull();
    });

    it('upserts (UPDATE) when (user, page, name) already exists', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(
            /SELECT id FROM saved_views WHERE user_id = \? AND page_key = \? AND name = \?/,
            { id: 'sv_existing', created_at: 1000 },
            'first',
        );
        let updateBinds = null;
        env.DB.__on(/UPDATE saved_views\s+SET filter_json = \?, sort_json = \?, updated_at = \?/, (sql, args) => {
            updateBinds = args;
            return { meta: { changes: 1 } };
        }, 'run');
        // INSERT must NOT be called on the upsert path
        env.DB.__on(/INSERT INTO saved_views/, () => {
            throw new Error('INSERT should not run when row already exists');
        }, 'run');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageKey: 'adminFeedback', name: 'Triage', filters: { status: ['in-progress'] } }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.id).toBe('sv_existing');
        expect(json.filters).toEqual({ status: ['in-progress'] });
        // UPDATE binds: filter_json, sort_json, updated_at, id
        expect(JSON.parse(updateBinds[0])).toEqual({ status: ['in-progress'] });
        expect(updateBinds[3]).toBe('sv_existing');
    });

    it('400 on missing pageKey', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });
        const res = await worker.fetch(
            buildReq('/api/admin/saved-views', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X', filters: {} }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });

    it('400 on missing name', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });
        const res = await worker.fetch(
            buildReq('/api/admin/saved-views', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageKey: 'X', filters: {} }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });

    it('400 on name longer than 80 chars', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });
        const res = await worker.fetch(
            buildReq('/api/admin/saved-views', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageKey: 'X', name: 'a'.repeat(81), filters: {} }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });

    it('400 on invalid JSON body', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });
        const res = await worker.fetch(
            buildReq('/api/admin/saved-views', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: '{not valid',
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });
});

describe('PUT /api/admin/saved-views/:id (rename)', () => {
    it('renames when caller owns the row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/SELECT id, user_id FROM saved_views WHERE id = \?/, { id: 'sv_x', user_id: 'u_a' }, 'first');
        let updateBinds = null;
        env.DB.__on(/UPDATE saved_views SET name = \?, updated_at = \? WHERE id = \?/, (sql, args) => {
            updateBinds = args;
            return { meta: { changes: 1 } };
        }, 'run');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views/sv_x', {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Renamed' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(updateBinds[0]).toBe('Renamed');
        expect(updateBinds[2]).toBe('sv_x');
    });

    it('403 when caller does not own the row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/SELECT id, user_id FROM saved_views WHERE id = \?/, { id: 'sv_x', user_id: 'u_other' }, 'first');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views/sv_x', {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Hijacked' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('404 when the id does not exist', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/SELECT id, user_id FROM saved_views WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views/sv_missing', {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });

    it('400 on missing name', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });
        const res = await worker.fetch(
            buildReq('/api/admin/saved-views/sv_x', {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            }),
            env,
            {},
        );
        expect(res.status).toBe(400);
    });
});

describe('DELETE /api/admin/saved-views/:id', () => {
    it('deletes when caller owns the row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/SELECT id, user_id FROM saved_views WHERE id = \?/, { id: 'sv_x', user_id: 'u_a' }, 'first');
        let deleteBinds = null;
        env.DB.__on(/DELETE FROM saved_views WHERE id = \?/, (sql, args) => {
            deleteBinds = args;
            return { meta: { changes: 1 } };
        }, 'run');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views/sv_x', {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        expect(deleteBinds[0]).toBe('sv_x');
    });

    it('403 when caller does not own the row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/SELECT id, user_id FROM saved_views WHERE id = \?/, { id: 'sv_x', user_id: 'u_other' }, 'first');
        env.DB.__on(/DELETE FROM saved_views/, () => {
            throw new Error('DELETE should not run when caller does not own the row');
        }, 'run');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views/sv_x', {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(403);
    });

    it('404 when the id does not exist', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_a', role: 'staff' });

        env.DB.__on(/SELECT id, user_id FROM saved_views WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            buildReq('/api/admin/saved-views/sv_missing', {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env,
            {},
        );
        expect(res.status).toBe(404);
    });
});
