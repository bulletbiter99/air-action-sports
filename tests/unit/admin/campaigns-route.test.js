// Marketing milestone B2 — admin campaigns route tests.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

let env;
let cookieHeader;

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}
function getReq(path) {
    return req(path, { headers: { cookie: cookieHeader } });
}
function jsonReq(path, method, body) {
    return req(path, {
        method,
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}
function delReq(path) {
    return req(path, { method: 'DELETE', headers: { cookie: cookieHeader } });
}

const campaignRow = (overrides = {}) => ({
    id: 'cmp_1',
    name: 'Spring blast',
    subject: 'Come back',
    body_html: '<p>hi</p>',
    body_text: 'hi',
    segment_id: null,
    status: 'draft',
    scheduled_at: null,
    from_name: null,
    recipient_count: 0,
    sent_count: 0,
    failed_count: 0,
    created_by: 'u_owner',
    created_at: 1000,
    updated_at: 2000,
    sent_at: null,
    ...overrides,
});

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/campaigns — list', () => {
    it('returns campaign summaries (no body fields)', async () => {
        env.DB.__on(/FROM campaigns/, { results: [campaignRow()] }, 'all');
        const res = await worker.fetch(getReq('/api/admin/campaigns'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.campaigns).toHaveLength(1);
        expect(data.campaigns[0].id).toBe('cmp_1');
        expect(data.campaigns[0].bodyHtml).toBeUndefined();
    });

    it('filters by status', async () => {
        let captured = '';
        let captBinds = [];
        env.DB.__on(/FROM campaigns/, (sql, args) => { captured = sql; captBinds = args; return { results: [] }; }, 'all');
        await worker.fetch(getReq('/api/admin/campaigns?status=sent'), env, {});
        expect(captured).toMatch(/status = \?/);
        expect(captBinds).toContain('sent');
    });

    it('ignores an unknown status value', async () => {
        let captured = '';
        env.DB.__on(/FROM campaigns/, (sql) => { captured = sql; return { results: [] }; }, 'all');
        await worker.fetch(getReq('/api/admin/campaigns?status=bogus'), env, {});
        expect(captured).not.toMatch(/status = \?/);
    });

    it('returns empty gracefully when the table is unavailable', async () => {
        const res = await worker.fetch(getReq('/api/admin/campaigns'), env, {});
        expect(res.status).toBe(200);
    });
});

describe('GET /api/admin/campaigns/:id — detail', () => {
    it('404 when missing', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, null, 'first');
        const res = await worker.fetch(getReq('/api/admin/campaigns/nope'), env, {});
        expect(res.status).toBe(404);
    });

    it('returns the body on detail', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow(), 'first');
        const res = await worker.fetch(getReq('/api/admin/campaigns/cmp_1'), env, {});
        const data = await res.json();
        expect(data.campaign.bodyHtml).toBe('<p>hi</p>');
    });
});

describe('GET /api/admin/campaigns/:id/stats (B4)', () => {
    it('404 when missing', async () => {
        env.DB.__on(/SELECT id FROM campaigns WHERE id = \?/, null, 'first');
        const res = await worker.fetch(getReq('/api/admin/campaigns/nope/stats'), env, {});
        expect(res.status).toBe(404);
    });

    it('returns engagement counts', async () => {
        env.DB.__on(/SELECT id FROM campaigns WHERE id = \?/, { id: 'cmp_1' }, 'first');
        env.DB.__on(/FROM campaign_recipients WHERE campaign_id = \?/, {
            recipients: 5, sent: 5, failed: 0, delivered: 4, opened: 2, clicked: 1, bounced: 0, complained: 0,
        }, 'first');
        const res = await worker.fetch(getReq('/api/admin/campaigns/cmp_1/stats'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.stats.recipients).toBe(5);
        expect(data.stats.delivered).toBe(4);
        expect(data.stats.clicked).toBe(1);
    });
});

describe('POST /api/admin/campaigns — create', () => {
    it('400 when required fields missing', async () => {
        const res = await worker.fetch(jsonReq('/api/admin/campaigns', 'POST', { name: 'X' }), env, {});
        expect(res.status).toBe(400);
    });

    it('creates a draft + writes audit + 201', async () => {
        env.DB.__on(/INSERT INTO campaigns/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow(), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns', 'POST', {
            name: 'Spring blast', subject: 'Come back', bodyHtml: '<p>hi</p>',
        }), env, {});
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.campaign.id).toMatch(/^cmp_/);
        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('campaign.created'));
        expect(audit).toBeDefined();
    });
});

describe('PUT /api/admin/campaigns/:id — edit', () => {
    it('404 when missing', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/nope', 'PUT', { name: 'X' }), env, {});
        expect(res.status).toBe(404);
    });

    it('409 when not draft/scheduled', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'sent' }), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1', 'PUT', { name: 'X' }), env, {});
        expect(res.status).toBe(409);
    });

    it('400 when no fields provided', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow(), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1', 'PUT', {}), env, {});
        expect(res.status).toBe(400);
    });

    it('updates + writes audit', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow(), 'first');
        env.DB.__on(/UPDATE campaigns SET/, { meta: { changes: 1 } }, 'run');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1', 'PUT', { subject: 'New subject' }), env, {});
        expect(res.status).toBe(200);
        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('campaign.updated'));
        expect(audit).toBeDefined();
    });
});

describe('DELETE /api/admin/campaigns/:id', () => {
    it('409 when sent', async () => {
        env.DB.__on(/SELECT id, status FROM campaigns WHERE id = \?/, { id: 'cmp_1', status: 'sent' }, 'first');
        const res = await worker.fetch(delReq('/api/admin/campaigns/cmp_1'), env, {});
        expect(res.status).toBe(409);
    });

    it('deletes a draft + writes audit', async () => {
        env.DB.__on(/SELECT id, status FROM campaigns WHERE id = \?/, { id: 'cmp_1', status: 'draft' }, 'first');
        env.DB.__on(/DELETE FROM campaigns WHERE id = \?/, { meta: { changes: 1 } }, 'run');
        const res = await worker.fetch(delReq('/api/admin/campaigns/cmp_1'), env, {});
        expect(res.status).toBe(200);
        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('campaign.deleted'));
        expect(audit).toBeDefined();
    });
});

describe('POST /api/admin/campaigns/:id/preview-recipients', () => {
    it('returns count + sample for the whole base (null segment)', async () => {
        env.DB.__on(/SELECT id, segment_id FROM campaigns WHERE id = \?/, { id: 'cmp_1', segment_id: null }, 'first');
        env.DB.__on(/email_marketing = 1 AND archived_at IS NULL/, {
            results: [{ id: 'cus_a', email: 'a@x.com', name: 'Alice' }],
        }, 'all');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/preview-recipients', 'POST', {}), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.count).toBe(1);
        expect(data.sample).toHaveLength(1);
    });
});

describe('POST /api/admin/campaigns/:id/send', () => {
    it('409 when already sent', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'sent' }), 'first');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', {}), env, {});
        expect(res.status).toBe(409);
    });

    it('400 when no recipients resolve', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'draft', segment_id: null }), 'first');
        env.DB.__on(/email_marketing = 1 AND archived_at IS NULL/, { results: [] }, 'all');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', {}), env, {});
        expect(res.status).toBe(400);
    });

    it('send now → enqueues recipients, status sending, audit', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'draft', segment_id: null }), 'first');
        env.DB.__on(/email_marketing = 1 AND archived_at IS NULL/, {
            results: [{ id: 'cus_a', email: 'a@x.com', name: 'Alice' }, { id: 'cus_b', email: 'b@x.com', name: 'Bob' }],
        }, 'all');
        env.DB.__on(/INSERT OR IGNORE INTO campaign_recipients/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE campaigns SET status/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', {}), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.recipientCount).toBe(2);

        const writes = env.DB.__writes();
        const enqueued = writes.filter((w) => /INSERT OR IGNORE INTO campaign_recipients/.test(w.sql));
        expect(enqueued).toHaveLength(2);
        const update = writes.find((w) => /UPDATE campaigns SET status/.test(w.sql));
        expect(update.args).toContain('sending');
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('campaign.send_started'));
        expect(audit).toBeDefined();
    });

    it('future scheduledAt → status scheduled, campaign.scheduled audit', async () => {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'draft', segment_id: null }), 'first');
        env.DB.__on(/email_marketing = 1 AND archived_at IS NULL/, {
            results: [{ id: 'cus_a', email: 'a@x.com', name: 'Alice' }],
        }, 'all');
        env.DB.__on(/INSERT OR IGNORE INTO campaign_recipients/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE campaigns SET status/, { meta: { changes: 1 } }, 'run');

        const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', { scheduledAt: future }), env, {});
        expect(res.status).toBe(200);
        const update = env.DB.__writes().find((w) => /UPDATE campaigns SET status/.test(w.sql));
        expect(update.args).toContain('scheduled');
        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('campaign.scheduled'));
        expect(audit).toBeDefined();
    });
});

describe('POST /api/admin/campaigns/:id/cancel', () => {
    it('409 when already sent', async () => {
        env.DB.__on(/SELECT id, status FROM campaigns WHERE id = \?/, { id: 'cmp_1', status: 'sent' }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/cancel', 'POST', {}), env, {});
        expect(res.status).toBe(409);
    });

    it('cancels a scheduled campaign + drops pending + audit', async () => {
        env.DB.__on(/SELECT id, status FROM campaigns WHERE id = \?/, { id: 'cmp_1', status: 'scheduled' }, 'first');
        env.DB.__on(/UPDATE campaigns SET status/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'canceled' }), 'first');
        env.DB.__on(/DELETE FROM campaign_recipients WHERE campaign_id = \? AND status/, { meta: { changes: 3 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/cancel', 'POST', {}), env, {});
        expect(res.status).toBe(200);
        const writes = env.DB.__writes();
        expect(writes.find((w) => /DELETE FROM campaign_recipients WHERE campaign_id = \? AND status/.test(w.sql))).toBeDefined();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('campaign.canceled'));
        expect(audit).toBeDefined();
    });
});
