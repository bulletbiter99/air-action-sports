import { verifySession, parseCookieHeader } from './session.js';
import { parsePortalCookieHeader } from './portalSession.js';

export async function requireAuth(c, next) {
    const cookieHeader = c.req.header('cookie');
    const token = parseCookieHeader(cookieHeader);

    // Strict separation (M5 R6): if the caller presents a portal cookie
    // (`aas_portal_session`) but NOT an admin cookie (`aas_session`),
    // return 403 with a wrong-cookie-type hint rather than the generic
    // 401. This is per the Surface 4a separation contract — portal users
    // hitting /admin/* should be told they're on the wrong door, not
    // bounced through the admin login flow.
    //
    // F57 (no cookie at all) still returns 401 — that path is unchanged.
    if (!token) {
        const portalCookie = parsePortalCookieHeader(cookieHeader);
        if (portalCookie) {
            return c.json({
                error: 'Wrong session type for /admin route',
                hint: 'You are signed in to the portal. Use /admin/login for admin access.',
                portalCookieDetected: true,
            }, 403);
        }
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const session = await verifySession(token, c.env.SESSION_SECRET);
    if (!session) return c.json({ error: 'Not authenticated' }, 401);

    const user = await c.env.DB.prepare(
        `SELECT id, email, display_name, role, active, last_login_at, created_at, session_version
         FROM users WHERE id = ? AND active = 1`
    ).bind(session.uid).first();
    if (!user) return c.json({ error: 'Account not found or disabled' }, 401);

    // Session-version check: password reset, password change, and logout all
    // increment users.session_version, which instantly invalidates any
    // previously-issued cookies for that user (post-compromise safety).
    if (session.sv !== user.session_version) {
        return c.json({ error: 'Session expired. Please log in again.' }, 401);
    }

    c.set('user', user);
    await next();
}

export function requireRole(...roles) {
    return async (c, next) => {
        const user = c.get('user');
        if (!user || !roles.includes(user.role)) {
            return c.json({ error: 'Forbidden' }, 403);
        }
        await next();
    };
}

export function publicUser(u) {
    if (!u) return null;
    return {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        role: u.role,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
    };
}
