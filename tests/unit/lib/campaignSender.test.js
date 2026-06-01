// Marketing milestone B2b — campaign send sweep + email builder tests.

import { describe, it, expect, beforeEach } from 'vitest';
import { runCampaignSendSweep, buildCampaignEmail } from '../../../worker/lib/campaignSender.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

let env;

beforeEach(() => {
    env = createMockEnv();
    env.RESEND_API_KEY = 're_test';
    env.MARKETING_POSTAL_ADDRESS = '123 Range Rd, Hiawatha UT 84545';
    env.PUBLIC_BASE_URL = 'https://airactionsport.com';
});

const sendingCampaign = (o = {}) => ({
    id: 'cmp_1', subject: 'Come back', body_html: '<p>Hello</p>', body_text: null, from_name: null, ...o,
});

describe('buildCampaignEmail', () => {
    it('appends a CAN-SPAM footer (unsubscribe link + postal address) to html + text', () => {
        const mail = buildCampaignEmail(
            { subject: 'S', body_html: '<p>Body</p>', body_text: 'Body' },
            { unsubUrl: 'https://x/api/unsubscribe?c=cus_1&t=tok', postalAddress: '123 Range Rd' },
        );
        expect(mail.subject).toBe('S');
        expect(mail.html).toContain('<p>Body</p>');
        expect(mail.html).toContain('https://x/api/unsubscribe?c=cus_1&t=tok');
        expect(mail.html).toContain('123 Range Rd');
        expect(mail.text).toContain('Body');
        expect(mail.text).toContain('Unsubscribe: https://x/api/unsubscribe?c=cus_1&t=tok');
        expect(mail.text).toContain('123 Range Rd');
    });

    it('derives plain text from html when body_text is null', () => {
        const mail = buildCampaignEmail(
            { subject: 'S', body_html: '<p>Hello <b>world</b></p>', body_text: null },
            { unsubUrl: 'u', postalAddress: 'addr' },
        );
        expect(mail.text).toContain('Hello world');
    });
});

describe('runCampaignSendSweep — safety gate', () => {
    it('no-ops without RESEND_API_KEY', async () => {
        delete env.RESEND_API_KEY;
        const r = await runCampaignSendSweep(env, {});
        expect(r.skipped).toBe('no_resend_key');
        expect(r.sent).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('no-ops without MARKETING_POSTAL_ADDRESS (never send a non-compliant blast)', async () => {
        delete env.MARKETING_POSTAL_ADDRESS;
        const r = await runCampaignSendSweep(env, {});
        expect(r.skipped).toBe('no_postal_address');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe('runCampaignSendSweep — promotion + drain', () => {
    it('promotes due scheduled campaigns to sending', async () => {
        env.DB.__on(/WHERE status = 'scheduled' AND scheduled_at/, { meta: { changes: 2 } }, 'run');
        env.DB.__on(/SELECT \* FROM campaigns WHERE status = 'sending'/, { results: [] }, 'all');
        const r = await runCampaignSendSweep(env, { now: 5000 });
        expect(r.promoted).toBe(2);
        expect(r.campaignsProcessed).toBe(0);
    });

    it('sends pending recipients, records resend id, marks the campaign sent when drained', async () => {
        mockResendFetch({ id: 're_123' });
        env.DB.__on(/SELECT \* FROM campaigns WHERE status = 'sending'/, { results: [sendingCampaign()] }, 'all');
        env.DB.__on(/FROM campaign_recipients WHERE campaign_id = \? AND status = 'pending'/, {
            results: [{ id: 'r1', customer_id: 'cus_1', email: 'a@x.com', name: 'A' }],
        }, 'all');
        env.DB.__on(/COUNT\(\*\) AS n FROM campaign_recipients/, { n: 0 }, 'first');

        const r = await runCampaignSendSweep(env, {});
        expect(r.sent).toBe(1);
        expect(r.failed).toBe(0);

        const calls = globalThis.fetch.mock.calls;
        expect(calls).toHaveLength(1);
        const body = JSON.parse(calls[0][1].body);
        expect(body.html).toContain('Hello');
        expect(body.html).toContain('/api/unsubscribe?c=cus_1');
        expect(body.html).toContain('123 Range Rd');

        const writes = env.DB.__writes();
        expect(writes.find((w) => /UPDATE campaign_recipients SET status = 'sent'/.test(w.sql))).toBeDefined();
        expect(writes.find((w) => /UPDATE campaigns SET status = 'sent', sent_at/.test(w.sql))).toBeDefined();
    });

    it('records a failed recipient when the send throws (and does not mark sent if still pending)', async () => {
        mockResendFetch({ __status: 500 });
        env.DB.__on(/SELECT \* FROM campaigns WHERE status = 'sending'/, { results: [sendingCampaign()] }, 'all');
        env.DB.__on(/FROM campaign_recipients WHERE campaign_id = \? AND status = 'pending'/, {
            results: [{ id: 'r1', customer_id: 'cus_1', email: 'a@x.com', name: 'A' }],
        }, 'all');
        env.DB.__on(/COUNT\(\*\) AS n FROM campaign_recipients/, { n: 1 }, 'first');

        const r = await runCampaignSendSweep(env, {});
        expect(r.failed).toBe(1);
        expect(r.sent).toBe(0);
        const writes = env.DB.__writes();
        expect(writes.find((w) => /UPDATE campaign_recipients SET status = 'failed'/.test(w.sql))).toBeDefined();
        expect(writes.find((w) => /UPDATE campaigns SET status = 'sent', sent_at/.test(w.sql))).toBeUndefined();
    });

    it('respects the per-run send cap', async () => {
        mockResendFetch({ id: 're_1' });
        env.DB.__on(/SELECT \* FROM campaigns WHERE status = 'sending'/, { results: [sendingCampaign()] }, 'all');
        env.DB.__on(/FROM campaign_recipients WHERE campaign_id = \? AND status = 'pending'/, {
            results: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, customer_id: `cus_${i}`, email: `${i}@x.com`, name: null })),
        }, 'all');
        env.DB.__on(/COUNT\(\*\) AS n FROM campaign_recipients/, { n: 3 }, 'first');

        const r = await runCampaignSendSweep(env, { cap: 2 });
        expect(r.sent).toBe(2);
        expect(globalThis.fetch.mock.calls).toHaveLength(2);
    });
});
