// M5 Batch 6 — Portal-side resource routes (Surface 4a part 4).
//
// These routes operate against the signed-in person (c.get('person'))
// and never expose admin-side fields. capabilities are scoped to
// portal.* and enforced via requireCapability — but the capability
// system in M5 B2 is users-keyed, and persons are not always users.
// For now, portal.access is implicit (verified by requirePortalAuth),
// and document/account capabilities are checked against the role
// preset bundled into the persons row's primary role mapping.
//
// Endpoints (all gated by requirePortalAuth):
//   GET  /api/portal/documents              docs assigned to my role
//   GET  /api/portal/documents/:id          single doc with body
//   POST /api/portal/documents/:id/ack      acknowledge a policy doc
//   GET  /api/portal/account                own profile
//   PUT  /api/portal/account                edit own name / phone

import { Hono } from 'hono';
import { requirePortalAuth } from '../../lib/portalSession.js';
import { writeAudit } from '../../lib/auditLog.js';

const portalMe = new Hono();
portalMe.use('*', requirePortalAuth);

function randomId(prefix) {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let out = '';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `${prefix}_${out}`;
}

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/documents — docs tagged for the person's primary role
// ────────────────────────────────────────────────────────────────────
portalMe.get('/documents', async (c) => {
    const person = c.get('person');

    const primaryRole = await c.env.DB.prepare(
        `SELECT role_id FROM person_roles
         WHERE person_id = ? AND is_primary = 1 AND effective_to IS NULL
         LIMIT 1`,
    ).bind(person.id).first();

    if (!primaryRole) {
        return c.json({ documents: [], acknowledged: [] });
    }

    // Live docs tagged to this role
    const docsResult = await c.env.DB.prepare(
        `SELECT sd.id, sd.kind, sd.slug, sd.title, sd.version, sd.description,
                sdr.required, sdr.created_at AS tagged_at
         FROM staff_document_roles sdr
         INNER JOIN staff_documents sd ON sd.id = sdr.staff_document_id
         WHERE sdr.role_id = ? AND sd.retired_at IS NULL
         ORDER BY sdr.required DESC, sd.kind, sd.title`,
    ).bind(primaryRole.role_id).all();

    // Person's own acknowledgments
    const acksResult = await c.env.DB.prepare(
        `SELECT staff_document_id, document_version, acknowledged_at
         FROM staff_document_acknowledgments
         WHERE person_id = ?`,
    ).bind(person.id).all();

    return c.json({
        documents: (docsResult.results || []).map((d) => ({
            id: d.id,
            kind: d.kind,
            slug: d.slug,
            title: d.title,
            version: d.version,
            description: d.description,
            required: d.required === 1,
            taggedAt: d.tagged_at,
        })),
        acknowledged: (acksResult.results || []).map((a) => ({
            documentId: a.staff_document_id,
            version: a.document_version,
            acknowledgedAt: a.acknowledged_at,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/documents/:id — single doc body
// ────────────────────────────────────────────────────────────────────
portalMe.get('/documents/:id', async (c) => {
    const id = c.req.param('id');
    const person = c.get('person');

    // Verify the doc is tagged for the person's primary role.
    const allowed = await c.env.DB.prepare(
        `SELECT 1 FROM staff_document_roles sdr
         INNER JOIN person_roles pr ON pr.role_id = sdr.role_id
         WHERE sdr.staff_document_id = ?
           AND pr.person_id = ?
           AND pr.is_primary = 1
           AND pr.effective_to IS NULL
         LIMIT 1`,
    ).bind(id, person.id).first();
    if (!allowed) return c.json({ error: 'Not assigned to your role' }, 404);

    const doc = await c.env.DB.prepare(
        `SELECT id, kind, slug, title, body_html, body_sha256, version, retired_at, description
         FROM staff_documents WHERE id = ?`,
    ).bind(id).first();
    if (!doc) return c.json({ error: 'Not found' }, 404);

    return c.json({
        id: doc.id,
        kind: doc.kind,
        slug: doc.slug,
        title: doc.title,
        bodyHtml: doc.body_html,
        bodySha256: doc.body_sha256,
        version: doc.version,
        description: doc.description,
        retiredAt: doc.retired_at,
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/portal/documents/:id/ack — acknowledge a policy doc
// ────────────────────────────────────────────────────────────────────
portalMe.post('/documents/:id/ack', async (c) => {
    const docId = c.req.param('id');
    const person = c.get('person');

    const doc = await c.env.DB.prepare(
        `SELECT id, version, body_sha256 FROM staff_documents WHERE id = ? AND retired_at IS NULL`,
    ).bind(docId).first();
    if (!doc) return c.json({ error: 'Not found or retired' }, 404);

    // Re-check role assignment to keep ack flow honest if someone
    // hand-pastes a docId.
    const allowed = await c.env.DB.prepare(
        `SELECT 1 FROM staff_document_roles sdr
         INNER JOIN person_roles pr ON pr.role_id = sdr.role_id
         WHERE sdr.staff_document_id = ?
           AND pr.person_id = ?
           AND pr.is_primary = 1
           AND pr.effective_to IS NULL
         LIMIT 1`,
    ).bind(docId, person.id).first();
    if (!allowed) return c.json({ error: 'Not assigned to your role' }, 404);

    const ackId = randomId('sda');
    const now = Date.now();

    try {
        await c.env.DB.prepare(
            `INSERT INTO staff_document_acknowledgments
             (id, person_id, staff_document_id, document_version, body_sha256_snapshot,
              acknowledged_at, ip_address, user_agent, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'portal_self_serve')`,
        ).bind(
            ackId, person.id, docId, doc.version, doc.body_sha256,
            now,
            c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
            c.req.header('user-agent') || null,
        ).run();
    } catch {
        return c.json({ error: 'Already acknowledged' }, 409);
    }

    await writeAudit(c.env, {
        action: 'staff_document.acknowledged',
        targetType: 'staff_document',
        targetId: docId,
        meta: { person_id: person.id, version: doc.version, source: 'portal_self_serve' },
    });

    return c.json({ ok: true, ackId });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/account — own profile
// ────────────────────────────────────────────────────────────────────
portalMe.get('/account', async (c) => {
    const person = c.get('person');
    const row = await c.env.DB.prepare(
        `SELECT id, full_name, email, phone, preferred_name, pronouns, status, hired_at, created_at
         FROM persons WHERE id = ?`,
    ).bind(person.id).first();
    return c.json({ person: row });
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/portal/account — edit own profile (limited fields)
// ────────────────────────────────────────────────────────────────────
portalMe.put('/account', async (c) => {
    const person = c.get('person');
    const body = await c.req.json().catch(() => ({}));

    const allowed = ['full_name', 'phone', 'preferred_name', 'pronouns'];
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
    binds.push(person.id);

    await c.env.DB.prepare(
        `UPDATE persons SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...binds).run();

    await writeAudit(c.env, {
        action: 'staff.self_updated',
        targetType: 'person',
        targetId: person.id,
        meta: { fields: Object.keys(body) },
    });

    return c.json({ ok: true });
});

export default portalMe;
