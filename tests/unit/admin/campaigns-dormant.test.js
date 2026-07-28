// C4 (2026-07-27) — the dormant marketing pipeline must fail loudly, and a
// campaign must never be a one-way trip.
//
// runCampaignSendSweep returns early with skipped:'no_resend_key' /
// 'no_postal_address' when either env var is unset. MARKETING_POSTAL_ADDRESS
// is unset in production today (operator-pending), so before this change:
//
//   send now  → status flips to 'sending'
//   the sweep → never runs, so nothing ever writes 'sent'
//   TRANSITIONS.sending → ['sent'] only, so cancel was rejected
//   DELETE    → accepts draft|canceled only
//
// The campaign was stranded permanently, silently, with no way back.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';
import { canTransition, marketingReadiness } from '../../../worker/lib/campaigns.js';

const POSTAL = '1 Range Rd, Hiawatha UT 84545';

let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    ({ cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' }));
    bindCapabilities(env.DB, 'u_owner', [
        'marketing.read', 'marketing.campaigns.read',
        'marketing.campaigns.write', 'marketing.campaigns.delete',
    ]);
});

const jsonReq = (path, method, body) => new Request(`https://airactionsport.com${path}`, {
    method,
    headers: { cookie: cookieHeader, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

function campaignRow(over = {}) {
    return {
        id: 'cmp_1', name: 'Summer blast', subject: 'Hi', body_html: '<p>x</p>', body_text: 'x',
        status: 'draft', segment_id: null, scheduled_at: null, sent_at: null,
        from_name: null, recipient_count: 0, sent_count: 0, failed_count: 0,
        created_at: 1, updated_at: 1,
        ...over,
    };
}

describe('marketingReadiness', () => {
    it('reports NAMES of what is missing, never values', () => {
        const r = marketingReadiness({ RESEND_API_KEY: 're_secret_abc', MARKETING_POSTAL_ADDRESS: '' });
        expect(r.ready).toBe(false);
        expect(r.missing).toEqual(['MARKETING_POSTAL_ADDRESS']);
        // The response is sent to a browser — no secret may ride along.
        expect(JSON.stringify(r)).not.toContain('re_secret_abc');
    });

    it('is ready only when both are present', () => {
        expect(marketingReadiness({ RESEND_API_KEY: 'k', MARKETING_POSTAL_ADDRESS: POSTAL }).ready).toBe(true);
        expect(marketingReadiness({ MARKETING_POSTAL_ADDRESS: POSTAL }).missing).toEqual(['RESEND_API_KEY']);
        expect(marketingReadiness({}).missing).toEqual(['RESEND_API_KEY', 'MARKETING_POSTAL_ADDRESS']);
        expect(marketingReadiness(undefined).ready).toBe(false);
    });
});

describe('a campaign is never a one-way trip', () => {
    it('allows sending → canceled, so a stranded campaign is recoverable', () => {
        expect(canTransition('sending', 'canceled')).toBe(true);
    });

    it('still allows the normal completion path', () => {
        expect(canTransition('sending', 'sent')).toBe(true);
    });

    it('keeps terminal states terminal', () => {
        expect(canTransition('sent', 'canceled')).toBe(false);
        expect(canTransition('canceled', 'sending')).toBe(false);
    });

    it('cancels a stranded sending campaign end-to-end', async () => {
        // The cancel route reads `SELECT id, status`, not `SELECT *`.
        env.DB.__on(/SELECT id, status FROM campaigns WHERE id = \?/, { id: 'cmp_1', status: 'sending' }, 'first');
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'canceled' }), 'first');
        const updates = [];
        env.DB.__on(/UPDATE campaigns SET status = \?/, (sql, args) => { updates.push(args); return { meta: { changes: 1 } }; }, 'run');
        env.DB.__on(/campaign_recipients/, { meta: { changes: 3 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, {}, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/cancel', 'POST', {}), env, {});
        expect(res.status).toBe(200);
        expect(updates[0][0]).toBe('canceled');
    });
});

describe('POST /:id/send — refuses to strand', () => {
    function bindDraft() {
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'draft' }), 'first');
        env.DB.__on(/email_marketing = 1 AND archived_at IS NULL/, {
            results: [{ id: 'cus_a', email: 'a@x.com', name: 'Alice' }],
        }, 'all');
        env.DB.__on(/INSERT OR IGNORE INTO campaign_recipients/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE campaigns SET status/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, {}, 'run');
    }

    it('409s a send-now while MARKETING_POSTAL_ADDRESS is unset, naming what is missing', async () => {
        bindDraft();               // mockEnv supplies RESEND_API_KEY but no postal address
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', {}), env, {});
        expect(res.status).toBe(409);
        const j = await res.json();
        expect(j.error).toMatch(/not configured/i);
        expect(j.missing).toEqual(['MARKETING_POSTAL_ADDRESS']);
    });

    it('does not touch the campaign when it refuses', async () => {
        const updates = [];
        env.DB.__on(/SELECT \* FROM campaigns WHERE id = \?/, campaignRow({ status: 'draft' }), 'first');
        env.DB.__on(/UPDATE campaigns SET status/, (sql, args) => { updates.push(args); return {}; }, 'run');

        await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', {}), env, {});
        expect(updates).toHaveLength(0);
    });

    it('still allows SCHEDULING while dormant — the env only has to be set by the time it fires', async () => {
        bindDraft();
        const future = Date.now() + 7 * 86400000;
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', { scheduledAt: future }), env, {});
        // A scheduled campaign stays recoverable (scheduled → draft|canceled),
        // so it cannot strand the way an immediate send could.
        expect(res.status).toBe(200);
    });

    it('permits send-now once the address is configured', async () => {
        env.MARKETING_POSTAL_ADDRESS = POSTAL;
        bindDraft();
        const res = await worker.fetch(jsonReq('/api/admin/campaigns/cmp_1/send', 'POST', {}), env, {});
        expect(res.status).toBe(200);
    });
});

describe('GET /api/admin/campaigns — readiness block', () => {
    it('reports the dormant state additively alongside the list', async () => {
        env.DB.__on(/FROM campaigns/, { results: [] }, 'all');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/campaigns', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const j = await res.json();
        expect(Array.isArray(j.campaigns)).toBe(true);   // existing contract intact
        expect(j.sending).toEqual({ ready: false, missing: ['MARKETING_POSTAL_ADDRESS'] });
    });

    it('reports ready when configured', async () => {
        env.MARKETING_POSTAL_ADDRESS = POSTAL;
        env.DB.__on(/FROM campaigns/, { results: [] }, 'all');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/campaigns', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect((await res.json()).sending).toEqual({ ready: true, missing: [] });
    });
});
