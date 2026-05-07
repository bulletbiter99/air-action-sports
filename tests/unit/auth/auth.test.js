// audit Group F #57-#61 — worker/lib/auth.js
//
// requireAuth middleware: validates session cookie, enforces session_version
// match, and sets c.get('user') with the user row.
// requireRole middleware: gates endpoints to specific roles.
//
// Tests use a small Hono app built per-test (rather than worker.fetch on
// admin routes) so the middleware behavior is isolated from any specific
// route handler's logic.
//
// F57: requireAuth returns 401 with no cookie
// F58: requireAuth returns 401 when session_version mismatches the user row
// F59: requireAuth sets c.get('user') with id, email, role
// F60: requireRole('owner') refuses manager (returns 403)
// F61: requireRole('owner', 'manager') accepts both and refuses staff

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireAuth, requireRole, publicUser } from '../../../worker/lib/auth.js';
import { createSession, COOKIE_NAME } from '../../../worker/lib/session.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';

function makeApp() {
    const app = new Hono();
    app.use('/protected/*', requireAuth);
    app.get('/protected/me', (c) => c.json({ user: publicUser(c.get('user')) }));
    app.get('/protected/owner-only', requireRole('owner'), (c) => c.json({ ok: true }));
    app.get('/protected/owner-or-manager', requireRole('owner', 'manager'), (c) => c.json({ ok: true }));
    return app;
}

async function mintCookie(env, { id, role, sv }) {
    const cookieValue = await createSession(id, role, sv, env.SESSION_SECRET);
    return `${COOKIE_NAME}=${cookieValue}`;
}

describe('requireAuth (Group F characterization)', () => {
    it('F57: returns 401 when no cookie is sent', async () => {
        const env = createMockEnv({ SESSION_SECRET: SECRET });
        const app = makeApp();
        const res = await app.fetch(
            new Request('https://x/protected/me'),
            env,
            {},
        );
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json.error).toMatch(/Not authenticated/i);
    });

    it('F58: returns 401 when cookie session_version does not match user row', async () => {
        const env = createMockEnv({ SESSION_SECRET: SECRET });
        // Cookie minted with sv=1; the user row in DB has sv=2 (post-logout-everywhere).
        const cookieHeader = await mintCookie(env, { id: 'u_x', role: 'owner', sv: 1 });
        env.DB.__on(/FROM users WHERE id = \? AND active = 1/, {
            id: 'u_x',
            email: 'x@example.com',
            display_name: 'X',
            role: 'owner',
            active: 1,
            session_version: 2,  // bumped after the cookie was minted
            last_login_at: 0,
            created_at: 0,
        }, 'first');

        const app = makeApp();
        const res = await app.fetch(
            new Request('https://x/protected/me', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json.error).toMatch(/Session expired/i);
    });

    it('F59: sets c.get("user") with id, email, role on a valid session', async () => {
        const env = createMockEnv({ SESSION_SECRET: SECRET });
        const cookieHeader = await mintCookie(env, { id: 'u_x', role: 'manager', sv: 7 });
        env.DB.__on(/FROM users WHERE id = \? AND active = 1/, {
            id: 'u_x',
            email: 'x@example.com',
            display_name: 'X',
            role: 'manager',
            active: 1,
            session_version: 7,
            last_login_at: 1234,
            created_at: 5678,
        }, 'first');

        const app = makeApp();
        const res = await app.fetch(
            new Request('https://x/protected/me', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.user.id).toBe('u_x');
        expect(json.user.email).toBe('x@example.com');
        expect(json.user.role).toBe('manager');
    });
});

describe('requireRole (Group F characterization)', () => {
    it('F60: requireRole("owner") refuses manager (403)', async () => {
        const env = createMockEnv({ SESSION_SECRET: SECRET });
        const cookieHeader = await mintCookie(env, { id: 'u_m', role: 'manager', sv: 1 });
        env.DB.__on(/FROM users WHERE id = \? AND active = 1/, {
            id: 'u_m', email: 'm@x.com', display_name: 'M', role: 'manager',
            active: 1, session_version: 1, last_login_at: 0, created_at: 0,
        }, 'first');

        const app = makeApp();
        const res = await app.fetch(
            new Request('https://x/protected/owner-only', { headers: { cookie: cookieHeader } }),
            env,
            {},
        );
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toMatch(/Forbidden/i);
    });

    it('F61: requireRole("owner", "manager") accepts owner + manager and refuses staff', async () => {
        const app = makeApp();

        // Owner accepted (200)
        {
            const env = createMockEnv({ SESSION_SECRET: SECRET });
            const cookieHeader = await mintCookie(env, { id: 'u_o', role: 'owner', sv: 1 });
            env.DB.__on(/FROM users WHERE id = \? AND active = 1/, {
                id: 'u_o', email: 'o@x.com', display_name: 'O', role: 'owner',
                active: 1, session_version: 1, last_login_at: 0, created_at: 0,
            }, 'first');
            const res = await app.fetch(
                new Request('https://x/protected/owner-or-manager', { headers: { cookie: cookieHeader } }),
                env,
                {},
            );
            expect(res.status).toBe(200);
        }

        // Manager accepted (200)
        {
            const env = createMockEnv({ SESSION_SECRET: SECRET });
            const cookieHeader = await mintCookie(env, { id: 'u_m', role: 'manager', sv: 1 });
            env.DB.__on(/FROM users WHERE id = \? AND active = 1/, {
                id: 'u_m', email: 'm@x.com', display_name: 'M', role: 'manager',
                active: 1, session_version: 1, last_login_at: 0, created_at: 0,
            }, 'first');
            const res = await app.fetch(
                new Request('https://x/protected/owner-or-manager', { headers: { cookie: cookieHeader } }),
                env,
                {},
            );
            expect(res.status).toBe(200);
        }

        // Staff refused (403)
        {
            const env = createMockEnv({ SESSION_SECRET: SECRET });
            const cookieHeader = await mintCookie(env, { id: 'u_s', role: 'staff', sv: 1 });
            env.DB.__on(/FROM users WHERE id = \? AND active = 1/, {
                id: 'u_s', email: 's@x.com', display_name: 'S', role: 'staff',
                active: 1, session_version: 1, last_login_at: 0, created_at: 0,
            }, 'first');
            const res = await app.fetch(
                new Request('https://x/protected/owner-or-manager', { headers: { cookie: cookieHeader } }),
                env,
                {},
            );
            expect(res.status).toBe(403);
        }
    });
});
