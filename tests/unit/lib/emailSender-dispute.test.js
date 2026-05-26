// M6 B6 — sendDisputeAlert sender tests.
// Pure additive sender (not in the 9 DNT senders). Verifies template fetch,
// var construction, Resend body, and graceful-skip paths.

import { describe, it, expect } from 'vitest';
import { sendDisputeAlert } from '../../../worker/lib/emailSender.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

function mockTemplate() {
    return {
        id: 'tpl_dispute_received',
        slug: 'dispute_received',
        subject: '⚠ Dispute opened: {{dispute_reason}} ({{amount_display}}) — {{booking_id}}',
        body_html: '<p>{{buyer_name}} disputed {{booking_id}} ({{amount_display}}). Reason: {{dispute_reason}}. Status: {{dispute_status}}. Due: {{evidence_due_by}}.</p>',
        body_text: '{{buyer_name}} disputed {{booking_id}} ({{amount_display}}). Reason: {{dispute_reason}}.',
        variables_json: null,
        status: 'published',
    };
}

function mockBooking(extra = {}) {
    return {
        id: 'bk_disputed_001',
        full_name: 'Sarah Connor',
        email: 'sarah@example.com',
        total_cents: 16000,
        ...extra,
    };
}

function mockDispute(extra = {}) {
    return {
        id: 'du_test_xyz',
        amount: 16000,
        currency: 'usd',
        reason: 'fraudulent',
        status: 'warning_needs_response',
        evidence_details: { due_by: 1701000000 },
        ...extra,
    };
}

describe('sendDisputeAlert — happy path', () => {
    it('sends to ADMIN_NOTIFY_EMAIL with rendered template', async () => {
        const env = createMockEnv();
        mockResendFetch({ id: 'mock-email-1' });
        env.DB.__on(/FROM email_templates WHERE slug/, mockTemplate(), 'first');

        const result = await sendDisputeAlert(env, {
            booking: mockBooking(),
            event: null,
            dispute: mockDispute(),
        });
        expect(result.id).toBe('mock-email-1');

        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        const body = JSON.parse(call[1].body);
        expect(body.to).toEqual(['test@example.com']);  // ADMIN_NOTIFY_EMAIL from mockEnv
        expect(body.subject).toContain('fraudulent');
        expect(body.subject).toContain('$160.00');
        expect(body.subject).toContain('bk_disputed_001');
        expect(body.html).toContain('Sarah Connor');
        expect(body.html).toContain('fraudulent');
        expect(body.tags?.find((t) => t.name === 'type')?.value).toBe('dispute_received');
        expect(body.tags?.find((t) => t.name === 'dispute_id')?.value).toBe('du_test_xyz');
        expect(body.tags?.find((t) => t.name === 'booking_id')?.value).toBe('bk_disputed_001');
    });

    it('formats amount as dollars ($X.XX)', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/FROM email_templates WHERE slug/, mockTemplate(), 'first');

        await sendDisputeAlert(env, {
            booking: mockBooking(),
            event: null,
            dispute: mockDispute({ amount: 2550 }),  // $25.50
        });

        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        const body = JSON.parse(call[1].body);
        expect(body.subject).toContain('$25.50');
    });

    it('renders evidence_due_by as a human date when present', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/FROM email_templates WHERE slug/, {
            ...mockTemplate(),
            body_html: '<p>Due: {{evidence_due_by}}</p>',
        }, 'first');

        await sendDisputeAlert(env, {
            booking: mockBooking(),
            event: null,
            dispute: mockDispute({ evidence_details: { due_by: 1763000000 } }),  // 2025-11-13 UTC
        });

        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        const body = JSON.parse(call[1].body);
        // Denver-timezone rendered date should include year + month
        expect(body.html).toMatch(/\d{4}/);
    });

    it('falls back to "see Stripe dashboard" when evidence_due_by missing', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/FROM email_templates WHERE slug/, {
            ...mockTemplate(),
            body_html: '<p>Due: {{evidence_due_by}}</p>',
        }, 'first');

        await sendDisputeAlert(env, {
            booking: mockBooking(),
            event: null,
            dispute: mockDispute({ evidence_details: {} }),
        });

        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        const body = JSON.parse(call[1].body);
        expect(body.html).toContain('see Stripe dashboard');
    });

    it('includes admin_link pointing to the booking detail page', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/FROM email_templates WHERE slug/, {
            ...mockTemplate(),
            body_html: '<p><a href="{{admin_link}}">view</a></p>',
        }, 'first');

        await sendDisputeAlert(env, {
            booking: mockBooking({ id: 'bk_link_test' }),
            event: null,
            dispute: mockDispute(),
        });

        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        const body = JSON.parse(call[1].body);
        expect(body.html).toContain('/admin/bookings/bk_link_test');
    });
});

describe('sendDisputeAlert — skip paths (no fetch issued)', () => {
    it('returns { skipped: "no_admin_email" } when ADMIN_NOTIFY_EMAIL missing', async () => {
        const env = createMockEnv({ ADMIN_NOTIFY_EMAIL: '' });

        const result = await sendDisputeAlert(env, {
            booking: mockBooking(),
            event: null,
            dispute: mockDispute(),
        });
        expect(result).toEqual({ skipped: 'no_admin_email' });

        const resendCalls = globalThis.fetch.mock?.calls?.filter(([url]) =>
            url === 'https://api.resend.com/emails'
        ) || [];
        expect(resendCalls.length).toBe(0);
    });

    it('returns { skipped: "template_missing" } when template not in DB', async () => {
        const env = createMockEnv();
        // No template handler — first() returns null

        const result = await sendDisputeAlert(env, {
            booking: mockBooking(),
            event: null,
            dispute: mockDispute(),
        });
        expect(result).toEqual({ skipped: 'template_missing' });
    });
});

describe('sendDisputeAlert — defensive var defaults', () => {
    it('handles null booking gracefully (orphan dispute path)', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/FROM email_templates WHERE slug/, mockTemplate(), 'first');

        const result = await sendDisputeAlert(env, {
            booking: null,
            event: null,
            dispute: mockDispute(),
        });
        // Email still fires, with "unknown" for booking fields
        expect(result.id).toBeDefined();
        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        const body = JSON.parse(call[1].body);
        expect(body.html).toContain('unknown');
    });

    it('handles missing dispute reason gracefully', async () => {
        const env = createMockEnv();
        mockResendFetch();
        env.DB.__on(/FROM email_templates WHERE slug/, mockTemplate(), 'first');

        await sendDisputeAlert(env, {
            booking: mockBooking(),
            event: null,
            dispute: mockDispute({ reason: null }),
        });

        const call = globalThis.fetch.mock.calls.find(([url]) =>
            url === 'https://api.resend.com/emails'
        );
        const body = JSON.parse(call[1].body);
        expect(body.subject).toContain('unspecified');
    });
});
