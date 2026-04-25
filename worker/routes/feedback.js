// Public feedback submission. Rate-limited, honeypot-guarded, no auth required.
// Admin-notify email fires on every submission via existing template system.
//
// Optional screenshot attachment: uploaded separately via POST /attachment,
// then the returned URL is submitted alongside the ticket body.

import { Hono } from 'hono';
import { rateLimit, clientIp } from '../lib/rateLimit.js';
import { feedbackId, randomId } from '../lib/ids.js';
import { sendFeedbackNotification } from '../lib/emailSender.js';
import { sniffImageExt, IMAGE_MIME } from '../lib/magicBytes.js';

const feedback = new Hono();

const ALLOWED_TYPES = new Set(['bug', 'feature', 'usability', 'other']);
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 2000;
const MAX_EMAIL = 254;
const MAX_URL = 500;
const MAX_UA = 500;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
const ATTACHMENT_PREFIX = 'feedback'; // R2 key prefix

const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

async function hashIp(ip, secret) {
    if (!ip || !secret) return null;
    try {
        const data = new TextEncoder().encode(`${secret}:${ip}`);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return null;
    }
}

// POST /api/feedback/attachment — multipart/form-data { file }
// Upload a screenshot. Returns { url, bytes }. Referenced by attachmentUrl
// on the subsequent POST /api/feedback submission.
feedback.post('/attachment', rateLimit('RL_FEEDBACK_UPLOAD'), async (c) => {
    if (!c.env.UPLOADS) return c.json({ error: 'Uploads not configured' }, 500);
    const ct = c.req.header('content-type') || '';
    if (!ct.includes('multipart/form-data')) {
        return c.json({ error: 'Content-Type must be multipart/form-data' }, 400);
    }

    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: 'Invalid multipart body' }, 400);
    const file = form.get('file');
    if (!file || typeof file === 'string') return c.json({ error: 'file field is required' }, 400);

    const claimedType = file.type || 'application/octet-stream';
    const claimedExt = MIME_TO_EXT[claimedType];
    if (!claimedExt) {
        return c.json({ error: `Unsupported type: ${claimedType}. Allowed: JPEG, PNG, WebP, GIF` }, 400);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
        return c.json({ error: `File too large (${Math.round(file.size / 1024)} KB). Max 5 MB.` }, 413);
    }

    const bytes = await file.arrayBuffer();
    const detectedExt = sniffImageExt(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 32)));
    if (!detectedExt) {
        return c.json({ error: 'File is not a valid JPEG, PNG, WebP, or GIF' }, 400);
    }
    if (detectedExt !== claimedExt) {
        return c.json({ error: `Content-Type (${claimedType}) does not match the file's actual format (${detectedExt}).` }, 400);
    }

    const canonicalType = IMAGE_MIME[detectedExt];
    const key = `${ATTACHMENT_PREFIX}/${randomId(16)}.${detectedExt}`;

    await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: canonicalType } });

    const url = `${c.env.SITE_URL || ''}/uploads/${key}`;
    return c.json({ url, bytes: file.size, contentType: canonicalType }, 201);
});

// Validate a submitted attachmentUrl: must be same-origin + in the feedback/ prefix.
// Returns the R2 key if valid, null otherwise.
function resolveAttachmentKey(url, siteUrl) {
    if (!url || typeof url !== 'string') return null;
    const prefix = `${siteUrl}/uploads/`;
    if (!url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    // Must live under feedback/ and match serveable extensions.
    if (!/^feedback\/[a-zA-Z0-9_-]+\.(jpg|png|webp|gif)$/.test(key)) return null;
    return key;
}

feedback.post('/', rateLimit('RL_FEEDBACK'), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return c.json({ error: 'Invalid body' }, 400);
    }

    // Honeypot: if the bot field is filled, silently accept (do not store, do not email).
    if (body.website && String(body.website).trim()) {
        return c.json({ ok: true, id: 'hp' });
    }

    const type = String(body.type || '').toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
        return c.json({ error: 'Invalid type' }, 400);
    }

    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    if (!title || title.length > MAX_TITLE) {
        return c.json({ error: `Title required, ≤${MAX_TITLE} chars` }, 400);
    }
    if (!description || description.length > MAX_DESCRIPTION) {
        return c.json({ error: `Description required, ≤${MAX_DESCRIPTION} chars` }, 400);
    }

    let email = body.email != null ? String(body.email).trim() : '';
    if (email) {
        if (email.length > MAX_EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return c.json({ error: 'Invalid email' }, 400);
        }
    } else {
        email = null;
    }

    const pageUrl = body.pageUrl ? String(body.pageUrl).slice(0, MAX_URL) : null;
    const userAgent = body.userAgent ? String(body.userAgent).slice(0, MAX_UA) : null;
    const viewport = body.viewport ? String(body.viewport).slice(0, 20) : null;
    const ipHash = await hashIp(clientIp(c), c.env.SESSION_SECRET);

    // Validate attachment: must be same-origin under feedback/.
    let attachmentUrl = null;
    let attachmentSize = null;
    if (body.attachmentUrl) {
        const key = resolveAttachmentKey(body.attachmentUrl, c.env.SITE_URL || '');
        if (!key) return c.json({ error: 'Invalid attachment URL' }, 400);
        attachmentUrl = body.attachmentUrl;
        attachmentSize = typeof body.attachmentSize === 'number' ? body.attachmentSize : null;
    }

    const id = feedbackId();
    const now = Date.now();

    await c.env.DB.prepare(
        `INSERT INTO feedback
         (id, type, title, description, email, page_url, user_agent, viewport, ip_hash,
          attachment_url, attachment_size_bytes, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'medium', ?, ?)`
    ).bind(
        id, type, title, description, email, pageUrl, userAgent, viewport, ipHash,
        attachmentUrl, attachmentSize, now, now,
    ).run();

    // Best-effort admin notify — never block the response on email failure.
    c.executionCtx.waitUntil(
        sendFeedbackNotification(c.env, {
            feedback: {
                id, type, title, description, email,
                page_url: pageUrl, user_agent: userAgent, viewport,
                attachment_url: attachmentUrl,
            },
        }).catch((err) => console.error('feedback email failed', err)),
    );

    return c.json({ ok: true, id });
});

export default feedback;
