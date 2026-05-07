// Mints an admin session cookie + binds the matching user-row lookup in
// mockD1, so tests can drive authenticated admin routes through
// `worker.fetch(req, env, ctx)`.
//
// Usage:
//   const env = createMockEnv();
//   const { cookieHeader, user } = await createAdminSession(env, {
//       id: 'u_owner', role: 'owner',
//   });
//   const req = new Request('https://airactionsport.com/api/admin/foo', {
//       headers: { cookie: cookieHeader },
//   });
//   await worker.fetch(req, env, {});
//
// What the helper does:
//   1. Calls createSession(...) — same code path as the real admin login.
//   2. Builds a "Cookie: aas_session=..." header value.
//   3. Registers a mockD1 handler so requireAuth's user lookup returns
//      a row with active=1 and session_version matching the cookie's sv.

import { createSession, COOKIE_NAME } from '../../worker/lib/session.js';

const SESSION_VERSION = 1;

export async function createAdminSession(env, opts = {}) {
    const id = opts.id || 'u_test_admin';
    const role = opts.role || 'manager';
    const email = opts.email || `${id}@example.com`;
    const displayName = opts.displayName || 'Test Admin';

    const cookieValue = await createSession(id, role, SESSION_VERSION, env.SESSION_SECRET);
    const cookieHeader = `${COOKIE_NAME}=${cookieValue}`;

    const userRow = {
        id,
        email,
        display_name: displayName,
        role,
        active: 1,
        last_login_at: Date.now(),
        created_at: Date.now() - 86400000,
        session_version: SESSION_VERSION,
    };

    // Match requireAuth's lookup: SELECT id, email, display_name, role,
    // active, last_login_at, created_at, session_version FROM users
    // WHERE id = ? AND active = 1
    env.DB.__on(/FROM users WHERE id = \? AND active = 1/, userRow, 'first');

    return { cookieHeader, user: userRow };
}
