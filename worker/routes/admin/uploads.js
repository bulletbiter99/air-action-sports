import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { clientIp } from '../../lib/rateLimit.js';

const adminUploads = new Hono();
adminUploads.use('*', requireAuth);

const MAX_BYTES = 5 * 1024 * 1024;            // 5 MB for images
const MAX_DOC_BYTES = 10 * 1024 * 1024;       // 10 MB for vendor docs (PDFs often larger)
const ALLOWED_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};
const ALLOWED_DOC_TYPES = {
    ...ALLOWED_TYPES,
    'application/pdf': 'pdf',
};
const DOC_KINDS = ['admin_asset', 'coi', 'w9'];

// Sniff the file's actual format from its first 12 bytes. Returns the
// canonical extension on match, or null. Prevents an admin/manager from
// relabelling an HTML or SVG payload as image/png (which would become a
// stored-XSS primitive once served from the same origin as the admin cookie).
function sniffImageExt(bytes) {
    if (bytes.length < 4) return null;
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'png';
    }
    // GIF: "GIF87a" or "GIF89a"
    if (bytes.length >= 6 &&
        bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
        return 'gif';
    }
    // WebP: "RIFF....WEBP"
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'webp';
    }
    return null;
}

// Same idea, extended for PDFs. PDF magic = "%PDF-" at offset 0 per ISO
// 32000-1 §7.5.2 (some implementations tolerate up to 1024 bytes of leading
// whitespace, but every mainstream generator emits it at offset 0 — we don't
// accept the leniency so a polyglot prefix can't sneak through).
function sniffDocExt(bytes) {
    const image = sniffImageExt(bytes);
    if (image) return image;
    if (bytes.length >= 5 &&
        bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
        bytes[3] === 0x46 && bytes[4] === 0x2d) {
        return 'pdf';
    }
    return null;
}

const CANONICAL_DOC_MIME = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    pdf: 'application/pdf',
};

// POST /api/admin/uploads/image — multipart/form-data { file }
// Stores in R2 under `events/<random>.<ext>`, returns a public URL served by
// this same Worker at `/uploads/<key>` (see worker/index.js).
adminUploads.post('/image', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    if (!c.env.UPLOADS) return c.json({ error: 'Uploads bucket not configured' }, 500);

    const contentType = c.req.header('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return c.json({ error: 'Content-Type must be multipart/form-data' }, 400);
    }

    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return c.json({ error: 'file field is required' }, 400);

    const claimedType = file.type || 'application/octet-stream';
    const claimedExt = ALLOWED_TYPES[claimedType];
    if (!claimedExt) {
        return c.json({ error: `Unsupported type: ${claimedType}. Allowed: JPEG, PNG, WebP, GIF` }, 400);
    }
    if (file.size > MAX_BYTES) {
        return c.json({ error: `File too large (${Math.round(file.size / 1024)} KB). Max 5 MB.` }, 413);
    }

    // Sniff magic bytes to verify the file is actually the image format it
    // claims to be. Rejects polyglots and relabelled HTML/SVG payloads.
    const bytes = await file.arrayBuffer();
    const detectedExt = sniffImageExt(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 32)));
    if (!detectedExt) {
        return c.json({ error: 'File is not a valid JPEG, PNG, WebP, or GIF' }, 400);
    }
    if (detectedExt !== claimedExt) {
        return c.json({
            error: `Content-Type (${claimedType}) does not match the file's actual format (${detectedExt}).`,
        }, 400);
    }
    const ext = detectedExt; // trust bytes, not the header

    // Canonical Content-Type inferred from the verified format, not from
    // whatever the uploader claimed.
    const canonicalType = {
        jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    }[ext];

    const prefix = form.get('prefix') || 'events';
    const safePrefix = String(prefix).replace(/[^a-z0-9/_-]/gi, '').slice(0, 40) || 'events';
    const key = `${safePrefix}/${randomId(16)}.${ext}`;

    await c.env.UPLOADS.put(key, bytes, {
        httpMetadata: { contentType: canonicalType },
    });

    const url = `${c.env.SITE_URL || ''}/uploads/${key}`;

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'upload.created', 'upload', ?, ?, ?)`
    ).bind(user.id, key, JSON.stringify({
        size: file.size,
        claimed_type: claimedType,
        detected_type: canonicalType,
        original_name: file.name || null,
    }), Date.now()).run();

    return c.json({ key, url, bytes: file.size, contentType: canonicalType }, 201);
});

// POST /api/admin/uploads/vendor-doc — multipart/form-data
// Fields: file, kind (admin_asset|coi|w9), + one of event_vendor_id OR
// vendor_id. Creates a vendor_documents row; R2 object stored under
// `vendors/...`. The vendor-facing side serves these through a token-gated
// Worker route (see worker/routes/vendor.js) — they are NOT reachable via
// the public /uploads/:key path.
adminUploads.post('/vendor-doc', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    if (!c.env.UPLOADS) return c.json({ error: 'Uploads bucket not configured' }, 500);

    const contentType = c.req.header('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return c.json({ error: 'Content-Type must be multipart/form-data' }, 400);
    }

    const form = await c.req.formData();
    const file = form.get('file');
    const kind = String(form.get('kind') || '').trim();
    const event_vendor_id = String(form.get('event_vendor_id') || '').trim() || null;
    const vendor_id = String(form.get('vendor_id') || '').trim() || null;

    if (!file || typeof file === 'string') return c.json({ error: 'file field is required' }, 400);
    if (!DOC_KINDS.includes(kind)) return c.json({ error: `kind must be one of ${DOC_KINDS.join(', ')}` }, 400);
    if (!event_vendor_id && !vendor_id) {
        return c.json({ error: 'Must supply event_vendor_id or vendor_id' }, 400);
    }

    const claimedType = file.type || 'application/octet-stream';
    const claimedExt = ALLOWED_DOC_TYPES[claimedType];
    if (!claimedExt) {
        return c.json({
            error: `Unsupported type: ${claimedType}. Allowed: PDF, JPEG, PNG, WebP, GIF`,
        }, 400);
    }
    if (file.size > MAX_DOC_BYTES) {
        return c.json({ error: `File too large (${Math.round(file.size / 1024)} KB). Max 10 MB.` }, 413);
    }

    const bytes = await file.arrayBuffer();
    const detectedExt = sniffDocExt(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 32)));
    if (!detectedExt) {
        return c.json({ error: 'File is not a valid PDF or image' }, 400);
    }
    if (detectedExt !== claimedExt) {
        return c.json({
            error: `Content-Type (${claimedType}) does not match the file's actual format (${detectedExt}).`,
        }, 400);
    }
    const ext = detectedExt;
    const canonicalType = CANONICAL_DOC_MIME[ext];

    // Validate the scope references. Rejecting up front avoids a dangling R2
    // object if the DB insert later fails.
    if (event_vendor_id) {
        const ok = await c.env.DB.prepare('SELECT id FROM event_vendors WHERE id = ?').bind(event_vendor_id).first();
        if (!ok) return c.json({ error: 'event_vendor_id not found' }, 404);
    }
    if (vendor_id) {
        const ok = await c.env.DB.prepare('SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL').bind(vendor_id).first();
        if (!ok) return c.json({ error: 'vendor_id not found' }, 404);
    }

    // Scope prefix lets an R2 lifecycle rule later purge revoked packages
    // wholesale without touching vendor-level master docs.
    const scope = event_vendor_id ? `packages/${event_vendor_id}` : `vendors/${vendor_id}`;
    const key = `vendors/${scope}/${randomId(16)}.${ext}`;

    await c.env.UPLOADS.put(key, bytes, {
        httpMetadata: { contentType: canonicalType },
    });

    const docId = `vdoc_${randomId(14)}`;
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO vendor_documents (
            id, event_vendor_id, vendor_id, r2_key, filename, content_type,
            byte_size, uploaded_by_user_id, kind, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        docId,
        event_vendor_id,
        vendor_id,
        key,
        (file.name || `upload.${ext}`).slice(0, 200),
        canonicalType,
        file.size,
        user.id,
        kind,
        now,
    ).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (?, 'vendor_document.created', 'vendor_document', ?, ?, ?, ?)`
    ).bind(
        user.id, docId,
        JSON.stringify({ event_vendor_id, vendor_id, kind, byte_size: file.size, r2_key: key }),
        clientIp(c), now,
    ).run();

    return c.json({
        id: docId,
        eventVendorId: event_vendor_id,
        vendorId: vendor_id,
        filename: file.name || null,
        contentType: canonicalType,
        byteSize: file.size,
        kind,
    }, 201);
});

// DELETE /api/admin/uploads/vendor-doc/:id
adminUploads.delete('/vendor-doc/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM vendor_documents WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    try { await c.env.UPLOADS.delete(row.r2_key); }
    catch (err) { console.error('R2 delete failed, proceeding with DB row removal', err); }
    await c.env.DB.prepare('DELETE FROM vendor_documents WHERE id = ?').bind(id).run();
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (?, 'vendor_document.deleted', 'vendor_document', ?, ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ r2_key: row.r2_key }), clientIp(c), Date.now()).run();
    return c.json({ ok: true });
});

export default adminUploads;
