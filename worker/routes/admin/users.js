import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { sendUserInvite } from '../../lib/emailSender.js';
import { writeAudit } from '../../lib/auditLog.js';
import { isValidEmail } from '../../lib/email.js';

const adminUsers = new Hono();
adminUsers.use('*', requireAuth);

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ROLES = ['owner', 'manager', 'staff'];

function publicUser(u) {
    return {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        role: u.role,
        active: !!u.active,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
    };
}

// GET /api/admin/users — list all users
adminUsers.get('/', requireRole('owner', 'manager'), async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT id, email, display_name, role, active, created_at, last_login_at
         FROM users ORDER BY created_at ASC`
    ).all();
    return c.json({ users: (rows.results || []).map(publicUser) });
});

// GET /api/admin/users/invitations — list pending + recent invites
adminUsers.get('/invitations', requireRole('owner', 'manager'), async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT i.*, u.display_name AS inviter_name
         FROM invitations i
         LEFT JOIN users u ON u.id = i.invited_by
         ORDER BY i.created_at DESC LIMIT 100`
    ).all();
    const now = Date.now();
    return c.json({
        invitations: (rows.results || []).map((r) => ({
            token: r.token,
            email: r.email,
            role: r.role,
            invitedBy: r.invited_by,
            inviterName: r.inviter_name,
            createdAt: r.created_at,
            expiresAt: r.expires_at,
            consumedAt: r.consumed_at,
            revokedAt: r.revoked_at,
            status: r.consumed_at ? 'accepted'
                : r.revoked_at ? 'revoked'
                : r.expires_at < now ? 'expired'
                : 'pending',
        })),
    });
});

// POST /api/admin/users/invite — create invite + email (owner only)
adminUsers.post('/invite', requireRole('owner'), async (c) => {
    const inviter = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const email = String(body.email || '').trim().toLowerCase();
    const role = body.role;
    if (!isValidEmail(email)) {
        return c.json({ error: 'Valid email required' }, 400);
    }
    if (!ROLES.includes(role)) return c.json({ error: `role must be one of ${ROLES.join(', ')}` }, 400);

    const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
    if (existing) return c.json({ error: 'A user with this email already exists' }, 409);

    // Revoke any outstanding unredeemed invites for this email
    await c.env.DB.prepare(
        `UPDATE invitations SET revoked_at = ?
         WHERE email = ? AND consumed_at IS NULL AND revoked_at IS NULL`
    ).bind(Date.now(), email).run();

    const token = randomId(40);
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO invitations (token, email, role, invited_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(token, email, role, inviter.id, now + INVITE_TTL_MS, now).run();

    const acceptLink = `${c.env.SITE_URL}/admin/accept-invite?token=${token}`;

    const send = async () => {
        try {
            await sendUserInvite(c.env, {
                toEmail: email, inviterName: inviter.display_name, role, acceptLink,
            });
        } catch (err) {
            console.error('user_invite send failed:', err.message);
        }
    };
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(send());
    else await send();

    await writeAudit(c.env, {
        userId: inviter.id,
        action: 'user.invited',
        targetType: 'invitation',
        targetId: token,
        meta: { email, role },
    });

    return c.json({ success: true, token, acceptLink });
});

// DELETE /api/admin/users/invitations/:token — revoke an unredeemed invite
adminUsers.delete('/invitations/:token', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const token = c.req.param('token');
    const row = await c.env.DB.prepare(`SELECT * FROM invitations WHERE token = ?`).bind(token).first();
    if (!row) return c.json({ error: 'Invite not found' }, 404);
    if (row.consumed_at) return c.json({ error: 'Already accepted' }, 409);
    if (row.revoked_at) return c.json({ revoked: true });

    const now = Date.now();
    await c.env.DB.prepare(`UPDATE invitations SET revoked_at = ? WHERE token = ?`).bind(now, token).run();
    await writeAudit(c.env, {
        userId: user.id,
        action: 'user.invite_revoked',
        targetType: 'invitation',
        targetId: token,
        meta: { email: row.email, role: row.role },
    });
    return c.json({ revoked: true });
});

// PUT /api/admin/users/:id — update role or active flag (owner only).
// Cannot deactivate or demote yourself; cannot demote the last active owner.
adminUsers.put('/:id', requireRole('owner'), async (c) => {
    const actor = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
    if (!target) return c.json({ error: 'User not found' }, 404);

    const patch = {};
    if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) return c.json({ error: 'Invalid role' }, 400);
        if (id === actor.id && body.role !== actor.role) return c.json({ error: "You can't change your own role" }, 403);
        patch.role = body.role;
    }
    if (body.active !== undefined) {
        if (id === actor.id && !body.active) return c.json({ error: "You can't deactivate yourself" }, 403);
        patch.active = body.active ? 1 : 0;
    }

    // Guard against removing the last active owner
    const wouldRemoveLastOwner =
        target.role === 'owner'
        && ((patch.role !== undefined && patch.role !== 'owner') || patch.active === 0);
    if (wouldRemoveLastOwner) {
        const ownersRow = await c.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1`
        ).first();
        if ((ownersRow?.n || 0) <= 1) {
            return c.json({ error: 'Cannot remove the last active owner' }, 409);
        }
    }

    const keys = Object.keys(patch);
    if (!keys.length) return c.json({ error: 'No changes' }, 400);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE users SET ${sets} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: actor.id,
        action: 'user.updated',
        targetType: 'user',
        targetId: id,
        meta: { fields: keys, prev_role: target.role, prev_active: !!target.active },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
    return c.json({ user: publicUser(row) });
});

export default adminUsers;
