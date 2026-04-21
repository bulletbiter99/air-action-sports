import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { createSession, setCookie, clearCookie } from '../../lib/session.js';
import { requireAuth, publicUser } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { sendPasswordReset } from '../../lib/emailSender.js';

const auth = new Hono();

// Whether the first-owner setup flow should be shown.
auth.get('/setup-needed', async (c) => {
    const row = await c.env.DB.prepare('SELECT COUNT(*) as n FROM users').first();
    return c.json({ setupNeeded: (row?.n ?? 0) === 0 });
});

// First-owner bootstrap. Only works if the users table is empty.
auth.post('/setup', async (c) => {
    const row = await c.env.DB.prepare('SELECT COUNT(*) as n FROM users').first();
    if ((row?.n ?? 0) > 0) return c.json({ error: 'Setup already complete' }, 409);

    const body = await c.req.json().catch(() => null);
    if (!body?.email?.trim() || !body?.password || !body?.displayName?.trim()) {
        return c.json({ error: 'email, password, and displayName are required' }, 400);
    }
    if (body.password.length < 8) {
        return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const id = `u_${randomId(12)}`;
    const hash = await hashPassword(body.password);
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, role, active, created_at)
         VALUES (?, ?, ?, ?, 'owner', 1, ?)`
    ).bind(id, body.email.trim().toLowerCase(), hash, body.displayName.trim(), now).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'user.setup_owner', 'user', ?, ?, ?)`
    ).bind(id, id, JSON.stringify({ email: body.email }), now).run();

    const token = await createSession(id, 'owner', c.env.SESSION_SECRET);
    c.header('Set-Cookie', setCookie(token));
    return c.json({
        user: { id, email: body.email.trim().toLowerCase(), displayName: body.displayName.trim(), role: 'owner' },
    });
});

auth.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.email || !body?.password) {
        return c.json({ error: 'email and password required' }, 400);
    }
    const user = await c.env.DB.prepare(
        `SELECT * FROM users WHERE email = ? AND active = 1`
    ).bind(body.email.trim().toLowerCase()).first();
    if (!user || !await verifyPassword(body.password, user.password_hash)) {
        return c.json({ error: 'Invalid email or password' }, 401);
    }

    const now = Date.now();
    await c.env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).bind(now, user.id).run();

    const token = await createSession(user.id, user.role, c.env.SESSION_SECRET);
    c.header('Set-Cookie', setCookie(token));
    return c.json({ user: publicUser(user) });
});

auth.post('/logout', async (c) => {
    c.header('Set-Cookie', clearCookie());
    return c.json({ ok: true });
});

auth.get('/me', requireAuth, async (c) => {
    return c.json({ user: publicUser(c.get('user')) });
});

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

// POST /api/admin/auth/forgot-password
// Always returns success even if email doesn't exist (prevents account enumeration).
// Sends email via Resend (async via waitUntil).
auth.post('/forgot-password', async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = body?.email?.trim().toLowerCase();
    if (!email) return c.json({ error: 'email required' }, 400);

    const user = await c.env.DB.prepare(
        `SELECT * FROM users WHERE email = ? AND active = 1`
    ).bind(email).first();

    // If user exists, generate a token and email it. Either way, return success.
    if (user) {
        const token = randomId(40);
        const now = Date.now();
        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        await c.env.DB.prepare(
            `INSERT INTO password_resets (token, user_id, expires_at, created_at, ip_address)
             VALUES (?, ?, ?, ?, ?)`
        ).bind(token, user.id, now + RESET_TTL_MS, now, ip).run();

        const resetLink = `${c.env.SITE_URL}/admin/reset-password?token=${token}`;

        const send = async () => {
            try {
                await sendPasswordReset(c.env, { user, resetLink });
            } catch (err) {
                console.error('password_reset send failed:', err.message);
            }
        };
        if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(send());
        else await send();

        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
             VALUES (?, 'password_reset.requested', 'user', ?, ?, ?, ?)`
        ).bind(user.id, user.id, JSON.stringify({ email }), ip, now).run();
    }

    return c.json({ ok: true });
});

// POST /api/admin/auth/reset-password
// Consumes a reset token, sets new password, logs user in.
auth.post('/reset-password', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.token || !body?.password) {
        return c.json({ error: 'token and password required' }, 400);
    }
    if (body.password.length < 8) {
        return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const row = await c.env.DB.prepare(
        `SELECT * FROM password_resets WHERE token = ?`
    ).bind(body.token).first();
    if (!row) return c.json({ error: 'Invalid or expired link' }, 400);
    if (row.used_at) return c.json({ error: 'This link has already been used' }, 400);
    if (row.expires_at < Date.now()) return c.json({ error: 'This link has expired. Request a new one.' }, 400);

    const user = await c.env.DB.prepare(
        `SELECT * FROM users WHERE id = ? AND active = 1`
    ).bind(row.user_id).first();
    if (!user) return c.json({ error: 'Account not found' }, 404);

    const hash = await hashPassword(body.password);
    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE users SET password_hash = ?, last_login_at = ? WHERE id = ?`
    ).bind(hash, now, user.id).run();

    await c.env.DB.prepare(
        `UPDATE password_resets SET used_at = ? WHERE token = ?`
    ).bind(now, body.token).run();

    // Invalidate any other pending tokens for this user
    await c.env.DB.prepare(
        `UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND token != ?`
    ).bind(now, user.id, body.token).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'password_reset.completed', 'user', ?, ?, ?)`
    ).bind(user.id, user.id, JSON.stringify({}), now).run();

    const token = await createSession(user.id, user.role, c.env.SESSION_SECRET);
    c.header('Set-Cookie', setCookie(token));
    return c.json({ user: publicUser(user) });
});

// GET /api/admin/auth/verify-invite/:token — public check before showing the accept form
auth.get('/verify-invite/:token', async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT * FROM invitations WHERE token = ?`
    ).bind(c.req.param('token')).first();
    if (!row) return c.json({ valid: false, reason: 'not_found' });
    if (row.consumed_at) return c.json({ valid: false, reason: 'accepted' });
    if (row.revoked_at) return c.json({ valid: false, reason: 'revoked' });
    if (row.expires_at < Date.now()) return c.json({ valid: false, reason: 'expired' });
    return c.json({ valid: true, email: row.email, role: row.role });
});

// POST /api/admin/auth/accept-invite — consume token, create user, auto-login
auth.post('/accept-invite', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.token || !body?.password || !body?.displayName?.trim()) {
        return c.json({ error: 'token, password, and displayName required' }, 400);
    }
    if (body.password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

    const invite = await c.env.DB.prepare(
        `SELECT * FROM invitations WHERE token = ?`
    ).bind(body.token).first();
    if (!invite) return c.json({ error: 'Invalid invite' }, 400);
    if (invite.consumed_at) return c.json({ error: 'Invite already accepted' }, 400);
    if (invite.revoked_at) return c.json({ error: 'Invite has been revoked' }, 400);
    if (invite.expires_at < Date.now()) return c.json({ error: 'Invite has expired' }, 400);

    // Defensive: ensure no user already has this email (race between invite-create and acceptance)
    const dupe = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(invite.email).first();
    if (dupe) return c.json({ error: 'An account with this email already exists' }, 409);

    const id = `u_${randomId(12)}`;
    const hash = await hashPassword(body.password);
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, role, active, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(id, invite.email, hash, body.displayName.trim(), invite.role, now, now).run();

    await c.env.DB.prepare(
        `UPDATE invitations SET consumed_at = ? WHERE token = ?`
    ).bind(now, body.token).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'user.invite_accepted', 'user', ?, ?, ?)`
    ).bind(id, id, JSON.stringify({ email: invite.email, role: invite.role, invited_by: invite.invited_by }), now).run();

    const token = await createSession(id, invite.role, c.env.SESSION_SECRET);
    c.header('Set-Cookie', setCookie(token));
    return c.json({
        user: { id, email: invite.email, displayName: body.displayName.trim(), role: invite.role },
    });
});

// GET /api/admin/auth/verify-reset-token/:token
// Used by the reset page to validate the link before showing the form.
auth.get('/verify-reset-token/:token', async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT pr.expires_at, pr.used_at, u.email
         FROM password_resets pr JOIN users u ON u.id = pr.user_id
         WHERE pr.token = ?`
    ).bind(c.req.param('token')).first();
    if (!row) return c.json({ valid: false, reason: 'not_found' });
    if (row.used_at) return c.json({ valid: false, reason: 'used' });
    if (row.expires_at < Date.now()) return c.json({ valid: false, reason: 'expired' });
    return c.json({ valid: true, email: row.email });
});

export default auth;
