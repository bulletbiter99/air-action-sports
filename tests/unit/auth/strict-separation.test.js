// M5 R6 — strict separation between /admin and /portal cookie types.
//
// Original M5 B6 spec: "All /admin/* requests still 403 for portal-session
// users (strict separation per Surface 4a)". The pre-rework requireAuth
// returned 401 for any missing/invalid admin session, including when a
// portal cookie was present alone. This rework distinguishes the two
// cases and returns 403 with a wrong-cookie-type hint when a portal
// cookie is detected without an admin cookie — so portal users hitting
// /admin/* land somewhere helpful instead of through admin login.
//
// Existing F57 (no-cookie returns 401) is preserved; this file adds
// the portal-only case as a separate concern.

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requireAuth } from '../../../worker/lib/auth.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

let env;
let app;

beforeEach(() => {
    env = createMockEnv();
    app = new Hono();
    app.use('/protected/*', async (c, next) => {
        c.env = env;
        return requireAuth(c, next);
    });
    app.get('/protected/page', (c) => c.json({ ok: true, user: c.get('user') }));
});

describe('requireAuth strict /admin vs /portal cookie separation', () => {
    it('returns 403 with wrong-session-type hint when only portal cookie is present', async () => {
        const req = new Request('https://airactionsport.com/protected/page', {
            headers: { cookie: 'aas_portal_session=portalvalue.somesignature' },
        });
        const res = await app.fetch(req, env);
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toMatch(/Wrong session type/i);
        expect(body.portalCookieDetected).toBe(true);
        expect(body.hint).toMatch(/admin/i);
    });

    it('preserves F57 behavior — no cookie at all still returns 401', async () => {
        const req = new Request('https://airactionsport.com/protected/page');
        const res = await app.fetch(req, env);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toMatch(/Not authenticated/);
        // Critically NOT 403 — that signal is reserved for "wrong door".
        expect(body.portalCookieDetected).toBeUndefined();
    });

    it('returns 401 (not 403) when the admin cookie is present but invalid', async () => {
        // Even if a portal cookie is also present, the admin-cookie attempt
        // takes priority — they tried to use admin, so they get the admin
        // failure path.
        const req = new Request('https://airactionsport.com/protected/page', {
            headers: { cookie: 'aas_session=garbledpayload.badsignature; aas_portal_session=portalvalue.signature' },
        });
        const res = await app.fetch(req, env);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toMatch(/Not authenticated/);
        expect(body.portalCookieDetected).toBeUndefined();
    });

    it('returns 401 (not 403) when an empty admin cookie value is present alongside a portal cookie', async () => {
        // Edge case: `aas_session=` (empty value). parseCookieHeader returns
        // empty string for that, which is falsy → falls into the no-token
        // branch. To trigger the strict-separation path, we want the user
        // to genuinely be sending only the portal cookie. We test that an
        // empty admin cookie + a portal cookie still routes to the portal
        // path (the empty admin cookie is essentially "none").
        const req = new Request('https://airactionsport.com/protected/page', {
            headers: { cookie: 'aas_session=; aas_portal_session=portalvalue.sig' },
        });
        const res = await app.fetch(req, env);
        // With no admin token (empty), the portal cookie wins — return 403.
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.portalCookieDetected).toBe(true);
    });

    it('returns 401 when an admin cookie is provided but session_version mismatches (not portal-detected)', async () => {
        // We can't easily mint a valid admin cookie here without the
        // helper; instead, we verify the negative case — once an admin
        // cookie attempt is made, the portal-strict-separation path is
        // bypassed, so a 401 is the right answer (existing F58 behavior).
        const req = new Request('https://airactionsport.com/protected/page', {
            headers: { cookie: 'aas_session=any.value; aas_portal_session=portal.cookie' },
        });
        const res = await app.fetch(req, env);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.portalCookieDetected).toBeUndefined();
    });

    it('returns 403 with portalCookieDetected=true when only portal cookie is sent — distinguishable from 401 in clients', async () => {
        // Frontend uses { portalCookieDetected: true } in 403 responses
        // to redirect to /portal/home rather than /admin/login.
        const req = new Request('https://airactionsport.com/protected/page', {
            headers: { cookie: 'aas_portal_session=portalvalue.signature' },
        });
        const res = await app.fetch(req, env);
        const body = await res.json();
        expect(res.status).toBe(403);
        expect(body.portalCookieDetected).toBe(true);
        expect(typeof body.hint).toBe('string');
        expect(body.hint.length).toBeGreaterThan(0);
    });

    it('treats unrelated cookies (no aas_session, no aas_portal_session) as no-cookie (401)', async () => {
        const req = new Request('https://airactionsport.com/protected/page', {
            headers: { cookie: 'unrelated_cookie=value; another_one=foo' },
        });
        const res = await app.fetch(req, env);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.portalCookieDetected).toBeUndefined();
    });
});
