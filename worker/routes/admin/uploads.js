import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';

const adminUploads = new Hono();
adminUploads.use('*', requireAuth);

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

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

export default adminUploads;
