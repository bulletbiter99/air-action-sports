// M5 Batch 8 — admin certifications routes (Surface 4b).
//
// Endpoints (gated by staff.certifications.* capabilities):
//   GET  /api/admin/certifications?person_id=...
//   POST /api/admin/certifications              add new cert
//   PUT  /api/admin/certifications/:id          edit cert
//   POST /api/admin/certifications/:id/renew    create new cert; mark prev expired
//   POST /api/admin/certifications/:id/revoke   mark revoked
//   GET  /api/admin/certifications/expiring?days=60  rollup for the cron
//   GET  /api/admin/certifications/required-by-role/:roleId  catalog

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminCertifications = new Hono();
adminCertifications.use('*', requireAuth);

function randomCertId() {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let out = '';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `cert_${out}`;
}

function format(row) {
    if (!row) return null;
    return {
        id: row.id,
        personId: row.person_id,
        kind: row.kind,
        displayName: row.display_name,
        certificateNumber: row.certificate_number,
        issuingAuthority: row.issuing_authority,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        documentId: row.document_id,
        notes: row.notes,
        status: row.status,
        addedAt: row.added_at,
        updatedAt: row.updated_at,
        previousCertId: row.previous_cert_id,
    };
}

// GET /api/admin/certifications?person_id=...
adminCertifications.get('/', requireCapability('staff.certifications.read'), async (c) => {
    const url = new URL(c.req.url);
    const personId = url.searchParams.get('person_id');
    if (!personId) return c.json({ error: 'person_id required' }, 400);

    const rows = await c.env.DB.prepare(
        `SELECT * FROM certifications WHERE person_id = ? ORDER BY status, expires_at NULLS LAST, kind`,
    ).bind(personId).all();
    return c.json({ certifications: (rows.results || []).map(format) });
});

// GET /api/admin/certifications/expiring?days=60
adminCertifications.get('/expiring', requireCapability('staff.certifications.read'), async (c) => {
    const url = new URL(c.req.url);
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 60));
    const cutoff = Date.now() + days * 86400000;

    const rows = await c.env.DB.prepare(
        `SELECT c.*, p.full_name AS person_name, p.email AS person_email
         FROM certifications c
         INNER JOIN persons p ON p.id = c.person_id
         WHERE c.status = 'active'
           AND c.expires_at IS NOT NULL
           AND c.expires_at < ?
           AND p.archived_at IS NULL
         ORDER BY c.expires_at`,
    ).bind(cutoff).all();

    return c.json({
        days,
        cutoff,
        certifications: (rows.results || []).map((r) => ({
            ...format(r),
            personName: r.person_name,
            personEmail: r.person_email,
        })),
    });
});

// GET /api/admin/certifications/required-by-role/:roleId
adminCertifications.get('/required-by-role/:roleId', requireCapability('staff.certifications.read'), async (c) => {
    const roleId = c.req.param('roleId');
    const rows = await c.env.DB.prepare(
        `SELECT id, role_id, cert_kind, required, created_at
         FROM role_required_certifications WHERE role_id = ?
         ORDER BY required DESC, cert_kind`,
    ).bind(roleId).all();
    return c.json({ requirements: rows.results || [] });
});

// POST /api/admin/certifications
adminCertifications.post('/', requireCapability('staff.certifications.write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { personId, kind, displayName, certificateNumber, issuingAuthority,
            issuedAt, expiresAt, notes, documentId } = body || {};

    if (!personId || !kind || !displayName) {
        return c.json({ error: 'personId, kind, displayName required' }, 400);
    }

    const id = randomCertId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO certifications (id, person_id, kind, display_name, certificate_number,
                                      issuing_authority, issued_at, expires_at, document_id,
                                      notes, status, added_by_user_id, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
        id, personId, kind, displayName,
        certificateNumber || null, issuingAuthority || null,
        issuedAt || null, expiresAt || null, documentId || null, notes || null,
        user.id, now, now,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'certification.added',
        targetType: 'certification',
        targetId: id,
        meta: { personId, kind },
    });

    return c.json({ ok: true, id }, 201);
});

// PUT /api/admin/certifications/:id
adminCertifications.put('/:id', requireCapability('staff.certifications.write'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const allowed = {
        displayName: 'display_name',
        certificateNumber: 'certificate_number',
        issuingAuthority: 'issuing_authority',
        issuedAt: 'issued_at',
        expiresAt: 'expires_at',
        notes: 'notes',
        status: 'status',
    };
    const sets = [];
    const binds = [];
    for (const [camel, sql] of Object.entries(allowed)) {
        if (camel in body) {
            sets.push(`${sql} = ?`);
            binds.push(body[camel]);
        }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    binds.push(Date.now());
    binds.push(id);

    const r = await c.env.DB.prepare(
        `UPDATE certifications SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...binds).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'certification.updated',
        targetType: 'certification',
        targetId: id,
        meta: { fields: Object.keys(body) },
    });

    return c.json({ ok: true });
});

// POST /api/admin/certifications/:id/renew
adminCertifications.post('/:id/renew', requireCapability('staff.certifications.write'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { issuedAt, expiresAt, certificateNumber, notes } = body || {};

    const prev = await c.env.DB.prepare('SELECT * FROM certifications WHERE id = ?').bind(id).first();
    if (!prev) return c.json({ error: 'Not found' }, 404);

    const newId = randomCertId();
    const now = Date.now();
    const user = c.get('user');

    await c.env.DB.prepare(
        `INSERT INTO certifications (id, person_id, kind, display_name, certificate_number,
                                      issuing_authority, issued_at, expires_at,
                                      notes, status, added_by_user_id, added_at, updated_at,
                                      previous_cert_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(
        newId, prev.person_id, prev.kind, prev.display_name,
        certificateNumber || prev.certificate_number, prev.issuing_authority,
        issuedAt || now, expiresAt || null, notes || prev.notes,
        user.id, now, now, id,
    ).run();

    await c.env.DB.prepare(
        `UPDATE certifications SET status = 'expired', updated_at = ? WHERE id = ?`,
    ).bind(now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'certification.renewed',
        targetType: 'certification',
        targetId: newId,
        meta: { previousCertId: id, personId: prev.person_id, kind: prev.kind },
    });

    return c.json({ ok: true, id: newId, previousCertId: id });
});

// POST /api/admin/certifications/:id/revoke
adminCertifications.post('/:id/revoke', requireCapability('staff.certifications.write'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const reason = body.reason || 'manual';

    const r = await c.env.DB.prepare(
        `UPDATE certifications SET status = 'revoked', updated_at = ? WHERE id = ? AND status != 'revoked'`,
    ).bind(Date.now(), id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or already revoked' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'certification.revoked',
        targetType: 'certification',
        targetId: id,
        meta: { reason },
    });
    return c.json({ ok: true });
});

export default adminCertifications;
