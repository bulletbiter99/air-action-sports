// M5 Batch 4 — admin staff routes (Surface 4a parts 1-2).
//
// Endpoints:
//   GET  /api/admin/staff                  list with FilterBar-shape filters
//   GET  /api/admin/staff/:id              detail with primary role + tags
//   PUT  /api/admin/staff/:id              edit profile fields
//   POST /api/admin/staff/:id/role-assign  assign primary role
//   PUT  /api/admin/staff/:id/notes        update notes / notes_sensitive
//   POST /api/admin/staff/:id/archive      soft-archive
//
// Capabilities (from migration 0031):
//   staff.read                — list + detail (PII masked)
//   staff.read.pii            — unmask email, phone, mailing_address
//   staff.read.compensation   — view compensation_kind + rate
//   staff.write               — edit profile fields
//   staff.role.assign         — assign primary role (calls person_roles)
//   staff.notes.read_sensitive — read notes_sensitive
//   staff.notes.write_sensitive — write notes_sensitive
//   staff.archive             — soft-archive

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability, listCapabilities } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { decryptSafely } from '../../lib/personEncryption.js';
import { mintInviteToken } from '../../lib/portalSession.js';
import { sendStaffPortalInvite } from '../../lib/emailSender.js';
import { isValidEmail } from '../../lib/email.js';

const adminStaff = new Hono();

adminStaff.use('*', requireAuth);

const PERSON_STATUSES = ['active', 'onboarding', 'on_leave', 'offboarding', 'inactive'];
const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function newPersonId(prefix) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    return `${prefix}_${out}`;
}

// ────────────────────────────────────────────────────────────────────
// PII / compensation masking helpers
// ────────────────────────────────────────────────────────────────────

function maskEmail(email) {
    if (!email) return null;
    const at = email.indexOf('@');
    if (at <= 1) return '***';
    const localFirst = email[0];
    const domain = email.slice(at);
    return `${localFirst}***${domain}`;
}

function maskPhone(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 4) return '***';
    return `(***) ***-${digits.slice(-4)}`;
}

async function formatPerson(env, row, capabilities) {
    if (!row) return null;
    const canPii = capabilities.includes('staff.read.pii');
    const canCompensation = capabilities.includes('staff.read.compensation');
    const canSensitiveNotes = capabilities.includes('staff.notes.read_sensitive');
    const canWriteSensitiveNotes = capabilities.includes('staff.notes.write_sensitive');

    let mailingAddress = null;
    if (canPii && row.mailing_address_ciphertext) {
        mailingAddress = await decryptSafely(row.mailing_address_ciphertext, env.SESSION_SECRET);
    }

    return {
        id: row.id,
        userId: row.user_id,
        fullName: row.full_name,
        preferredName: row.preferred_name,
        pronouns: row.pronouns,
        email: canPii ? row.email : maskEmail(row.email),
        phone: canPii ? row.phone : maskPhone(row.phone),
        mailingAddress: canPii ? mailingAddress : null,
        compensationKind: canCompensation ? row.compensation_kind : null,
        compensationRateCents: canCompensation ? row.compensation_rate_cents : null,
        notes: row.notes,
        notesSensitive: canSensitiveNotes ? row.notes_sensitive : null,
        status: row.status,
        archivedAt: row.archived_at,
        archivedReason: row.archived_reason,
        hiredAt: row.hired_at,
        separatedAt: row.separated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        viewerCanSeePii: canPii,
        viewerCanSeeCompensation: canCompensation,
        viewerCanSeeSensitiveNotes: canSensitiveNotes,
        viewerCanWriteSensitiveNotes: canWriteSensitiveNotes,
    };
}

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/staff — list
// ────────────────────────────────────────────────────────────────────
adminStaff.get('/', requireCapability('staff.read'), async (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const q = params.get('q');
    const statusParam = params.get('status'); // active|onboarding|on_leave|offboarding|inactive|archived|all
    const tier = params.get('tier'); // 1-4 (filters via primary role)
    const limit = Math.min(Number(params.get('limit') || 50), 200);
    const offset = Math.max(0, Number(params.get('offset') || 0));

    const where = [];
    const binds = [];

    if (statusParam === 'archived') {
        where.push('p.archived_at IS NOT NULL');
    } else if (statusParam && statusParam !== 'all') {
        where.push('p.archived_at IS NULL AND p.status = ?');
        binds.push(statusParam);
    } else if (statusParam !== 'all') {
        // default: not archived
        where.push('p.archived_at IS NULL');
    }

    if (q) {
        const needle = `%${q.toLowerCase()}%`;
        where.push('(LOWER(p.full_name) LIKE ? OR LOWER(p.email) LIKE ?)');
        binds.push(needle, needle);
    }

    let joinTier = '';
    if (tier && /^[1-4]$/.test(tier)) {
        joinTier = ` LEFT JOIN person_roles pr ON pr.person_id = p.id AND pr.is_primary = 1 AND pr.effective_to IS NULL
                     LEFT JOIN roles r ON r.id = pr.role_id`;
        where.push('r.tier = ?');
        binds.push(Number(tier));
    }

    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM persons p ${joinTier} ${whereSQL}`,
    ).bind(...binds).first();

    const rowsResult = await c.env.DB.prepare(
        `SELECT p.id, p.user_id, p.full_name, p.preferred_name, p.email, p.phone, p.status,
                p.archived_at, p.created_at, p.updated_at
         FROM persons p ${joinTier} ${whereSQL}
         ORDER BY p.archived_at IS NOT NULL, p.full_name COLLATE NOCASE
         LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, offset).all();

    const user = c.get('user');
    const capabilities = user.capabilities || (await listCapabilities(c.env, user.id));
    const canPii = capabilities.includes('staff.read.pii');

    return c.json({
        total: countRow?.n ?? 0,
        limit,
        offset,
        viewerCanSeePii: canPii,
        persons: (rowsResult.results || []).map((row) => ({
            id: row.id,
            userId: row.user_id,
            fullName: row.full_name,
            preferredName: row.preferred_name,
            email: canPii ? row.email : maskEmail(row.email),
            phone: canPii ? row.phone : maskPhone(row.phone),
            status: row.status,
            archivedAt: row.archived_at,
            createdAt: row.created_at,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/staff/roles-catalog — list role catalog for assign UIs
// ────────────────────────────────────────────────────────────────────
// Registered before /:id so the literal segment wins routing.
adminStaff.get('/roles-catalog', requireCapability('staff.read'), async (c) => {
    const rolesResult = await c.env.DB.prepare(
        'SELECT id, key, name, tier FROM roles ORDER BY tier, name COLLATE NOCASE'
    ).all();
    return c.json({ roles: rolesResult.results || [] });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/staff — create a person (+ optional primary role)
// ────────────────────────────────────────────────────────────────────
adminStaff.post('/', requireCapability('staff.write'), async (c) => {
    const body = await c.req.json().catch(() => ({}));

    const fullName = String(body.fullName || '').trim();
    if (!fullName) return c.json({ error: 'fullName required' }, 400);
    if (fullName.length > 200) return c.json({ error: 'fullName too long' }, 400);

    const email = body.email == null ? null : String(body.email).trim().toLowerCase();
    if (email && !isValidEmail(email)) {
        return c.json({ error: 'email is not a valid address' }, 400);
    }

    const phone = body.phone == null ? null : String(body.phone).trim() || null;
    const preferredName = body.preferredName == null ? null : String(body.preferredName).trim() || null;

    const status = body.status ? String(body.status) : 'onboarding';
    if (!PERSON_STATUSES.includes(status)) {
        return c.json({ error: `status must be one of ${PERSON_STATUSES.join(', ')}` }, 400);
    }

    const primaryRoleId = body.primaryRoleId ? String(body.primaryRoleId) : null;
    if (primaryRoleId) {
        const role = await c.env.DB.prepare('SELECT id FROM roles WHERE id = ?').bind(primaryRoleId).first();
        if (!role) return c.json({ error: 'Unknown primaryRoleId' }, 400);
    }

    const notes = body.notes == null ? null : String(body.notes);

    const user = c.get('user');
    const personId = newPersonId('prs');
    const now = Date.now();

    await c.env.DB.prepare(
        `INSERT INTO persons (id, user_id, full_name, preferred_name, email, phone, notes, status, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(personId, fullName, preferredName, email, phone, notes, status, now, now).run();

    let personRoleId = null;
    if (primaryRoleId) {
        personRoleId = newPersonId('pr');
        await c.env.DB.prepare(
            `INSERT INTO person_roles (id, person_id, role_id, is_primary, effective_from, created_by_user_id, created_at)
             VALUES (?, ?, ?, 1, ?, ?, ?)`
        ).bind(personRoleId, personId, primaryRoleId, now, user.id, now).run();
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff.created',
        targetType: 'person',
        targetId: personId,
        meta: { primaryRoleId, hasEmail: Boolean(email), status },
    });

    const created = await c.env.DB.prepare('SELECT * FROM persons WHERE id = ?').bind(personId).first();
    const capabilities = user.capabilities || (await listCapabilities(c.env, user.id));
    const person = await formatPerson(c.env, created, capabilities);

    return c.json({ person, personRoleId }, 201);
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/staff/:id — detail with primary role + tags
// ────────────────────────────────────────────────────────────────────
adminStaff.get('/:id', requireCapability('staff.read'), async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM persons WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);

    const user = c.get('user');
    const capabilities = user.capabilities || (await listCapabilities(c.env, user.id));

    const formatted = await formatPerson(c.env, row, capabilities);

    // Roles (current + history)
    const rolesResult = await c.env.DB.prepare(
        `SELECT pr.id, pr.role_id, r.key, r.name, r.tier, pr.is_primary,
                pr.effective_from, pr.effective_to, pr.notes, pr.created_at
         FROM person_roles pr
         INNER JOIN roles r ON r.id = pr.role_id
         WHERE pr.person_id = ?
         ORDER BY pr.is_primary DESC, pr.effective_from DESC`,
    ).bind(id).all();

    const tagsResult = await c.env.DB.prepare(
        `SELECT id, tag, source, created_at
         FROM person_tags WHERE person_id = ?
         ORDER BY tag`,
    ).bind(id).all();

    if (capabilities.includes('staff.read.pii')) {
        await writeAudit(c.env, {
            userId: user.id,
            action: 'staff.pii.unmasked',
            targetType: 'person',
            targetId: id,
            meta: { fields: ['email', 'phone', 'mailing_address'] },
        });
    }

    return c.json({
        person: formatted,
        roles: (rolesResult.results || []).map((r) => ({
            id: r.id,
            roleId: r.role_id,
            key: r.key,
            name: r.name,
            tier: r.tier,
            isPrimary: r.is_primary === 1,
            effectiveFrom: r.effective_from,
            effectiveTo: r.effective_to,
            notes: r.notes,
            createdAt: r.created_at,
        })),
        tags: tagsResult.results || [],
    });
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/staff/:id — edit profile fields
// ────────────────────────────────────────────────────────────────────
adminStaff.put('/:id', requireCapability('staff.write'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const allowed = ['full_name', 'preferred_name', 'pronouns', 'email', 'phone', 'status', 'hired_at', 'separated_at'];
    const sets = [];
    const binds = [];
    for (const k of allowed) {
        if (k in body) {
            sets.push(`${k} = ?`);
            binds.push(body[k]);
        }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    binds.push(Date.now());
    binds.push(id);

    const result = await c.env.DB.prepare(
        `UPDATE persons SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    if (!result?.meta?.changes) return c.json({ error: 'Not found' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff.updated',
        targetType: 'person',
        targetId: id,
        meta: { fields: Object.keys(body) },
    });

    return c.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/staff/:id/role-assign — assign primary role
// ────────────────────────────────────────────────────────────────────
adminStaff.post('/:id/role-assign', requireCapability('staff.role.assign'), async (c) => {
    const personId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { roleId, notes } = body || {};
    if (!roleId) return c.json({ error: 'roleId required' }, 400);

    const role = await c.env.DB.prepare('SELECT id FROM roles WHERE id = ?').bind(roleId).first();
    if (!role) return c.json({ error: 'Unknown roleId' }, 400);

    const person = await c.env.DB.prepare('SELECT id FROM persons WHERE id = ?').bind(personId).first();
    if (!person) return c.json({ error: 'Person not found' }, 404);

    const now = Date.now();

    await c.env.DB.prepare(
        `UPDATE person_roles SET is_primary = 0, effective_to = ? WHERE person_id = ? AND is_primary = 1 AND effective_to IS NULL`
    ).bind(now, personId).run();

    const newId = `pr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const user = c.get('user');
    await c.env.DB.prepare(
        `INSERT INTO person_roles (id, person_id, role_id, is_primary, effective_from, notes, created_by_user_id, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
    ).bind(newId, personId, roleId, now, notes || null, user.id, now).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff.role.assigned',
        targetType: 'person',
        targetId: personId,
        meta: { roleId, personRoleId: newId },
    });

    return c.json({ ok: true, personRoleId: newId });
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/staff/:id/notes — update notes / notes_sensitive
// ────────────────────────────────────────────────────────────────────
adminStaff.put('/:id/notes', requireCapability('staff.write'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const sets = [];
    const binds = [];
    if ('notes' in body) {
        sets.push('notes = ?');
        binds.push(body.notes);
    }
    if ('notesSensitive' in body) {
        const user = c.get('user');
        const capabilities = user.capabilities || (await listCapabilities(c.env, user.id));
        if (!capabilities.includes('staff.notes.write_sensitive')) {
            return c.json({ error: 'Forbidden', requiresCapability: 'staff.notes.write_sensitive' }, 403);
        }
        sets.push('notes_sensitive = ?');
        binds.push(body.notesSensitive);
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    binds.push(Date.now());
    binds.push(id);

    const result = await c.env.DB.prepare(
        `UPDATE persons SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    if (!result?.meta?.changes) return c.json({ error: 'Not found' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff.notes.updated',
        targetType: 'person',
        targetId: id,
        meta: { fields: Object.keys(body) },
    });

    return c.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/staff/:id/archive — soft-archive
// ────────────────────────────────────────────────────────────────────
adminStaff.post('/:id/archive', requireCapability('staff.archive'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const reason = body.reason || 'manual';

    const now = Date.now();
    const result = await c.env.DB.prepare(
        `UPDATE persons SET archived_at = ?, archived_reason = ?, status = 'inactive', updated_at = ? WHERE id = ? AND archived_at IS NULL`
    ).bind(now, reason, now, id).run();

    if (!result?.meta?.changes) {
        return c.json({ error: 'Not found or already archived' }, 404);
    }

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'staff.archived',
        targetType: 'person',
        targetId: id,
        meta: { reason },
    });

    return c.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/staff/:id/invite — mint magic link + send invite
// ────────────────────────────────────────────────────────────────────
adminStaff.post('/:id/invite', requireCapability('staff.invite'), async (c) => {
    const personId = c.req.param('id');
    const person = await c.env.DB.prepare(
        'SELECT id, full_name, email, archived_at FROM persons WHERE id = ?'
    ).bind(personId).first();
    if (!person) return c.json({ error: 'Not found' }, 404);
    if (person.archived_at) return c.json({ error: 'Person archived' }, 409);
    if (!person.email) return c.json({ error: 'Person has no email on file' }, 400);

    const { token, tokenHash } = await mintInviteToken();
    const sessionId = `ps_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000; // 24h

    const user = c.get('user');

    await c.env.DB.prepare(
        `INSERT INTO portal_sessions (id, person_id, token_hash, token_version, expires_at, created_by_user_id, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`
    ).bind(sessionId, personId, tokenHash, expiresAt, user.id, now).run();

    const siteUrl = c.env.SITE_URL || 'https://airactionsport.com';
    const magicLink = `${siteUrl}/portal/auth/consume?token=${token}`;

    // Best-effort email; don't fail the invite mint if Resend errors.
    let emailResult;
    try {
        emailResult = await sendStaffPortalInvite(c.env, {
            person,
            inviterName: user.display_name,
            magicLink,
            expiresAt: new Date(expiresAt),
        });
    } catch (err) {
        emailResult = { error: err?.message || 'send_failed' };
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'portal.invite.sent',
        targetType: 'person',
        targetId: personId,
        meta: { sessionId, emailSkipped: emailResult?.skipped, emailError: emailResult?.error },
    });

    // For local-D1 testing: include the magic link in the response when
    // the email returned a "skipped" reason. Operators running the dry
    // run on a fresh D1 see the link directly. In production with Resend
    // configured, the response just confirms the send.
    const debugLink = (emailResult?.skipped || emailResult?.error) ? magicLink : undefined;
    return c.json({ ok: true, sessionId, ...(debugLink ? { debugLink } : {}) });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/staff/:id/portal-sessions — list portal-invite +
// portal-session history for the Access tab on AdminStaffDetail.
// ────────────────────────────────────────────────────────────────────
adminStaff.get('/:id/portal-sessions', requireCapability('staff.read'), async (c) => {
    const personId = c.req.param('id');
    const rows = await c.env.DB.prepare(
        `SELECT id, person_id, consumed_at, expires_at, cookie_expires_at,
                ip_address, user_agent, created_by_user_id, created_at,
                revoked_at, revoked_reason
         FROM portal_sessions
         WHERE person_id = ?
         ORDER BY created_at DESC
         LIMIT 100`
    ).bind(personId).all();

    const now = Date.now();
    const sessions = (rows.results || []).map((r) => {
        let status;
        if (r.revoked_at) {
            status = 'revoked';
        } else if (r.consumed_at) {
            status = (r.cookie_expires_at && r.cookie_expires_at >= now) ? 'active' : 'expired';
        } else {
            status = r.expires_at >= now ? 'pending' : 'expired';
        }
        return {
            id: r.id,
            personId: r.person_id,
            createdAt: r.created_at,
            consumedAt: r.consumed_at,
            expiresAt: r.expires_at,
            cookieExpiresAt: r.cookie_expires_at,
            revokedAt: r.revoked_at,
            revokedReason: r.revoked_reason,
            ipAddress: r.ip_address,
            userAgent: r.user_agent,
            createdByUserId: r.created_by_user_id,
            status,
        };
    });

    return c.json({ sessions });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/staff/:id/portal-sessions/:sessionId/revoke
// Invalidates a portal session. Gated by staff.invite (same cap that
// creates them). Idempotent: returns 409 if already revoked.
// ────────────────────────────────────────────────────────────────────
adminStaff.post('/:id/portal-sessions/:sessionId/revoke', requireCapability('staff.invite'), async (c) => {
    const personId = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json().catch(() => ({}));
    const reason = body.reason ? String(body.reason).slice(0, 200) : 'admin_revoked';

    const row = await c.env.DB.prepare(
        'SELECT id, person_id, revoked_at FROM portal_sessions WHERE id = ?'
    ).bind(sessionId).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.person_id !== personId) return c.json({ error: 'Session does not belong to this person' }, 400);
    if (row.revoked_at) return c.json({ error: 'Already revoked', revokedAt: row.revoked_at }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        'UPDATE portal_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ?'
    ).bind(now, reason, sessionId).run();

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'portal.session.revoked',
        targetType: 'person',
        targetId: personId,
        meta: { sessionId, reason },
    });

    return c.json({ ok: true, revokedAt: now });
});

export default adminStaff;
