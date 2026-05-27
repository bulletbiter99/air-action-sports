// Post-M6 Track C — admin endpoints for event archive links.
//
//   GET    /api/admin/event-archive
//          List past events with archive-link counts (lightweight; for the
//          admin list page).
//   GET    /api/admin/event-archive/:eventId
//          Full link list for a single event.
//   PUT    /api/admin/event-archive/:eventId
//          Body: { links: [{kind,url,title?,thumbnail_url?,ordering?}, ...] }
//          Full-replace semantics — DELETE all + INSERT new in one batch.
//          Simpler than per-link CRUD; lets operator reorder without merge
//          gymnastics. Audited as event_archive.updated.
//
// Gating: events.archive.write capability (migration 0061 binds to
// owner + event_director). Per-endpoint via requireCapability.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { validateLinkPayload, buildEmbedUrl } from '../../lib/archiveLinks.js';

const adminEventArchive = new Hono();
adminEventArchive.use('*', requireAuth);

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/event-archive — past events + link counts
// ────────────────────────────────────────────────────────────────────
adminEventArchive.get('/', requireCapability('events.archive.write'), async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT e.id, e.slug, e.title, e.date_iso, e.location,
                COALESCE(v.cnt, 0) AS video_count,
                COALESCE(p.cnt, 0) AS photo_count
         FROM events e
         LEFT JOIN (
            SELECT event_id, COUNT(*) AS cnt FROM event_archive_links
            WHERE kind = 'video' GROUP BY event_id
         ) v ON v.event_id = e.id
         LEFT JOIN (
            SELECT event_id, COUNT(*) AS cnt FROM event_archive_links
            WHERE kind = 'photo' GROUP BY event_id
         ) p ON p.event_id = e.id
         WHERE e.past = 1
         ORDER BY e.date_iso DESC`,
    ).all().catch(() => ({ results: [] }));

    return c.json({
        events: (rows.results || []).map((r) => ({
            id: r.id,
            slug: r.slug,
            title: r.title,
            dateIso: r.date_iso,
            location: r.location,
            videoCount: r.video_count,
            photoCount: r.photo_count,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/event-archive/:eventId — full link list
// ────────────────────────────────────────────────────────────────────
adminEventArchive.get('/:eventId', requireCapability('events.archive.write'), async (c) => {
    const eventId = c.req.param('eventId');
    const event = await c.env.DB.prepare(
        'SELECT id, slug, title, date_iso, past FROM events WHERE id = ?',
    ).bind(eventId).first();
    if (!event) return c.json({ error: 'Event not found' }, 404);

    const linksResult = await c.env.DB.prepare(
        `SELECT id, kind, url, title, thumbnail_url, ordering, created_at, updated_at
         FROM event_archive_links
         WHERE event_id = ?
         ORDER BY ordering ASC, created_at ASC`,
    ).bind(eventId).all().catch(() => ({ results: [] }));

    return c.json({
        event: {
            id: event.id,
            slug: event.slug,
            title: event.title,
            dateIso: event.date_iso,
            past: !!event.past,
        },
        links: (linksResult.results || []).map((l) => ({
            id: l.id,
            kind: l.kind,
            url: l.url,
            title: l.title,
            thumbnailUrl: l.thumbnail_url,
            ordering: l.ordering,
            embedUrl: buildEmbedUrl({ kind: l.kind, url: l.url }),
            createdAt: l.created_at,
            updatedAt: l.updated_at,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/event-archive/:eventId — full-replace links
// ────────────────────────────────────────────────────────────────────
adminEventArchive.put('/:eventId', requireCapability('events.archive.write'), async (c) => {
    const user = c.get('user');
    const eventId = c.req.param('eventId');
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.links)) {
        return c.json({ error: 'body.links must be an array' }, 400);
    }

    // Validate event exists. Allow updating archive on any event regardless
    // of past flag — operator may set up the archive before flipping the
    // past flag.
    const event = await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first();
    if (!event) return c.json({ error: 'Event not found' }, 404);

    // Validate each link before any writes.
    const normalized = [];
    for (let i = 0; i < body.links.length; i++) {
        const v = validateLinkPayload(body.links[i]);
        if (!v.ok) {
            return c.json({ error: `links[${i}]: ${v.error}` }, 400);
        }
        normalized.push(v.normalized);
    }

    const now = Date.now();

    // Full-replace: DELETE all existing then INSERT new. Sequential because
    // D1 doesn't expose a true transaction wrapper from Workers — but the
    // DELETE+INSERT pattern is idempotent and won't leave the table in a
    // half-state since the route is single-writer.
    await c.env.DB.prepare(
        'DELETE FROM event_archive_links WHERE event_id = ?',
    ).bind(eventId).run();

    let kindCounts = { video: 0, photo: 0 };
    for (const link of normalized) {
        const linkId = `eal_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        await c.env.DB.prepare(
            `INSERT INTO event_archive_links
               (id, event_id, kind, url, title, thumbnail_url, ordering,
                created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
            linkId, eventId, link.kind, link.url,
            link.title, link.thumbnailUrl, link.ordering,
            user.id, now, now,
        ).run();
        kindCounts[link.kind]++;
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'event_archive.updated',
        targetType: 'event',
        targetId: eventId,
        meta: {
            totalLinks: normalized.length,
            videoCount: kindCounts.video,
            photoCount: kindCounts.photo,
        },
    });

    return c.json({ success: true, eventId, linkCount: normalized.length });
});

export default adminEventArchive;
