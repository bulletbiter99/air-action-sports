// M5.5 Batch 7b — field rental documents route.
//
// Endpoints:
//   POST   /api/admin/field-rental-documents              upload (multipart)
//   GET    /api/admin/field-rental-documents?rental_id=…  list for a rental
//   GET    /api/admin/field-rental-documents/:docId       metadata only
//   GET    /api/admin/field-rental-documents/:docId/download  streamed R2 bytes
//   POST   /api/admin/field-rental-documents/:docId/retire
//
// Kinds: agreement / coi / addendum / correspondence / other.
// Versioning: a new agreement or coi for a given rental retires the prior live
// row (retired_at = now). Side effect on success:
//   - kind='coi' denormalizes coi_status='received' + coi_expires_at +
//     requirements_coi_received=1 onto the parent rental
//   - kind='agreement' denormalizes requirements_agreement_signed=1
//
// PII gating:
//   - field_rentals.documents.read   — list + detail + download
//   - field_rentals.documents.upload — POST upload + POST retire
//   - field_rentals.coi.read_pii     — unmask coi_carrier_name / policy_number /
//                                       amount_cents (return masked otherwise)

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability, hasCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { rentalDocumentId as newDocId } from '../../lib/ids.js';
import { sniffDocExt, DOC_MIME } from '../../lib/magicBytes.js';
import { clientIp } from '../../lib/rateLimit.js';

const adminFieldRentalDocuments = new Hono();
adminFieldRentalDocuments.use('*', requireAuth);

const MAX_DOC_BYTES = 10 * 1024 * 1024;          // 10 MB (matches uploads.js)
const KINDS = new Set(['agreement', 'coi', 'addendum', 'correspondence', 'other']);
const MASKED = '***';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function formatDocument(row, { viewerCanSeeCoiPII }) {
    if (!row) return null;
    const out = {
        id: row.id,
        rentalId: row.rental_id,
        kind: row.kind,
        fileName: row.file_name,
        contentType: row.content_type,
        bytes: row.bytes,
        uploadedByUserId: row.uploaded_by_user_id,
        uploadedAt: row.uploaded_at,
        retiredAt: row.retired_at,
        notes: row.notes,
    };
    if (row.kind === 'coi') {
        out.coiCarrierName = viewerCanSeeCoiPII ? row.coi_carrier_name : (row.coi_carrier_name ? MASKED : null);
        out.coiPolicyNumber = viewerCanSeeCoiPII ? row.coi_policy_number : (row.coi_policy_number ? MASKED : null);
        out.coiAmountCents = viewerCanSeeCoiPII ? row.coi_amount_cents : (row.coi_amount_cents == null ? null : null);
        // Effective/expires dates are operationally important (visible regardless of PII cap)
        out.coiEffectiveAt = row.coi_effective_at;
        out.coiExpiresAt = row.coi_expires_at;
    }
    if (row.kind === 'agreement') {
        out.suaDocumentId = row.sua_document_id;
        out.suaBodySha256Snapshot = row.sua_body_sha256_snapshot;
        out.suaSignerTypedName = row.sua_signer_typed_name;
        out.suaSignerIp = row.sua_signer_ip;
        out.suaSignerUa = row.sua_signer_ua;
        out.suaSignedAt = row.sua_signed_at;
    }
    return out;
}

async function fetchRental(env, id) {
    return env.DB.prepare('SELECT id, archived_at, status FROM field_rentals WHERE id = ?').bind(id).first();
}

async function fetchDocument(env, docId) {
    return env.DB.prepare('SELECT * FROM field_rental_documents WHERE id = ?').bind(docId).first();
}

async function fetchLiveSua(env) {
    return env.DB.prepare(
        `SELECT id, body_html, body_sha256 FROM site_use_agreement_documents
         WHERE retired_at IS NULL
         ORDER BY effective_from DESC LIMIT 1`,
    ).first();
}

function nonEmptyString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function validateCoiMetadata(form) {
    const carrier = nonEmptyString(form.get('coi_carrier_name'));
    const policy = nonEmptyString(form.get('coi_policy_number'));
    const amountRaw = form.get('coi_amount_cents');
    const effectiveRaw = form.get('coi_effective_at');
    const expiresRaw = form.get('coi_expires_at');

    if (!carrier) return { ok: false, error: 'coi_carrier_name is required for kind=coi' };
    if (!policy) return { ok: false, error: 'coi_policy_number is required for kind=coi' };

    const amount = Number(amountRaw);
    if (!Number.isInteger(amount) || amount <= 0) {
        return { ok: false, error: 'coi_amount_cents must be a positive integer' };
    }
    const effective = Number(effectiveRaw);
    const expires = Number(expiresRaw);
    if (!Number.isFinite(effective)) return { ok: false, error: 'coi_effective_at must be epoch ms' };
    if (!Number.isFinite(expires)) return { ok: false, error: 'coi_expires_at must be epoch ms' };
    if (expires <= effective) {
        return { ok: false, error: 'coi_expires_at must be after coi_effective_at' };
    }
    return {
        ok: true,
        coi: { carrier, policy, amount, effective, expires },
    };
}

function validateSuaSignerMetadata(form) {
    const typedName = nonEmptyString(form.get('sua_signer_typed_name'));
    const signerIp = nonEmptyString(form.get('sua_signer_ip'));
    const signerUa = nonEmptyString(form.get('sua_signer_ua'));
    const signedAtRaw = form.get('sua_signed_at');

    if (!typedName) return { ok: false, error: 'sua_signer_typed_name is required for kind=agreement' };
    if (!signerIp) return { ok: false, error: 'sua_signer_ip is required for kind=agreement' };
    if (!signerUa) return { ok: false, error: 'sua_signer_ua is required for kind=agreement' };
    const signedAt = Number(signedAtRaw);
    if (!Number.isFinite(signedAt)) return { ok: false, error: 'sua_signed_at must be epoch ms' };

    return { ok: true, sua: { typedName, signerIp, signerUa, signedAt } };
}

// ────────────────────────────────────────────────────────────────────
// POST / — upload a new document for a rental (multipart)
// ────────────────────────────────────────────────────────────────────

adminFieldRentalDocuments.post('/', requireCapability('field_rentals.documents.upload'), async (c) => {
    const user = c.get('user');
    if (!c.env.UPLOADS) return c.json({ error: 'Uploads bucket not configured' }, 500);

    const contentType = c.req.header('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return c.json({ error: 'Content-Type must be multipart/form-data' }, 400);
    }

    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
        return c.json({ error: 'file field is required' }, 400);
    }
    const rentalId = String(form.get('rental_id') || '').trim();
    if (!rentalId) return c.json({ error: 'rental_id is required' }, 400);
    const kind = String(form.get('kind') || '').trim();
    if (!KINDS.has(kind)) return c.json({ error: `kind must be one of: ${[...KINDS].join(', ')}` }, 400);

    // Rental existence check
    const rental = await fetchRental(c.env, rentalId);
    if (!rental) return c.json({ error: 'rental_id does not exist' }, 400);
    if (rental.archived_at) return c.json({ error: 'Cannot upload to archived rental' }, 409);

    if (file.size > MAX_DOC_BYTES) {
        return c.json({ error: `File too large (${Math.round(file.size / 1024)} KB). Max ${MAX_DOC_BYTES / 1024 / 1024} MB.` }, 413);
    }

    // Magic-byte sniff. Reject Content-Type/format mismatches; canonical
    // content-type is derived from the bytes, not the claim.
    const bytes = await file.arrayBuffer();
    const detectedExt = sniffDocExt(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 32)));
    if (!detectedExt) {
        return c.json({ error: 'File is not a valid PDF, JPEG, PNG, WebP, or GIF' }, 400);
    }
    const canonicalContentType = DOC_MIME[detectedExt];

    // Kind-specific metadata validation
    let coiMeta = null;
    let suaMeta = null;
    let liveSua = null;
    if (kind === 'coi') {
        const r = validateCoiMetadata(form);
        if (!r.ok) return c.json({ error: r.error }, 400);
        coiMeta = r.coi;
    } else if (kind === 'agreement') {
        liveSua = await fetchLiveSua(c.env);
        if (!liveSua) {
            return c.json({
                error: 'No active site-use agreement template — Owner must create one at /admin/site-agreements first',
                hint: 'SUA template management UI lands in a future batch.',
            }, 409);
        }
        const r = validateSuaSignerMetadata(form);
        if (!r.ok) return c.json({ error: r.error }, 400);
        suaMeta = r.sua;
    }

    // Versioning: agreement + coi retire prior live row for the same rental.
    // addendum / correspondence / other are always new rows (no versioning).
    const now = Date.now();
    if (kind === 'agreement' || kind === 'coi') {
        await c.env.DB.prepare(
            `UPDATE field_rental_documents SET retired_at = ?
             WHERE rental_id = ? AND kind = ? AND retired_at IS NULL`,
        ).bind(now, rentalId, kind).run();
    }

    const docId = newDocId();
    const r2Key = `field_rentals/${rentalId}/${docId}.${detectedExt}`;

    try {
        await c.env.UPLOADS.put(r2Key, bytes, {
            httpMetadata: { contentType: canonicalContentType },
        });
    } catch (err) {
        return c.json({ error: 'Storage write failed', detail: String(err?.message || err) }, 500);
    }

    const fileName = (file.name || `upload.${detectedExt}`).slice(0, 200);
    const notes = nonEmptyString(form.get('notes'));

    await c.env.DB.prepare(
        `INSERT INTO field_rental_documents (
            id, rental_id, kind, file_name, r2_key, content_type, bytes,
            coi_carrier_name, coi_policy_number, coi_amount_cents,
            coi_effective_at, coi_expires_at,
            sua_document_id, sua_body_sha256_snapshot,
            sua_signer_typed_name, sua_signer_ip, sua_signer_ua, sua_signed_at,
            uploaded_by_user_id, uploaded_at, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        docId, rentalId, kind, fileName, r2Key, canonicalContentType, file.size,
        coiMeta?.carrier ?? null, coiMeta?.policy ?? null, coiMeta?.amount ?? null,
        coiMeta?.effective ?? null, coiMeta?.expires ?? null,
        liveSua?.id ?? null, liveSua?.body_sha256 ?? null,
        suaMeta?.typedName ?? null, suaMeta?.signerIp ?? null, suaMeta?.signerUa ?? null, suaMeta?.signedAt ?? null,
        user.id, now, notes,
    ).run();

    // Denormalized rental-side aggregate sync.
    if (kind === 'coi' && coiMeta) {
        await c.env.DB.prepare(
            `UPDATE field_rentals
             SET coi_status = 'received', coi_expires_at = ?, requirements_coi_received = 1,
                 updated_at = ?
             WHERE id = ?`,
        ).bind(coiMeta.expires, now, rentalId).run();
    } else if (kind === 'agreement') {
        await c.env.DB.prepare(
            `UPDATE field_rentals
             SET requirements_agreement_signed = 1, updated_at = ?
             WHERE id = ?`,
        ).bind(now, rentalId).run();
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_document.uploaded',
        targetType: 'field_rental_document',
        targetId: docId,
        meta: {
            rentalId, kind, fileName, bytes: file.size, contentType: canonicalContentType,
            ...(coiMeta ? { coiExpiresAt: coiMeta.expires } : {}),
            ...(suaMeta ? { suaDocumentId: liveSua.id, suaBodySha256: liveSua.body_sha256 } : {}),
        },
    });

    const row = await fetchDocument(c.env, docId);
    return c.json({
        document: formatDocument(row, { viewerCanSeeCoiPII: hasCapability(user, 'field_rentals.coi.read_pii') }),
    }, 201);
});

// ────────────────────────────────────────────────────────────────────
// GET /?rental_id=… — list documents for a rental
// ────────────────────────────────────────────────────────────────────

adminFieldRentalDocuments.get('/', requireCapability('field_rentals.documents.read'), async (c) => {
    const user = c.get('user');
    const url = new URL(c.req.url);
    const rentalId = url.searchParams.get('rental_id');
    if (!rentalId) return c.json({ error: 'rental_id query parameter required' }, 400);
    const kindFilter = url.searchParams.get('kind');
    const includeRetired = url.searchParams.get('include_retired') === '1';

    const where = ['rental_id = ?'];
    const binds = [rentalId];
    if (kindFilter && KINDS.has(kindFilter)) {
        where.push('kind = ?');
        binds.push(kindFilter);
    }
    if (!includeRetired) {
        where.push('retired_at IS NULL');
    }

    const res = await c.env.DB.prepare(
        `SELECT * FROM field_rental_documents WHERE ${where.join(' AND ')}
         ORDER BY uploaded_at DESC`,
    ).bind(...binds).all();

    const viewerCanSeeCoiPII = hasCapability(user, 'field_rentals.coi.read_pii');
    return c.json({
        documents: (res.results || []).map((row) => formatDocument(row, { viewerCanSeeCoiPII })),
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /:docId — metadata only
// ────────────────────────────────────────────────────────────────────

adminFieldRentalDocuments.get('/:docId', requireCapability('field_rentals.documents.read'), async (c) => {
    const user = c.get('user');
    const docId = c.req.param('docId');

    const row = await fetchDocument(c.env, docId);
    if (!row) return c.json({ error: 'Document not found' }, 404);

    return c.json({
        document: formatDocument(row, { viewerCanSeeCoiPII: hasCapability(user, 'field_rentals.coi.read_pii') }),
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /:docId/download — streamed R2 bytes
// ────────────────────────────────────────────────────────────────────

adminFieldRentalDocuments.get('/:docId/download', requireCapability('field_rentals.documents.read'), async (c) => {
    const user = c.get('user');
    const docId = c.req.param('docId');

    const row = await fetchDocument(c.env, docId);
    if (!row) return c.json({ error: 'Document not found' }, 404);

    if (!c.env.UPLOADS) return c.json({ error: 'Uploads bucket not configured' }, 500);
    const obj = await c.env.UPLOADS.get(row.r2_key);
    if (!obj) return c.json({ error: 'Document file missing from storage' }, 404);

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_document.downloaded',
        targetType: 'field_rental_document',
        targetId: docId,
        meta: { rentalId: row.rental_id, kind: row.kind, r2Key: row.r2_key },
        ipAddress: clientIp(c),
    });

    return new Response(obj.body, {
        headers: {
            'content-type': row.content_type,
            'content-disposition': `attachment; filename="${row.file_name.replace(/"/g, '')}"`,
            'cache-control': 'private, no-store',
        },
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:docId/retire — manually retire (no replacement)
// ────────────────────────────────────────────────────────────────────

adminFieldRentalDocuments.post('/:docId/retire', requireCapability('field_rentals.documents.upload'), async (c) => {
    const user = c.get('user');
    const docId = c.req.param('docId');

    const row = await fetchDocument(c.env, docId);
    if (!row) return c.json({ error: 'Document not found' }, 404);
    if (row.retired_at) return c.json({ error: 'Document already retired' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE field_rental_documents SET retired_at = ? WHERE id = ?`,
    ).bind(now, docId).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_document.retired',
        targetType: 'field_rental_document',
        targetId: docId,
        meta: { rentalId: row.rental_id, kind: row.kind },
    });

    return c.json({ retired: true });
});

export default adminFieldRentalDocuments;
