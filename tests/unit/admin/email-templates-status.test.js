// M6 B3 — admin email-templates route gains the `status` field.
// These tests exercise the route end-to-end through worker.fetch
// against a mock D1, covering: status surfaced in formatTemplate,
// ?status= filter on list, PUT accepts/validates status,
// send-test refuses drafts.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

const NOW = 1700000000000;

function row(slug, status = 'published', extra = {}) {
    return {
        id: `tpl_${slug}`,
        slug,
        subject: `Subject for ${slug}`,
        body_html: '<p>Hi {{player_name}}</p>',
        body_text: 'Hi {{player_name}}',
        variables_json: JSON.stringify(['player_name']),
        status,
        updated_by: 'u_owner',
        updated_at: NOW,
        created_at: NOW,
        ...extra,
    };
}

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/email-templates — list with status field
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/email-templates', () => {
    it('returns status field on each template (formatTemplate exposure)', async () => {
        env.DB.__on(/FROM email_templates ORDER BY slug/, {
            results: [row('booking_confirmation', 'published'), row('event_reminder_1hr', 'draft')],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/email-templates', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.templates).toHaveLength(2);
        expect(body.templates[0]).toMatchObject({ slug: 'booking_confirmation', status: 'published' });
        expect(body.templates[1]).toMatchObject({ slug: 'event_reminder_1hr', status: 'draft' });
    });

    it('formatTemplate defaults status to published when row has no column (legacy)', async () => {
        const legacy = row('legacy');
        delete legacy.status;
        env.DB.__on(/FROM email_templates ORDER BY slug/, { results: [legacy] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/email-templates', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.templates[0].status).toBe('published');
    });

    it('filters by ?status=draft when supplied', async () => {
        env.DB.__on(/FROM email_templates WHERE status = \? ORDER BY slug/, {
            results: [row('event_reminder_1hr', 'draft')],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/email-templates?status=draft', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.templates).toHaveLength(1);
        expect(body.templates[0].status).toBe('draft');

        const filtered = env.DB.__writes().find((w) =>
            /WHERE status = \? ORDER BY slug/.test(w.sql)
        );
        expect(filtered).toBeDefined();
        expect(filtered.args).toEqual(['draft']);
    });

    it('falls through to no-filter SQL when ?status= is an unknown value', async () => {
        // normalizeStatus('archived') returns null → no filter applied.
        env.DB.__on(/FROM email_templates ORDER BY slug/, {
            results: [row('booking_confirmation', 'published')],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/email-templates?status=archived', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const filtered = writes.find((w) => /WHERE status = \?/.test(w.sql));
        const unfiltered = writes.find((w) => /FROM email_templates ORDER BY slug ASC$/.test(w.sql));
        expect(filtered).toBeUndefined();
        expect(unfiltered).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/email-templates/:slug — detail with status
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/email-templates/:slug', () => {
    it('returns status on single template', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, row('event_reminder_24h', 'draft'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/event_reminder_24h', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.template.status).toBe('draft');
    });
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/email-templates/:slug — accept + validate status
// ────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/email-templates/:slug', () => {
    it('accepts status=draft and writes UPDATE with status column', async () => {
        const existing = row('booking_confirmation', 'published');
        env.DB.__on(/FROM email_templates WHERE slug = \?/, existing, 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'draft' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const update = env.DB.__writes().find((w) => /UPDATE email_templates SET/.test(w.sql));
        expect(update).toBeDefined();
        expect(update.sql).toContain('status = ?');
        expect(update.args).toContain('draft');
    });

    it('accepts status=published with surrounding whitespace + casing (normalized)', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, row('user_invite', 'draft'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/user_invite', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ status: '  Published  ' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const update = env.DB.__writes().find((w) => /UPDATE email_templates SET/.test(w.sql));
        expect(update.args).toContain('published');
    });

    it('rejects unknown status with 400 and does not UPDATE', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, row('booking_confirmation', 'published'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/status must be one of/);

        const update = env.DB.__writes().find((w) => /UPDATE email_templates SET/.test(w.sql));
        expect(update).toBeUndefined();
    });

    it('audit meta includes status when status field changed', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, row('event_reminder_24h', 'published'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/event_reminder_24h', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'draft', subject: 'Updated subject' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const audit = env.DB.__writes().find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(audit).toBeDefined();
        // meta_json arg should contain status + subject in the fields list
        const metaArg = audit.args.find((a) => typeof a === 'string' && a.includes('"fields"'));
        expect(metaArg).toBeDefined();
        expect(metaArg).toContain('status');
        expect(metaArg).toContain('subject');
    });

    it('still rejects empty subject when paired with a valid status change', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, row('booking_confirmation', 'published'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ subject: '   ', status: 'draft' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/email-templates/:slug/send-test — draft guard
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/email-templates/:slug/send-test', () => {
    it('refuses to send when template status=draft, returns 200 with skipped=template_draft', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, row('booking_confirmation', 'draft'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/send-test', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ to: 'admin@example.com' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: false, skipped: 'template_draft' });

        // No audit row for a skipped draft send.
        const audit = env.DB.__writes().find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args?.some((a) => typeof a === 'string' && a.includes('email_template.test_sent'))
        );
        expect(audit).toBeUndefined();
    });

    it('sends when status=published, audits, and returns success=true', async () => {
        mockResendFetch({ id: 'mock-test-email' });
        env.DB.__on(/FROM email_templates WHERE slug = \?/, row('booking_confirmation', 'published'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/send-test', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ to: 'admin@example.com' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, sentTo: 'admin@example.com' });

        const resendCall = globalThis.fetch.mock.calls.find(
            ([url]) => url === 'https://api.resend.com/emails'
        );
        expect(resendCall).toBeDefined();
    });

    it('sends when status is legacy null (pre-M6 B3 row)', async () => {
        mockResendFetch({ id: 'mock-test-email' });
        const legacy = row('legacy_template', 'published');
        delete legacy.status;
        env.DB.__on(/FROM email_templates WHERE slug = \?/, legacy, 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/legacy_template/send-test', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ to: 'admin@example.com' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
    });

    it('returns 404 when template missing (independent of status)', async () => {
        // No handler registered — returns null.
        const req = new Request('https://airactionsport.com/api/admin/email-templates/does_not_exist/send-test', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ to: 'admin@example.com' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });
});
