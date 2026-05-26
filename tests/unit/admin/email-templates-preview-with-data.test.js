// M6 B4 — admin /preview endpoint accepts ?bookingId= for real-data preview.
// Verifies the route dispatches between sample-vars and real-vars paths
// correctly, surfaces the source flag, and returns appropriate errors for
// missing/invalid IDs.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

const NOW = 1700000000000;

function templateRow(slug, status = 'published') {
    return {
        id: `tpl_${slug}`,
        slug,
        subject: `Hello {{player_name}}`,
        body_html: '<p>Hi {{player_name}} — {{event_name}}</p>',
        body_text: 'Hi {{player_name}}',
        variables_json: JSON.stringify(['player_name', 'event_name']),
        status,
        updated_by: 'u_owner',
        updated_at: NOW,
        created_at: NOW,
    };
}

function bookingRow(extra = {}) {
    return {
        id: 'bk_test_real',
        event_id: 'evt_op_nightfall',
        full_name: 'Sarah Connor',
        email: 'sarah@example.com',
        phone: '+1 555 0199',
        player_count: 4,
        total_cents: 32000,
        ...extra,
    };
}

function eventRow(extra = {}) {
    return {
        id: 'evt_op_nightfall',
        title: 'Operation Nightfall',
        display_date: '9 May 2026',
        location: 'Ghost Town — Hiawatha UT',
        check_in: '6:30 AM – 8:00 AM',
        first_game: '8:30 AM',
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
// Sample-vars path (unchanged behavior)
// ────────────────────────────────────────────────────────────────────

describe('GET /preview — sample vars (no query param)', () => {
    it('returns rendered with source=sample when no entity ID supplied', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, templateRow('booking_confirmation'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/preview', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.source).toBe('sample');
        expect(body.rendered.subject).toContain('Jane Player');
        expect(body.entityId).toBeUndefined();
    });

    it('falls back to sample vars for unsupported slugs (e.g. password_reset) even with query params present', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, templateRow('password_reset'), 'first');

        // Unsupported slug + a junk query param → silent fallthrough to sample.
        const req = new Request('https://airactionsport.com/api/admin/email-templates/password_reset/preview?bookingId=bk_X', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.source).toBe('sample');
    });
});

// ────────────────────────────────────────────────────────────────────
// Real-vars path
// ────────────────────────────────────────────────────────────────────

describe('GET /preview — real vars (?bookingId=)', () => {
    it('returns rendered with source=real + entityId when booking exists', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, templateRow('booking_confirmation'), 'first');
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        env.DB.__on(/FROM events WHERE id = \?/, eventRow(), 'first');
        env.DB.__on(/FROM attendees WHERE booking_id = \?/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/preview?bookingId=bk_test_real', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.source).toBe('real');
        expect(body.entityId).toBe('bk_test_real');
        // Rendered subject should contain the booking's real name (Sarah), not sample (Jane).
        expect(body.rendered.subject).toContain('Sarah Connor');
        expect(body.rendered.subject).not.toContain('Jane Player');
        // Rendered HTML should contain the real event name.
        expect(body.rendered.html).toContain('Operation Nightfall');
    });

    it('admin_notify uses booking entity correctly and surfaces real email/phone', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, {
            ...templateRow('admin_notify'),
            body_html: '<p>{{player_email}} / {{player_phone}}</p>',
        }, 'first');
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        env.DB.__on(/FROM events WHERE id = \?/, eventRow(), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/admin_notify/preview?bookingId=bk_test_real', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.source).toBe('real');
        expect(body.rendered.html).toContain('sarah@example.com');
        expect(body.rendered.html).toContain('+1 555 0199');
    });

    it('event_reminder_24h renders with reminder vars (check_in / first_game)', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, {
            ...templateRow('event_reminder_24h'),
            body_html: '<p>Check-in: {{check_in}}, First game: {{first_game}}</p>',
        }, 'first');
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        env.DB.__on(/FROM events WHERE id = \?/, eventRow(), 'first');
        env.DB.__on(/FROM attendees WHERE booking_id = \?/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/event_reminder_24h/preview?bookingId=bk_test_real', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.source).toBe('real');
        expect(body.rendered.html).toContain('6:30 AM');
        expect(body.rendered.html).toContain('8:30 AM');
    });
});

// ────────────────────────────────────────────────────────────────────
// Error paths
// ────────────────────────────────────────────────────────────────────

describe('GET /preview — errors', () => {
    it('returns 404 with booking_not_found when entity ID does not match', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, templateRow('booking_confirmation'), 'first');
        // No bookings handler — first() returns null

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/preview?bookingId=bk_missing', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('booking_not_found');
        expect(body.source).toBe('real');
    });

    it('returns 404 with event_not_found when booking exists but event is dangling', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, templateRow('booking_confirmation'), 'first');
        env.DB.__on(/FROM bookings WHERE id = \?/, bookingRow(), 'first');
        // No events handler

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/preview?bookingId=bk_test_real', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('event_not_found');
    });

    it('returns 404 when the template itself does not exist (regardless of query param)', async () => {
        // No email_templates handler — first() returns null

        const req = new Request('https://airactionsport.com/api/admin/email-templates/does_not_exist/preview?bookingId=bk_X', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('drops back to sample-vars path when query param is empty string', async () => {
        env.DB.__on(/FROM email_templates WHERE slug = \?/, templateRow('booking_confirmation'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/preview?bookingId=', {
            headers: { cookie: cookieHeader },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.source).toBe('sample');
    });
});

// ────────────────────────────────────────────────────────────────────
// Access control
// ────────────────────────────────────────────────────────────────────

describe('GET /preview — access', () => {
    it('manager+ can preview (existing access posture unchanged by B4)', async () => {
        const mgrEnv = createMockEnv();
        const mgr = await createAdminSession(mgrEnv, { id: 'u_mgr', role: 'manager' });
        mgrEnv.DB.__on(/FROM email_templates WHERE slug = \?/, templateRow('booking_confirmation'), 'first');

        const req = new Request('https://airactionsport.com/api/admin/email-templates/booking_confirmation/preview', {
            headers: { cookie: mgr.cookieHeader },
        });
        const res = await worker.fetch(req, mgrEnv, {});
        expect(res.status).toBe(200);
    });
});
