// Waiver-confirmation receipt (2026-06-11) — POST /api/waivers/:qrToken
// queues a sendWaiverConfirmation to the signer via ctx.waitUntil after a
// successful sign. These tests pin:
//   * the happy path (recipient, rendered subject, ticket link, tags),
//   * graceful degradation (missing template / missing event / Resend
//     failure) — the signing response stays 200 and nothing rejects, since
//     the whole queued body is wrapped in its own catch.
// The legacy Group C tests use a no-op waitUntil and register no events /
// email_templates handlers; the queued body's catch is what keeps them green.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';
import { createWaiverFixture, bindWaiverFixture } from '../../helpers/waiverFixture.js';

const EVENT_ROW = {
    id: 'evt_test_1',
    title: 'FOXTROT: Jungle Warfare',
    display_date: '20 June 2026',
    location: 'Kaysville, UT',
};

const TEMPLATE_ROW = {
    id: 'tpl_waiver_confirmation',
    slug: 'waiver_confirmation',
    subject: 'Waiver on file — {{event_name}} ({{event_date}})',
    body_html: '<p>{{player_name}} — signed {{signed_date}}, valid through {{valid_through}}. <a href="{{ticket_link}}">ticket</a></p>',
    body_text: '{{player_name}} {{event_name}} {{ticket_link}}',
    status: 'published',
};

// Captures waitUntil promises so the test can flush the queued send before
// asserting (same shape as webhookFixture.createCapturedCtx).
function capturedCtx() {
    const captured = [];
    return {
        ctx: { waitUntil: (p) => { captured.push(p); }, passThroughOnException: () => {} },
        captured,
        flush: () => Promise.allSettled(captured),
    };
}

async function postWaiverCaptured(env, fixture, ctx) {
    bindWaiverFixture(env.DB, fixture);
    const body = JSON.stringify(fixture.payload);
    const req = new Request(`https://airactionsport.com/api/waivers/${fixture.qrToken}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(new TextEncoder().encode(body).byteLength),
            'CF-Connecting-IP': '203.0.113.1',
            'User-Agent': 'vitest-waiver-fixture/1.0',
        },
        body,
    });
    return worker.fetch(req, env, ctx);
}

describe('POST /api/waivers/:qrToken — confirmation email', () => {
    it('queues exactly one confirmation to the signer with rendered subject, ticket link, and tags', async () => {
        const env = createMockEnv();
        env.DB.__on(/FROM events e JOIN bookings b/, EVENT_ROW, 'first');
        env.DB.__on(/FROM email_templates WHERE slug/, TEMPLATE_ROW, 'first');
        mockResendFetch();

        const { ctx, captured, flush } = capturedCtx();
        const fixture = await createWaiverFixture();
        const res = await postWaiverCaptured(env, fixture, ctx);

        expect(res.status).toBe(200);
        expect(captured).toHaveLength(1);
        await flush();

        const calls = globalThis.fetch.mock.calls;
        expect(calls).toHaveLength(1);
        const payload = JSON.parse(calls[0][1].body);
        expect([].concat(payload.to)).toContain('alice@example.com');
        expect(payload.subject).toBe('Waiver on file — FOXTROT: Jungle Warfare (20 June 2026)');
        expect(payload.html).toContain('Alice Smith');
        expect(payload.html).toContain('/booking/success?token=bk_test_1');
        expect(payload.tags).toContainEqual({ name: 'type', value: 'waiver_confirmation' });
        expect(payload.tags).toContainEqual({ name: 'attendee_id', value: 'at_test_1' });
    });

    it('template missing → sign still succeeds, nothing sent', async () => {
        const env = createMockEnv();
        env.DB.__on(/FROM events e JOIN bookings b/, EVENT_ROW, 'first');
        env.DB.__on(/FROM email_templates WHERE slug/, null, 'first');
        mockResendFetch();

        const { ctx, flush } = capturedCtx();
        const res = await postWaiverCaptured(env, await createWaiverFixture(), ctx);

        expect(res.status).toBe(200);
        await flush();
        expect(globalThis.fetch.mock.calls).toHaveLength(0);
    });

    it('event lookup returns nothing → sign still succeeds, nothing sent', async () => {
        const env = createMockEnv();
        env.DB.__on(/FROM events e JOIN bookings b/, null, 'first');
        env.DB.__on(/FROM email_templates WHERE slug/, TEMPLATE_ROW, 'first');
        mockResendFetch();

        const { ctx, flush } = capturedCtx();
        const res = await postWaiverCaptured(env, await createWaiverFixture(), ctx);

        expect(res.status).toBe(200);
        await flush();
        expect(globalThis.fetch.mock.calls).toHaveLength(0);
    });

    it('Resend failure is swallowed — sign still succeeds, queued promise settles without rejection', async () => {
        const env = createMockEnv();
        env.DB.__on(/FROM events e JOIN bookings b/, EVENT_ROW, 'first');
        env.DB.__on(/FROM email_templates WHERE slug/, TEMPLATE_ROW, 'first');
        mockResendFetch({ __status: 500 });

        const { ctx, captured, flush } = capturedCtx();
        const res = await postWaiverCaptured(env, await createWaiverFixture(), ctx);

        expect(res.status).toBe(200);
        expect(captured).toHaveLength(1);
        const settled = await flush();
        expect(settled[0].status).toBe('fulfilled');
    });
});
