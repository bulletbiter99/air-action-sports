// M7 B10 — sendBounceAlert / sendComplaintAlert sender tests.
// Append-only admin-alert senders (not in the pre-existing senders). Verifies
// template fetch, var construction (recipient / customer link / suppression),
// Resend body + tags, and graceful-skip paths. Mirrors emailSender-dispute.test.js.

import { describe, it, expect } from 'vitest';
import { sendBounceAlert, sendComplaintAlert } from '../../../worker/lib/emailSender.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

function bounceTemplate() {
    return {
        id: 'tpl_bounce_alert',
        slug: 'bounce_alert',
        subject: '⚠ Email hard-bounced: {{recipient}}',
        body_html: '<p>{{recipient}} / {{bounce_type}} / {{customer}} / <a href="{{admin_link}}">view</a> / {{suppressed}} / {{resend_email_id}}</p>',
        body_text: '{{recipient}} {{bounce_type}} {{customer}} {{admin_link}} {{suppressed}}',
        variables_json: null,
        status: 'published',
    };
}

function complaintTemplate() {
    return {
        id: 'tpl_complaint_alert',
        slug: 'complaint_alert',
        subject: '⚠ Spam complaint: {{recipient}}',
        body_html: '<p>{{recipient}} / {{customer}} / <a href="{{admin_link}}">view</a> / {{suppressed}}</p>',
        body_text: '{{recipient}} {{customer}} {{admin_link}}',
        variables_json: null,
        status: 'published',
    };
}

function matchedEvent(extra = {}) {
    return { type: 'bounce', bounceType: 'hard', recipient: 'bob@example.com', resendEmailId: 'em_b1', customerId: 'cus_1', suppressed: true, ...extra };
}

const resendBody = () => {
    const call = globalThis.fetch.mock.calls.find(([url]) => url === 'https://api.resend.com/emails');
    return call ? JSON.parse(call[1].body) : null;
};
const resendCallCount = () =>
    (globalThis.fetch.mock?.calls || []).filter(([url]) => url === 'https://api.resend.com/emails').length;

describe('sendBounceAlert', () => {
    it('sends to ADMIN_NOTIFY_EMAIL with rendered template + tags (matched customer)', async () => {
        const env = createMockEnv();
        mockResendFetch({ id: 'mock-1' });
        env.DB.__on(/FROM email_templates WHERE slug/, bounceTemplate(), 'first');

        const result = await sendBounceAlert(env, { emailEvent: matchedEvent() });
        expect(result.id).toBe('mock-1');

        const body = resendBody();
        expect(body.to).toEqual(['test@example.com']); // ADMIN_NOTIFY_EMAIL from mockEnv
        expect(body.subject).toContain('bob@example.com');
        expect(body.html).toContain('hard');
        expect(body.html).toContain('cus_1');
        expect(body.html).toContain('/admin/customers/cus_1');
        expect(body.html).toContain('suppressed (marketing email turned off)');
        expect(body.tags?.find((t) => t.name === 'type')?.value).toBe('bounce_alert');
        expect(body.tags?.find((t) => t.name === 'bounce_type')?.value).toBe('hard');
    });

    it('renders the orphan branch (no matching customer → customers list link)', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/FROM email_templates WHERE slug/, bounceTemplate(), 'first');

        await sendBounceAlert(env, { emailEvent: matchedEvent({ customerId: null, suppressed: false }) });

        const body = resendBody();
        expect(body.html).toContain('no matching customer');
        expect(body.html).toContain('/admin/customers');
        expect(body.html).not.toContain('/admin/customers/'); // no id segment
        expect(body.html).toContain('unchanged');
    });

    it('skips when ADMIN_NOTIFY_EMAIL missing', async () => {
        const env = createMockEnv({ ADMIN_NOTIFY_EMAIL: '' });
        const result = await sendBounceAlert(env, { emailEvent: matchedEvent() });
        expect(result).toEqual({ skipped: 'no_admin_email' });
        expect(resendCallCount()).toBe(0);
    });

    it('skips when the template is missing', async () => {
        const env = createMockEnv();
        const result = await sendBounceAlert(env, { emailEvent: matchedEvent() });
        expect(result).toEqual({ skipped: 'template_missing' });
        expect(resendCallCount()).toBe(0);
    });
});

describe('sendComplaintAlert', () => {
    it('sends to ADMIN_NOTIFY_EMAIL with the complaint template + tag', async () => {
        const env = createMockEnv();
        mockResendFetch({ id: 'mock-2' });
        env.DB.__on(/FROM email_templates WHERE slug/, complaintTemplate(), 'first');

        const result = await sendComplaintAlert(env, {
            emailEvent: { type: 'complaint', bounceType: null, recipient: 'angry@example.com', resendEmailId: 'em_c1', customerId: 'cus_9', suppressed: true },
        });
        expect(result.id).toBe('mock-2');

        const body = resendBody();
        expect(body.to).toEqual(['test@example.com']);
        expect(body.subject).toContain('angry@example.com');
        expect(body.html).toContain('/admin/customers/cus_9');
        expect(body.tags?.find((t) => t.name === 'type')?.value).toBe('complaint_alert');
    });

    it('skips when ADMIN_NOTIFY_EMAIL missing', async () => {
        const env = createMockEnv({ ADMIN_NOTIFY_EMAIL: '' });
        const result = await sendComplaintAlert(env, { emailEvent: { type: 'complaint', recipient: 'x@y.com' } });
        expect(result).toEqual({ skipped: 'no_admin_email' });
        expect(resendCallCount()).toBe(0);
    });

    it('skips when the template is missing', async () => {
        const env = createMockEnv();
        const result = await sendComplaintAlert(env, { emailEvent: { type: 'complaint', recipient: 'x@y.com' } });
        expect(result).toEqual({ skipped: 'template_missing' });
        expect(resendCallCount()).toBe(0);
    });
});
