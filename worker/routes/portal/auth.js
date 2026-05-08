// M5 Batch 6 — Portal-side auth routes (Surface 4a part 4).
//
// POST /api/portal/auth/consume
//   Body: { token }
//   Validates the magic-link token, marks portal_sessions.consumed_at,
//   sets cookie_session_id + cookie_expires_at, returns Set-Cookie
//   with the new portal session cookie.
//
// POST /api/portal/auth/logout
//   Bumps portal_sessions.token_version, clears cookie. The bump
//   invalidates any other live cookies for the same portal_session row
//   (instant revoke posture matches admin sessions).
//
// GET /api/portal/auth/me
//   Returns the current person's profile shape. 401 if not signed in.

import { Hono } from 'hono';
import {
    mintInviteToken,  // not used here, kept for parallel structure
    createPortalCookie,
    verifyPortalCookie,
    parsePortalCookieHeader,
    setPortalCookie,
    clearPortalCookie,
    requirePortalAuth,
} from '../../lib/portalSession.js';
import { writeAudit } from '../../lib/auditLog.js';

// Re-export to prevent unused-import warning above
void mintInviteToken;

const portalAuth = new Hono();

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(c) {
    return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
}

// ────────────────────────────────────────────────────────────────────
// POST /api/portal/auth/consume
// ────────────────────────────────────────────────────────────────────
portalAuth.post('/consume', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.token || typeof body.token !== 'string') {
        return c.json({ error: 'token required' }, 400);
    }

    const tokenHash = await sha256Hex(body.token);

    // Look up the portal_sessions row by token_hash. The row must be
    // unconsumed AND unrevoked AND not past expires_at.
    const session = await c.env.DB.prepare(
        `SELECT id, person_id, token_version, expires_at, consumed_at, revoked_at
         FROM portal_sessions
         WHERE token_hash = ?`,
    ).bind(tokenHash).first().catch(() => null);
    if (!session) return c.json({ error: 'Invalid token' }, 401);

    if (session.consumed_at) {
        return c.json({ error: 'Token already used' }, 410);
    }
    if (session.revoked_at) {
        return c.json({ error: 'Token revoked' }, 410);
    }
    if (session.expires_at < Date.now()) {
        return c.json({ error: 'Token expired' }, 410);
    }

    // Person must still be active (not archived).
    const person = await c.env.DB.prepare(
        `SELECT id, archived_at FROM persons WHERE id = ?`,
    ).bind(session.person_id).first().catch(() => null);
    if (!person || person.archived_at) {
        return c.json({ error: 'Account unavailable' }, 401);
    }

    const now = Date.now();
    const cookieExpires = now + 30 * 24 * 60 * 60 * 1000;

    await c.env.DB.prepare(
        `UPDATE portal_sessions SET consumed_at = ?, cookie_session_id = id,
                                    cookie_expires_at = ?, ip_address = ?, user_agent = ?
         WHERE id = ?`,
    ).bind(now, cookieExpires, clientIp(c), c.req.header('user-agent') || null, session.id).run();

    const cookieValue = await createPortalCookie(session.id, session.token_version, c.env.SESSION_SECRET);

    await writeAudit(c.env, {
        action: 'portal.session.consumed',
        targetType: 'portal_session',
        targetId: session.id,
        meta: { person_id: session.person_id },
    });

    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': setPortalCookie(cookieValue),
        },
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/portal/auth/logout
// ────────────────────────────────────────────────────────────────────
portalAuth.post('/logout', async (c) => {
    const cookieHeader = c.req.header('cookie');
    const cookieValue = parsePortalCookieHeader(cookieHeader);
    const session = await verifyPortalCookie(cookieValue, c.env.SESSION_SECRET);

    if (session?.psi) {
        // Bump token_version to instantly revoke the cookie (matches the
        // admin session_version pattern).
        await c.env.DB.prepare(
            `UPDATE portal_sessions SET token_version = token_version + 1 WHERE id = ?`,
        ).bind(session.psi).run();

        await writeAudit(c.env, {
            action: 'portal.session.logout',
            targetType: 'portal_session',
            targetId: session.psi,
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearPortalCookie(),
        },
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/auth/me
// ────────────────────────────────────────────────────────────────────
portalAuth.get('/me', requirePortalAuth, async (c) => {
    const person = c.get('person');
    return c.json({ person });
});

export default portalAuth;
