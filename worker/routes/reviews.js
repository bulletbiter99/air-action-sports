// Public attendee-verified reviews API (migration 0077, Batch 3).
//
// Flow: the 03:00 review-invite cron (worker/lib/reviewInvites.js) emails each
// paid/comp booking a link /review?token=<review_token>. The token is the gate
// — possessing it proves attendance. ONE review per booking; reviews AUTO-PUBLISH
// on submit; admins can hide them (Batch 5). A hidden review (status='hidden')
// drops out of every public feed + aggregate instantly.
//
// PUBLISH-INDEPENDENCE (important — deviates from the original spec's 410 rule):
// review visibility is gated by the REVIEW's status='published', NOT by the
// event's `published` flag. AAS unpublishes most past events, and the invite
// cron runs ~24h AFTER an event ends, so requiring event.published=1 here would
// make the whole feature dead-on-arrival (no one could review, nothing would
// show). So /context + POST resolve by token regardless of event publish, and
// the public feeds show all published reviews joined to their event for display.
//
// Public output is whitelisted: id, rating, title, comment, authorName,
// publishedAt (+ event{slug,title} where relevant). NEVER booking_id, raw
// event_id, email, ip_hash, status, hidden_*. (A test asserts the whitelist.)

import { Hono } from 'hono';
import { rateLimit, clientIp } from '../lib/rateLimit.js';
import { reviewId } from '../lib/ids.js';

const reviews = new Hono();

const MIN_RATING = 1;
const MAX_RATING = 5;
const MAX_TITLE = 120;
const MAX_COMMENT = 2000;
const MAX_AUTHOR = 60;
const MAX_LIST_LIMIT = 50;
const REVIEW_TOKEN_LEN = 40;            // matches reviewToken() in worker/lib/ids.js
const TOKEN_RE = new RegExp(`^[0-9A-Za-z]{${REVIEW_TOKEN_LEN}}$`);
const EDIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;   // author may fix their review for 30 days
const MAX_EDITS = 3;                                // ...up to 3 times, then immutable
const SUBMIT_ELIGIBLE_STATUSES = new Set(['paid', 'comp']);

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

// Public display name default: first name + last initial ("Jane D."). The
// reviewer can override it on the form (≤60 chars). Never exposes the full name.
function defaultAuthorName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Anonymous';
    if (parts.length === 1) return parts[0].slice(0, MAX_AUTHOR);
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`.slice(0, MAX_AUTHOR);
}

function ineligibleReason(status) {
    if (status === 'pending') return 'Payment for this booking is still pending.';
    if (status === 'refunded') return 'This booking was refunded.';
    if (status === 'cancelled') return 'This booking was cancelled.';
    return 'This booking is not eligible for a review.';
}

// Whitelisted public projection — the ONLY shape any public endpoint returns.
function publicReview(row) {
    return {
        id: row.id,
        rating: row.rating,
        title: row.title || null,
        comment: row.comment || null,
        authorName: row.author_name,
        publishedAt: row.created_at,
    };
}

function publicReviewWithEvent(row) {
    return {
        ...publicReview(row),
        event: { slug: row.event_slug || null, title: row.event_title || null },
    };
}

function clampLimit(raw, fallback) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(n, MAX_LIST_LIMIT);
}

function clampOffset(raw) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

// Resolve a review token → its booking + event. Returns null when the token is
// unknown. NOT gated on event.published (see PUBLISH-INDEPENDENCE above).
async function resolveByToken(env, token) {
    return env.DB.prepare(
        `SELECT b.id AS booking_id, b.full_name, b.email, b.status, b.event_id,
                e.slug AS event_slug, e.title AS event_title, e.display_date AS event_display_date
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.review_token = ?`
    ).bind(token).first();
}

async function existingReviewFor(env, bookingId) {
    return env.DB.prepare(`SELECT * FROM reviews WHERE booking_id = ?`).bind(bookingId).first();
}

function isEditable(review, now) {
    return !!review
        && review.status === 'published'
        && (now - review.created_at) < EDIT_WINDOW_MS
        && review.edit_count < MAX_EDITS;
}

// ─── GET /api/reviews/context?token=… — resolve the link to render the form ───
reviews.get('/context', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    const token = c.req.query('token') || '';
    if (!TOKEN_RE.test(token)) return c.json({ error: 'Invalid or missing review link.' }, 400);

    const row = await resolveByToken(c.env, token);
    if (!row) return c.json({ error: 'This review link is not valid.' }, 404);

    const eligible = SUBMIT_ELIGIBLE_STATUSES.has(row.status);
    const existing = await existingReviewFor(c.env, row.booking_id);
    const now = Date.now();

    return c.json({
        eligible,
        reason: eligible ? null : ineligibleReason(row.status),
        alreadyReviewed: !!existing,
        editable: isEditable(existing, now),
        event: { slug: row.event_slug, title: row.event_title, displayDate: row.event_display_date },
        suggestedAuthorName: defaultAuthorName(row.full_name),
        existingReview: existing
            ? { rating: existing.rating, title: existing.title || null, comment: existing.comment || null, authorName: existing.author_name }
            : null,
    });
});

// ─── POST /api/reviews — submit or edit (auto-publish) ───
reviews.post('/', rateLimit('RL_FEEDBACK'), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'Invalid body' }, 400);

    // Honeypot — distinct field name from the feedback form's `website`.
    if (body.company && String(body.company).trim()) return c.json({ ok: true, id: 'hp' }, 200);

    const token = String(body.token || '');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'Invalid or missing review link.' }, 400);

    const rating = body.rating;
    if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
        return c.json({ error: `Rating must be a whole number ${MIN_RATING}-${MAX_RATING}.` }, 400);
    }
    const title = body.title != null ? String(body.title).trim() : '';
    const comment = body.comment != null ? String(body.comment).trim() : '';
    if (title.length > MAX_TITLE) return c.json({ error: `Title must be ≤${MAX_TITLE} characters.` }, 400);
    if (comment.length > MAX_COMMENT) return c.json({ error: `Review must be ≤${MAX_COMMENT} characters.` }, 400);
    let authorName = body.authorName != null ? String(body.authorName).trim() : '';
    if (authorName.length > MAX_AUTHOR) return c.json({ error: `Name must be ≤${MAX_AUTHOR} characters.` }, 400);

    const row = await resolveByToken(c.env, token);
    if (!row) return c.json({ error: 'This review link is not valid.' }, 404);
    if (!SUBMIT_ELIGIBLE_STATUSES.has(row.status)) {
        return c.json({ error: ineligibleReason(row.status) }, 403);
    }

    if (!authorName) authorName = defaultAuthorName(row.full_name);
    const now = Date.now();
    const existing = await existingReviewFor(c.env, row.booking_id);

    if (existing) {
        if (existing.status === 'hidden') {
            return c.json({ error: 'This review is no longer editable.', reviewId: existing.id }, 409);
        }
        if (!isEditable(existing, now)) {
            return c.json({ error: 'This review can no longer be edited.', reviewId: existing.id }, 409);
        }
        await c.env.DB.prepare(
            `UPDATE reviews SET rating = ?, title = ?, comment = ?, author_name = ?,
                    edit_count = edit_count + 1, updated_at = ?
             WHERE id = ?`
        ).bind(rating, title || null, comment || null, authorName, now, existing.id).run();
        return c.json({ ok: true, id: existing.id, status: 'published', edited: true }, 200);
    }

    const id = reviewId();
    const ipHash = await hashIp(clientIp(c), c.env.SESSION_SECRET);
    try {
        await c.env.DB.prepare(
            `INSERT INTO reviews
             (id, event_id, booking_id, rating, title, comment, author_name, email,
              verified, status, hidden_at, hidden_reason, hidden_by, edit_count, ip_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'published', NULL, NULL, NULL, 0, ?, ?, ?)`
        ).bind(id, row.event_id, row.booking_id, rating, title || null, comment || null, authorName, row.email, ipHash, now, now).run();
    } catch (err) {
        // UNIQUE(booking_id) race (double-submit) — the first write won. Return
        // the existing review idempotently rather than a confusing 409.
        const raced = await existingReviewFor(c.env, row.booking_id);
        if (raced) return c.json({ ok: true, id: raced.id, status: 'published', edited: false }, 200);
        console.error('review insert failed', err);
        return c.json({ error: 'Could not save your review. Please try again.' }, 500);
    }

    // Best-effort audit (guarded; never blocks or fails the response).
    try {
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (NULL, 'review.submitted', 'review', ?, ?, ?)`
        ).bind(id, JSON.stringify({ event_id: row.event_id, booking_id: row.booking_id, rating }), now).run();
    } catch (auditErr) {
        console.error('review.submitted audit failed', auditErr);
    }

    return c.json({ ok: true, id, status: 'published', edited: false }, 201);
});

// ─── GET /api/reviews?event=<slug|id>&limit&offset — one event's public feed ───
reviews.get('/', async (c) => {
    const eventParam = c.req.query('event');
    if (!eventParam) return c.json({ error: 'event query param required' }, 400);
    const limit = clampLimit(c.req.query('limit'), 20);
    const offset = clampOffset(c.req.query('offset'));

    const ev = await c.env.DB.prepare(
        `SELECT id, slug, title FROM events WHERE id = ? OR slug = ? LIMIT 1`
    ).bind(eventParam, eventParam).first();
    if (!ev) return c.json({ error: 'Event not found' }, 404);

    const agg = await c.env.DB.prepare(
        `SELECT ROUND(AVG(rating), 1) AS average, COUNT(*) AS count
         FROM reviews WHERE event_id = ? AND status = 'published'`
    ).bind(ev.id).first();

    const rowsRes = await c.env.DB.prepare(
        `SELECT id, rating, title, comment, author_name, created_at
         FROM reviews WHERE event_id = ? AND status = 'published'
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(ev.id, limit, offset).all();

    return c.json({
        event: { id: ev.id, slug: ev.slug, title: ev.title },
        average: agg?.count ? agg.average : null,
        count: agg?.count || 0,
        limit,
        offset,
        reviews: (rowsRes?.results || []).map(publicReview),
    });
});

// ─── GET /api/reviews/summary?recent&perEvent — home + structured-data feed ───
reviews.get('/summary', async (c) => {
    const recentLimit = clampLimit(c.req.query('recent'), 6);

    const overall = await c.env.DB.prepare(
        `SELECT ROUND(AVG(rating), 1) AS average, COUNT(*) AS count FROM reviews WHERE status = 'published'`
    ).first();

    const recentRes = await c.env.DB.prepare(
        `SELECT r.id, r.rating, r.title, r.comment, r.author_name, r.created_at,
                e.slug AS event_slug, e.title AS event_title
         FROM reviews r JOIN events e ON e.id = r.event_id
         WHERE r.status = 'published'
         ORDER BY r.created_at DESC LIMIT ?`
    ).bind(recentLimit).all();

    const payload = {
        overall: { average: overall?.count ? overall.average : null, count: overall?.count || 0 },
        recent: (recentRes?.results || []).map(publicReviewWithEvent),
    };

    if (c.req.query('perEvent') === '1') {
        const perRes = await c.env.DB.prepare(
            `SELECT e.id AS event_id, e.slug AS event_slug, e.title AS event_title,
                    ROUND(AVG(r.rating), 1) AS average, COUNT(*) AS count
             FROM reviews r JOIN events e ON e.id = r.event_id
             WHERE r.status = 'published'
             GROUP BY e.id ORDER BY count DESC`
        ).all();
        payload.perEvent = (perRes?.results || []).map((r) => ({
            slug: r.event_slug, title: r.event_title, average: r.average, count: r.count,
        }));
    }

    return c.json(payload);
});

// ─── GET /api/reviews/all?limit&offset — the dedicated /reviews page ───
reviews.get('/all', async (c) => {
    const limit = clampLimit(c.req.query('limit'), 24);
    const offset = clampOffset(c.req.query('offset'));

    const agg = await c.env.DB.prepare(
        `SELECT ROUND(AVG(rating), 1) AS average, COUNT(*) AS total FROM reviews WHERE status = 'published'`
    ).first();

    const rowsRes = await c.env.DB.prepare(
        `SELECT r.id, r.rating, r.title, r.comment, r.author_name, r.created_at,
                e.slug AS event_slug, e.title AS event_title
         FROM reviews r JOIN events e ON e.id = r.event_id
         WHERE r.status = 'published'
         ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    return c.json({
        total: agg?.total || 0,
        average: agg?.total ? agg.average : null,
        limit,
        offset,
        reviews: (rowsRes?.results || []).map(publicReviewWithEvent),
    });
});

export default reviews;
