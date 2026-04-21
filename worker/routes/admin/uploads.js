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

    const type = file.type || 'application/octet-stream';
    const ext = ALLOWED_TYPES[type];
    if (!ext) {
        return c.json({ error: `Unsupported type: ${type}. Allowed: JPEG, PNG, WebP, GIF` }, 400);
    }
    if (file.size > MAX_BYTES) {
        return c.json({ error: `File too large (${Math.round(file.size / 1024)} KB). Max 5 MB.` }, 413);
    }

    const prefix = form.get('prefix') || 'events';
    const safePrefix = String(prefix).replace(/[^a-z0-9/_-]/gi, '').slice(0, 40) || 'events';
    const key = `${safePrefix}/${randomId(16)}.${ext}`;

    const bytes = await file.arrayBuffer();
    await c.env.UPLOADS.put(key, bytes, {
        httpMetadata: { contentType: type },
    });

    const url = `${c.env.SITE_URL || ''}/uploads/${key}`;

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'upload.created', 'upload', ?, ?, ?)`
    ).bind(user.id, key, JSON.stringify({ size: file.size, type, original_name: file.name || null }), Date.now()).run();

    return c.json({ key, url, bytes: file.size, contentType: type }, 201);
});

export default adminUploads;
