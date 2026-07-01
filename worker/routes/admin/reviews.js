// Admin review moderation (attendee-verified reviews, 0077, Batch 5).
// List + hide/unhide (takedown). Reviews AUTO-PUBLISH on submit (public route);
// this surface is the ONLY way to pull one back. A hidden review (status='hidden')
// drops out of every public feed + SSR aggregate instantly — they all filter
// status='published'.
//
// Gated by the reviews.moderate capability (migration 0077 binds it to owner +
// event_director + booking_coordinator). Reading reviews publicly needs no cap;
// only moderation is gated. Admin-only fields (email, ip_hash, booking_id) are
// returned ONLY here, behind that cap.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { clientIp } from '../../lib/rateLimit.js';

const adminReviews = new Hono();
adminReviews.use('*', requireAuth);
adminReviews.use('*', requireCapability('reviews.moderate'));

const MAX_REASON = 500;

function rowToDto(r) {
    return {
        id: r.id,
        event: { id: r.event_id, title: r.event_title || null, slug: r.event_slug || null },
        bookingId: r.booking_id,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        authorName: r.author_name,
        email: r.email,            // admin-only (contact / verify)
        verified: !!r.verified,
        status: r.status,
        hiddenAt: r.hidden_at,
        hiddenReason: r.hidden_reason,
        hiddenBy: r.hidden_by,
        editCount: r.edit_count,
        ipHash: r.ip_hash,         // admin-only (abuse forensics)
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        // Surfaced so the operator can spot a live review whose booking was later
        // refunded/cancelled (possible sabotage) and take it down manually.
        bookingFlag: (r.booking_status === 'refunded' || r.booking_status === 'cancelled') ? r.booking_status : null,
    };
}

// GET /api/admin/reviews — list with filters + a status/rating summary.
adminReviews.get('/', async (c) => {
    const url = new URL(c.req.url);
    const eventId = url.searchParams.get('event_id')?.trim();
    const status = url.searchParams.get('status')?.trim();
    const ratingRaw = url.searchParams.get('rating')?.trim();
    const q = url.searchParams.get('q')?.trim();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    const where = [];
    const binds = [];
    if (eventId) { where.push('r.event_id = ?'); binds.push(eventId); }
    if (status === 'published' || status === 'hidden') { where.push('r.status = ?'); binds.push(status); }
    const rating = Number(ratingRaw);
    if (ratingRaw && Number.isInteger(rating) && rating >= 1 && rating <= 5) { where.push('r.rating = ?'); binds.push(rating); }
    if (q) {
        where.push('(r.title LIKE ? OR r.comment LIKE ? OR r.author_name LIKE ?)');
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let items = [];
    let total = 0;
    let summary = { published: 0, hidden: 0, total: 0, average: null };
    try {
        const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM reviews r ${whereSQL}`).bind(...binds).first();
        total = countRow?.n ?? 0;

        const rows = await c.env.DB.prepare(
            `SELECT r.*, e.title AS event_title, e.slug AS event_slug, b.status AS booking_status
             FROM reviews r
             LEFT JOIN events e ON e.id = r.event_id
             LEFT JOIN bookings b ON b.id = r.booking_id
             ${whereSQL}
             ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
        ).bind(...binds, limit, offset).all();
        items = (rows?.results || []).map(rowToDto);

        // Unfiltered summary (drives the stat cards).
        const sum = await c.env.DB.prepare(
            `SELECT
                SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
                SUM(CASE WHEN status = 'hidden' THEN 1 ELSE 0 END) AS hidden,
                COUNT(*) AS total,
                ROUND(AVG(CASE WHEN status = 'published' THEN rating END), 1) AS average
             FROM reviews`
        ).first();
        summary = {
            published: sum?.published ?? 0,
            hidden: sum?.hidden ?? 0,
            total: sum?.total ?? 0,
            average: sum?.published ? sum.average : null,
        };
    } catch (err) {
        // Table missing (pre-migration) — degrade to an empty list, don't 500.
        console.error('admin reviews list failed', err);
    }

    return c.json({ total, limit, offset, summary, items });
});

// PUT /api/admin/reviews/:id — { action: 'hide' | 'unhide', reason? }
adminReviews.put('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body || (body.action !== 'hide' && body.action !== 'unhide')) {
        return c.json({ error: "action must be 'hide' or 'unhide'" }, 400);
    }

    const existing = await c.env.DB.prepare(`SELECT * FROM reviews WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const now = Date.now();
    if (body.action === 'hide') {
        const reason = body.reason == null ? null : String(body.reason).slice(0, MAX_REASON);
        await c.env.DB.prepare(
            `UPDATE reviews SET status = 'hidden', hidden_at = ?, hidden_reason = ?, hidden_by = ?, updated_at = ? WHERE id = ?`
        ).bind(now, reason, user.id, now, id).run();
        await writeAudit(c.env, {
            userId: user.id, action: 'review.hidden', targetType: 'review', targetId: id,
            meta: { reason, rating: existing.rating, event_id: existing.event_id }, ipAddress: clientIp(c),
        });
    } else {
        await c.env.DB.prepare(
            `UPDATE reviews SET status = 'published', hidden_at = NULL, hidden_reason = NULL, hidden_by = NULL, updated_at = ? WHERE id = ?`
        ).bind(now, id).run();
        await writeAudit(c.env, {
            userId: user.id, action: 'review.unhidden', targetType: 'review', targetId: id,
            meta: { rating: existing.rating, event_id: existing.event_id }, ipAddress: clientIp(c),
        });
    }

    const updated = await c.env.DB.prepare(
        `SELECT r.*, e.title AS event_title, e.slug AS event_slug, b.status AS booking_status
         FROM reviews r
         LEFT JOIN events e ON e.id = r.event_id
         LEFT JOIN bookings b ON b.id = r.booking_id
         WHERE r.id = ?`
    ).bind(id).first();
    return c.json({ item: rowToDto(updated) });
});

export default adminReviews;
