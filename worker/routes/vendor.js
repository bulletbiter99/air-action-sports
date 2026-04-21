// Public (tokenized) vendor package endpoints. No cookies, no admin auth.
// Every request decodes the HMAC-signed token, validates token_version
// against the current DB row, logs access, and enforces that the doc being
// accessed belongs to the event_vendor the token is scoped to.

import { Hono } from 'hono';
import { verifyVendorToken } from '../lib/vendorToken.js';
import { rateLimit, clientIp } from '../lib/rateLimit.js';
import { formatEvent } from '../lib/formatters.js';
import { readJson, BODY_LIMITS } from '../lib/bodyGuard.js';
import { randomId } from '../lib/ids.js';
import { loadTemplate, renderTemplate } from '../lib/templates.js';
import { sendEmail } from '../lib/email.js';

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Magic-byte sniffer shared with admin uploads.js. Duplicated here rather
// than imported to keep the vendor route file self-contained and avoid
// coupling the public surface to an admin module.
function sniffDocExt(bytes) {
    if (bytes.length < 4) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'png';
    }
    if (bytes.length >= 6 &&
        bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
        return 'gif';
    }
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'webp';
    }
    if (bytes.length >= 5 &&
        bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
        bytes[3] === 0x46 && bytes[4] === 0x2d) {
        return 'pdf';
    }
    return null;
}

const CANONICAL_MIME = {
    jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
};

const VENDOR_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;       // 10 MB
const VENDOR_RETURN_KINDS = ['coi', 'w9', 'vendor_return'];

const vendorPublic = new Hono();

// Resolve + validate a vendor token. Returns { eventVendor, payload } or a
// Response object representing the failure. Centralising this keeps the
// GET/download/log paths consistent.
async function resolveToken(c) {
    const token = c.req.param('token');
    const secret = c.env.SESSION_SECRET;
    if (!secret) return { response: c.json({ error: 'Server misconfigured' }, 500) };
    const payload = await verifyVendorToken(token, secret);
    // Always return 404 to avoid leaking "this token was valid once" or
    // "this token exists but is expired" — don't give an attacker probing
    // clues about lifecycle state.
    if (!payload) return { response: c.json({ error: 'Invalid or expired link' }, 404) };

    const ev = await c.env.DB.prepare(
        `SELECT ev.*, v.company_name AS vendor_company_name, v.coi_expires_on AS vendor_coi_expires_on,
                e.id AS event_id_resolved, e.title AS event_title,
                e.display_date AS event_display_date, e.location AS event_location,
                e.date_iso AS event_date_iso, e.time_range AS event_time_range,
                e.check_in AS event_check_in, e.first_game AS event_first_game,
                e.end_time AS event_end_time,
                vc.name AS primary_contact_name
         FROM event_vendors ev
         JOIN vendors v ON v.id = ev.vendor_id
         JOIN events e ON e.id = ev.event_id
         LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id
         WHERE ev.id = ?`
    ).bind(payload.evid).first();

    if (!ev) return { response: c.json({ error: 'Invalid or expired link' }, 404) };
    if (ev.status === 'revoked') return { response: c.json({ error: 'Invalid or expired link' }, 404) };
    // Token_version must match. Admin-side revoke bumps this to invalidate
    // any outstanding tokens instantly.
    if (ev.token_version !== payload.tv) return { response: c.json({ error: 'Invalid or expired link' }, 404) };

    return { eventVendor: ev, payload };
}

async function logAccess(env, event_vendor_id, action, target, tokenVersion, ip, userAgent) {
    await env.DB.prepare(
        `INSERT INTO vendor_access_log (event_vendor_id, action, target, ip, user_agent, token_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(event_vendor_id, action, target || null, ip || null, userAgent || null, tokenVersion, Date.now()).run();
}

// Noindex / no-referrer headers on every vendor-scope response. Keeps the
// tokenized URL out of search indexes and referer logs.
function applyNoIndex(c) {
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'private, no-store');
}

// GET /api/vendor/:token — the full package payload.
vendorPublic.get('/:token', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    applyNoIndex(c);
    const resolved = await resolveToken(c);
    if (resolved.response) return resolved.response;
    const ev = resolved.eventVendor;

    const [sections, docs, contractInfo, signature] = await Promise.all([
        c.env.DB.prepare(
            `SELECT id, kind, title, body_html, sort_order
             FROM vendor_package_sections
             WHERE event_vendor_id = ?
             ORDER BY sort_order ASC, id ASC`
        ).bind(ev.id).all(),
        c.env.DB.prepare(
            `SELECT id, filename, content_type, byte_size, kind
             FROM vendor_documents
             WHERE event_vendor_id = ? OR (vendor_id = ? AND event_vendor_id IS NULL)
             ORDER BY created_at DESC`
        ).bind(ev.id, ev.vendor_id).all(),
        ev.contract_required ? c.env.DB.prepare(
            `SELECT id, version, title, body_html, body_sha256
             FROM vendor_contract_documents
             WHERE retired_at IS NULL
             ORDER BY version DESC LIMIT 1`
        ).first() : Promise.resolve(null),
        c.env.DB.prepare(
            `SELECT id, signed_at, countersigned_at, typed_name, contract_document_version, body_sha256
             FROM vendor_signatures WHERE event_vendor_id = ?`
        ).bind(ev.id).first(),
    ]);

    const now = Date.now();
    // Stamp first_viewed_at / last_viewed_at + flip status from 'sent' to
    // 'viewed' on first open. Fire-and-forget; never block the response.
    const patch = ev.first_viewed_at
        ? c.env.DB.prepare(`UPDATE event_vendors SET last_viewed_at = ?, updated_at = ? WHERE id = ?`)
            .bind(now, now, ev.id)
        : c.env.DB.prepare(
            `UPDATE event_vendors
             SET first_viewed_at = ?, last_viewed_at = ?,
                 status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
                 updated_at = ?
             WHERE id = ?`
        ).bind(now, now, now, ev.id);
    c.executionCtx?.waitUntil(patch.run().catch((err) => console.error('viewed stamp failed', err)));
    c.executionCtx?.waitUntil(logAccess(
        c.env, ev.id, 'view', null, ev.token_version,
        clientIp(c), c.req.header('user-agent'),
    ).catch((err) => console.error('access log failed', err)));

    return c.json({
        package: {
            eventVendorId: ev.id,
            vendor: { companyName: ev.vendor_company_name, coiExpiresOn: ev.vendor_coi_expires_on },
            event: formatEvent({
                id: ev.event_id_resolved,
                title: ev.event_title,
                display_date: ev.event_display_date,
                location: ev.event_location,
                date_iso: ev.event_date_iso,
                time_range: ev.event_time_range,
                check_in: ev.event_check_in,
                first_game: ev.event_first_game,
                end_time: ev.event_end_time,
            }),
            primaryContactName: ev.primary_contact_name,
            notes: ev.notes,
            sections: (sections.results || []).map((s) => ({
                id: s.id,
                kind: s.kind,
                title: s.title,
                bodyHtml: s.body_html,
                sortOrder: s.sort_order,
            })),
            documents: (docs.results || []).map((d) => ({
                id: d.id,
                filename: d.filename,
                contentType: d.content_type,
                byteSize: d.byte_size,
                kind: d.kind,
            })),
            contract: ev.contract_required ? {
                required: true,
                document: contractInfo ? {
                    id: contractInfo.id,
                    version: contractInfo.version,
                    title: contractInfo.title,
                    bodyHtml: contractInfo.body_html,
                } : null,
                signature: signature ? {
                    signedAt: signature.signed_at,
                    countersignedAt: signature.countersigned_at,
                    typedName: signature.typed_name,
                    version: signature.contract_document_version,
                } : null,
            } : { required: false, document: null, signature: null },
        },
    });
});

// POST /api/vendor/:token/sign — sign the contract attached to this package.
// Body: { typedName, erecordsConsent: true }
// Snapshots the current live contract document's body_html + sha256 + metadata
// onto a new vendor_signatures row. One signature per package (UNIQUE index).
vendorPublic.post('/:token/sign', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    applyNoIndex(c);
    const resolved = await resolveToken(c);
    if (resolved.response) return resolved.response;
    const ev = resolved.eventVendor;
    if (!ev.contract_required) return c.json({ error: 'No contract required for this package' }, 400);
    if (!ev.primary_contact_id) return c.json({ error: 'No contact set for this package' }, 400);

    const existing = await c.env.DB.prepare(
        `SELECT id FROM vendor_signatures WHERE event_vendor_id = ?`
    ).bind(ev.id).first();
    if (existing) return c.json({ error: 'Contract already signed for this package' }, 409);

    const p = await readJson(c, BODY_LIMITS.SMALL);
    if (p.error) return c.json({ error: p.error }, p.status);
    const body = p.body || {};

    const typedName = String(body.typedName || '').trim();
    if (!typedName || typedName.length > 200) return c.json({ error: 'typedName required (max 200 chars)' }, 400);
    if (body.erecordsConsent !== true) {
        return c.json({ error: 'You must consent to sign electronically' }, 400);
    }

    // Fetch live contract, verify integrity, then snapshot on the signatures row.
    const doc = await c.env.DB.prepare(
        `SELECT * FROM vendor_contract_documents WHERE retired_at IS NULL ORDER BY version DESC LIMIT 1`
    ).first();
    if (!doc) return c.json({ error: 'No live contract document available' }, 500);
    const recomputed = await sha256Hex(doc.body_html);
    if (recomputed !== doc.body_sha256) {
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (NULL, 'vendor_contract.integrity_failure', 'vendor_contract_document', ?, ?, ?)`
        ).bind(doc.id, JSON.stringify({ expected: doc.body_sha256, recomputed }), Date.now()).run();
        return c.json({ error: 'Contract document integrity check failed' }, 500);
    }

    const sigId = `vsig_${randomId(14)}`;
    const now = Date.now();
    const ip = clientIp(c);
    const ua = c.req.header('user-agent') || null;

    await c.env.DB.prepare(
        `INSERT INTO vendor_signatures (
            id, event_vendor_id, contact_id, contract_document_id, contract_document_version,
            body_html_snapshot, body_sha256, typed_name, erecords_consent,
            ip, user_agent, token_version, signed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        sigId, ev.id, ev.primary_contact_id, doc.id, doc.version,
        doc.body_html, doc.body_sha256, typedName, 1,
        ip, ua, ev.token_version, now,
    ).run();

    await c.env.DB.prepare(
        `UPDATE event_vendors SET contract_signed_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, ev.id).run();

    c.executionCtx?.waitUntil(logAccess(c.env, ev.id, 'sign', sigId, ev.token_version, ip, ua));
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (NULL, 'vendor.signed', 'event_vendor', ?, ?, ?, ?)`
    ).bind(ev.id, JSON.stringify({
        signature_id: sigId, contract_document_id: doc.id, contract_document_version: doc.version, body_sha256: doc.body_sha256,
    }), ip, now).run();

    return c.json({ ok: true, signatureId: sigId, signedAt: now });
});

// POST /api/vendor/:token/upload — vendor-side document upload
// multipart/form-data { file, kind } where kind ∈ coi|w9|vendor_return.
// Stores under R2 prefix `vendors/returns/<event_vendor_id>/...`, creates a
// vendor_documents row tied to the primary contact, fires the admin_vendor_return
// notification email.
vendorPublic.post('/:token/upload', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    applyNoIndex(c);
    const resolved = await resolveToken(c);
    if (resolved.response) return resolved.response;
    const ev = resolved.eventVendor;
    if (!c.env.UPLOADS) return c.json({ error: 'Uploads bucket not configured' }, 500);

    const contentType = c.req.header('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return c.json({ error: 'Content-Type must be multipart/form-data' }, 400);
    }

    const form = await c.req.formData();
    const file = form.get('file');
    const kind = String(form.get('kind') || '').trim();
    if (!file || typeof file === 'string') return c.json({ error: 'file field is required' }, 400);
    if (!VENDOR_RETURN_KINDS.includes(kind)) {
        return c.json({ error: `kind must be one of ${VENDOR_RETURN_KINDS.join(', ')}` }, 400);
    }
    if (file.size > VENDOR_UPLOAD_MAX_BYTES) {
        return c.json({ error: 'File too large (max 10 MB)' }, 413);
    }

    const bytes = await file.arrayBuffer();
    const ext = sniffDocExt(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 32)));
    if (!ext) return c.json({ error: 'File is not a valid PDF or image' }, 400);

    const docId = `vdoc_${randomId(14)}`;
    const key = `vendors/returns/${ev.id}/${randomId(16)}.${ext}`;
    const mime = CANONICAL_MIME[ext];

    await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: mime } });

    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO vendor_documents (
            id, event_vendor_id, vendor_id, r2_key, filename, content_type,
            byte_size, uploaded_by_user_id, uploaded_by_contact_id, kind, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)`
    ).bind(
        docId, ev.id, key,
        (file.name || `upload.${ext}`).slice(0, 200),
        mime, file.size, ev.primary_contact_id, kind, now,
    ).run();

    c.executionCtx?.waitUntil(logAccess(c.env, ev.id, 'upload_doc', docId, ev.token_version, clientIp(c), c.req.header('user-agent')));
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (NULL, 'vendor.uploaded', 'vendor_document', ?, ?, ?, ?)`
    ).bind(docId, JSON.stringify({ event_vendor_id: ev.id, kind, r2_key: key, byte_size: file.size }), clientIp(c), now).run();

    // Best-effort admin notification. Don't fail the upload if email fails.
    c.executionCtx?.waitUntil((async () => {
        try {
            const template = await loadTemplate(c.env.DB, 'admin_vendor_return');
            const adminEmail = c.env.ADMIN_NOTIFY_EMAIL;
            if (!template || !adminEmail) return;
            const rendered = renderTemplate(template, {
                vendor_company: ev.vendor_company_name || '',
                doc_kind: kind,
                filename: file.name || '',
                event_title: ev.event_title || '',
                admin_url: `${c.env.SITE_URL}/admin/vendor-packages/${ev.id}`,
            });
            await sendEmail({
                apiKey: c.env.RESEND_API_KEY,
                from: c.env.FROM_EMAIL,
                to: adminEmail,
                replyTo: c.env.REPLY_TO_EMAIL,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
                tags: [{ name: 'type', value: 'admin_vendor_return' }, { name: 'event_vendor_id', value: ev.id }],
            });
        } catch (err) { console.error('admin_vendor_return failed', err); }
    })());

    return c.json({ ok: true, documentId: docId, filename: file.name || null, byteSize: file.size }, 201);
});

// GET /api/vendor/:token/doc/:id — download a single document.
// Authorises the doc against the resolved event_vendor: it must either be
// attached directly to this event_vendor or be a vendor-level doc for the
// same vendor. Anything else 404s (not 403 — don't leak that the id exists).
vendorPublic.get('/:token/doc/:id', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    applyNoIndex(c);
    const resolved = await resolveToken(c);
    if (resolved.response) return resolved.response;
    const ev = resolved.eventVendor;
    const docId = c.req.param('id');

    const doc = await c.env.DB.prepare(
        `SELECT * FROM vendor_documents
         WHERE id = ?
           AND (event_vendor_id = ? OR (vendor_id = ? AND event_vendor_id IS NULL))`
    ).bind(docId, ev.id, ev.vendor_id).first();
    if (!doc) return c.json({ error: 'Not found' }, 404);

    if (!c.env.UPLOADS) return c.json({ error: 'Uploads bucket not configured' }, 500);
    const obj = await c.env.UPLOADS.get(doc.r2_key);
    if (!obj) return c.json({ error: 'Not found' }, 404);

    c.executionCtx?.waitUntil(logAccess(
        c.env, ev.id, 'download_doc', doc.id, ev.token_version,
        clientIp(c), c.req.header('user-agent'),
    ).catch((err) => console.error('download log failed', err)));

    // Canonical Content-Type from the DB (which was set at upload time from
    // the magic-byte sniff), not from R2 metadata. Force Content-Disposition:
    // attachment so a drive-by PDF with embedded JS can't render inline in
    // the same origin as the admin session.
    return new Response(obj.body, {
        status: 200,
        headers: {
            'Content-Type': doc.content_type,
            'Content-Disposition': `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
            'Cache-Control': 'private, no-store',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
            'Referrer-Policy': 'no-referrer',
            'Content-Length': String(doc.byte_size),
        },
    });
});

export default vendorPublic;
