// Marketing milestone B5 — admin automations route tests.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';

let env;
let cookieHeader;

function getReq(path) {
    return new Request(`https://airactionsport.com${path}`, { headers: { cookie: cookieHeader } });
}
function jsonReq(path, method, body) {
    return new Request(`https://airactionsport.com${path}`, {
        method, headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}
function delReq(path) {
    return new Request(`https://airactionsport.com${path}`, { method: 'DELETE', headers: { cookie: cookieHeader } });
}

const autoRow = (o = {}) => ({
    id: 'auto_1', name: 'Welcome', trigger_type: 'tag_added', trigger_config: '{"tag":"new"}',
    segment_id: null, subject: 'Welcome', body_html: '<p>hi</p>', body_text: null, from_name: null,
    status: 'paused', last_run_at: null, sent_count: 0, created_by: 'u_owner', created_at: 1, updated_at: 2, ...o,
});

beforeEach(async () => {
    env = createMockEnv();
    const s = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = s.cookieHeader;
    bindCapabilities(env.DB, 'u_owner', ['marketing.read', 'marketing.automations.read', 'marketing.automations.write', 'marketing.automations.delete']);
});

describe('GET /api/admin/automations', () => {
    it('lists summaries (no body)', async () => {
        env.DB.__on(/FROM automations/, { results: [autoRow()] }, 'all');
        const res = await worker.fetch(getReq('/api/admin/automations'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.automations[0].bodyHtml).toBeUndefined();
        expect(data.automations[0].triggerType).toBe('tag_added');
    });

    it('graceful empty when table unavailable', async () => {
        const res = await worker.fetch(getReq('/api/admin/automations'), env, {});
        expect(res.status).toBe(200);
    });
});

describe('POST /api/admin/automations', () => {
    it('400 when trigger missing', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/automations', 'POST', { name: 'X', subject: 'Y', bodyHtml: 'Z' }), env, {});
        expect(res.status).toBe(400);
    });

    it('400 on a bad trigger config', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/automations', 'POST', {
            name: 'X', subject: 'Y', bodyHtml: 'Z', triggerType: 'recurring', triggerConfig: { intervalDays: 0 },
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('creates a paused automation + audit + 201', async () => {
        env.DB.__on(/INSERT INTO automations/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM automations WHERE id = \?/, autoRow(), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/automations', 'POST', {
            name: 'Welcome', subject: 'Welcome', bodyHtml: '<p>hi</p>', triggerType: 'tag_added', triggerConfig: { tag: 'new' },
        }), env, {});
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.automation.id).toMatch(/^auto_/);
        expect(data.automation.status).toBe('paused');
        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('automation.created'));
        expect(audit).toBeDefined();
    });
});

describe('PUT /api/admin/automations/:id', () => {
    it('404 when missing', async () => {
        env.DB.__on(/SELECT id FROM automations WHERE id = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/automations/nope', 'PUT', { name: 'X' }), env, {});
        expect(res.status).toBe(404);
    });

    it('updates + audit', async () => {
        env.DB.__on(/SELECT id FROM automations WHERE id = \?/, { id: 'auto_1' }, 'first');
        env.DB.__on(/UPDATE automations SET/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM automations WHERE id = \?/, autoRow({ subject: 'New' }), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/automations/auto_1', 'PUT', { subject: 'New' }), env, {});
        expect(res.status).toBe(200);
        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('automation.updated'));
        expect(audit).toBeDefined();
    });
});

describe('activate / pause', () => {
    it('activate flips status + audit', async () => {
        env.DB.__on(/SELECT id, status FROM automations WHERE id = \?/, { id: 'auto_1', status: 'paused' }, 'first');
        env.DB.__on(/UPDATE automations SET status/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM automations WHERE id = \?/, autoRow({ status: 'active' }), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/automations/auto_1/activate', 'POST', {}), env, {});
        expect(res.status).toBe(200);
        const writes = env.DB.__writes();
        expect(writes.find((w) => /UPDATE automations SET status/.test(w.sql) && w.args.includes('active'))).toBeDefined();
        expect(writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('automation.activated'))).toBeDefined();
    });

    it('pause 404 when missing', async () => {
        env.DB.__on(/SELECT id, status FROM automations WHERE id = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/automations/nope/pause', 'POST', {}), env, {});
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/admin/automations/:id', () => {
    it('deletes + audit', async () => {
        env.DB.__on(/SELECT id FROM automations WHERE id = \?/, { id: 'auto_1' }, 'first');
        env.DB.__on(/DELETE FROM automations WHERE id = \?/, { meta: { changes: 1 } }, 'run');
        const res = await worker.fetch(delReq('/api/admin/automations/auto_1'), env, {});
        expect(res.status).toBe(200);
        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('automation.deleted'));
        expect(audit).toBeDefined();
    });
});
