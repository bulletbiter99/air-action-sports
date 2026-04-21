import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sendEventReminder, sendEventReminder1hr } from './lib/emailSender.js';

import events from './routes/events.js';
import bookings from './routes/bookings.js';
import webhooks from './routes/webhooks.js';
import waivers from './routes/waivers.js';
import publicTaxesFees from './routes/taxesFees.js';
import adminAuth from './routes/admin/auth.js';
import adminBookings from './routes/admin/bookings.js';
import adminEvents, { ticketTypes as adminTicketTypes } from './routes/admin/events.js';
import adminAttendees from './routes/admin/attendees.js';
import adminTaxesFees from './routes/admin/taxesFees.js';
import adminRentals from './routes/admin/rentals.js';
import adminPromoCodes from './routes/admin/promoCodes.js';
import adminAnalytics from './routes/admin/analytics.js';
import adminUsers from './routes/admin/users.js';
import adminAuditLog from './routes/admin/auditLog.js';
import adminEmailTemplates from './routes/admin/emailTemplates.js';
import adminUploads from './routes/admin/uploads.js';

const app = new Hono();

app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Stripe-Signature'],
}));

// Never cache API responses — they're dynamic and booking-sensitive.
app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    c.header('Pragma', 'no-cache');
});

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.route('/api/events', events);
app.route('/api/bookings', bookings);
app.route('/api/webhooks', webhooks);
app.route('/api/waivers', waivers);
app.route('/api/taxes-fees', publicTaxesFees);
app.route('/api/admin/auth', adminAuth);
app.route('/api/admin/bookings', adminBookings);
app.route('/api/admin/events', adminEvents);
app.route('/api/admin/attendees', adminAttendees);
app.route('/api/admin/taxes-fees', adminTaxesFees);
app.route('/api/admin/rentals', adminRentals);
app.route('/api/admin/ticket-types', adminTicketTypes);
app.route('/api/admin/promo-codes', adminPromoCodes);
app.route('/api/admin/analytics', adminAnalytics);
app.route('/api/admin/users', adminUsers);
app.route('/api/admin/audit-log', adminAuditLog);
app.route('/api/admin/email-templates', adminEmailTemplates);
app.route('/api/admin/uploads', adminUploads);

app.onError((err, c) => {
    console.error('API error', err);
    return c.json({ error: 'Internal server error' }, 500);
});

// Scheduled handler — fires on the cron triggers defined in wrangler.toml.
// Two independent sweeps over paid/comp bookings:
//   - 24hr reminder: event starts in 20-28hrs, stamps reminder_sent_at
//   - 1hr reminder:  event starts in 45-75min, stamps reminder_1hr_sent_at
// Each column is the idempotency key for its window; a booking gets both.
async function runReminderSweepWindow(env, { windowStart, windowEnd, column, sender, auditAction }) {
    const rows = await env.DB.prepare(
        `SELECT b.*, e.title AS event_title, e.display_date AS event_display_date,
                e.location AS event_location, e.check_in AS event_check_in,
                e.first_game AS event_first_game, e.date_iso AS event_date_iso
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.status IN ('paid', 'comp')
           AND b.${column} IS NULL
           AND b.email IS NOT NULL AND b.email != ''
           AND (unixepoch(e.date_iso) * 1000) BETWEEN ? AND ?`
    ).bind(windowStart, windowEnd).all();

    const results = { considered: (rows.results || []).length, sent: 0, failed: 0 };
    for (const r of (rows.results || [])) {
        try {
            await sender(env, {
                booking: r,
                event: {
                    title: r.event_title,
                    display_date: r.event_display_date,
                    location: r.event_location,
                    check_in: r.event_check_in,
                    first_game: r.event_first_game,
                },
            });
            const now = Date.now();
            await env.DB.prepare(`UPDATE bookings SET ${column} = ? WHERE id = ?`)
                .bind(now, r.id).run();
            await env.DB.prepare(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                 VALUES (NULL, ?, 'booking', ?, ?, ?)`
            ).bind(auditAction, r.id, JSON.stringify({ to: r.email, event_id: r.event_id }), now).run();
            results.sent++;
        } catch (err) {
            console.error('Reminder failed for booking', r.id, err);
            results.failed++;
        }
    }
    return results;
}

async function runReminderSweep(env) {
    const now = Date.now();
    const H = 60 * 60 * 1000;
    const [r24, r1] = await Promise.all([
        runReminderSweepWindow(env, {
            windowStart: now + 20 * H,
            windowEnd: now + 28 * H,
            column: 'reminder_sent_at',
            sender: sendEventReminder,
            auditAction: 'reminder.sent',
        }),
        runReminderSweepWindow(env, {
            windowStart: now + 45 * 60 * 1000,   // 45 minutes from now
            windowEnd: now + 75 * 60 * 1000,     // 75 minutes from now
            column: 'reminder_1hr_sent_at',
            sender: sendEventReminder1hr,
            auditAction: 'reminder_1hr.sent',
        }),
    ]);
    return { r24, r1 };
}

// GET /uploads/* — serve R2 objects publicly with aggressive caching.
// Keys are random, so objects are treated as immutable once written.
async function serveUpload(request, env, key) {
    if (!env.UPLOADS) return new Response('Uploads not configured', { status: 500 });
    const obj = await env.UPLOADS.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', obj.httpEtag || '');
    return new Response(obj.body, { status: 200, headers });
}

// Match /events/:slug (but not /events itself). Returns the slug or null.
function parseEventSlug(pathname) {
    const m = pathname.match(/^\/events\/([^/?#]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
}

// Fetch the SPA shell, then rewrite OG/Twitter meta tags to be event-specific.
// Scrapers (Facebook, iMessage, Slack, Twitter, etc.) don't run JS, so Helmet
// tags never reach them. HTMLRewriter runs in the Worker and injects real values.
async function rewriteEventOg(request, env, slug) {
    // Events currently use slug as id (legacy seeding). Try id first, then slug column.
    const row = await env.DB.prepare(
        `SELECT title, display_date, location, short_description, cover_image_url
         FROM events WHERE (id = ? OR slug = ?) AND published = 1 LIMIT 1`
    ).bind(slug, slug).first();

    // No match — just serve the shell as-is; the SPA will render its 404.
    const origin = env.ASSETS ? await env.ASSETS.fetch(request) : null;
    if (!row || !origin) return origin;

    const title = `${row.title}${row.display_date ? ' — ' + row.display_date : ''} | Air Action Sports`;
    const description = row.short_description
        || `${row.title} airsoft event${row.location ? ' at ' + row.location.split(' —')[0] : ''}${row.display_date ? ' on ' + row.display_date : ''}. Book your slot now.`;
    const siteUrl = env.SITE_URL || 'https://air-action-sports.bulletbiter99.workers.dev';
    const ogUrl = `${siteUrl}/events/${slug}`;
    const image = row.cover_image_url || `${siteUrl}/images/og-image.jpg`;

    const rewriter = new HTMLRewriter()
        .on('title', {
            element(el) { el.setInnerContent(title); },
        })
        .on('meta[name="description"]', {
            element(el) { el.setAttribute('content', description); },
        })
        .on('meta[property="og:title"]', {
            element(el) { el.setAttribute('content', title); },
        })
        .on('meta[property="og:description"]', {
            element(el) { el.setAttribute('content', description); },
        })
        .on('meta[property="og:url"]', {
            element(el) { el.setAttribute('content', ogUrl); },
        })
        .on('meta[property="og:image"]', {
            element(el) { el.setAttribute('content', image); },
        })
        .on('meta[property="og:type"]', {
            element(el) { el.setAttribute('content', 'article'); },
        })
        .on('meta[name="twitter:title"]', {
            element(el) { el.setAttribute('content', title); },
        })
        .on('meta[name="twitter:description"]', {
            element(el) { el.setAttribute('content', description); },
        })
        .on('meta[name="twitter:image"]', {
            element(el) { el.setAttribute('content', image); },
        });

    return rewriter.transform(origin);
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
            return app.fetch(request, env, ctx);
        }
        if (url.pathname.startsWith('/uploads/')) {
            const key = decodeURIComponent(url.pathname.slice('/uploads/'.length));
            if (key) return serveUpload(request, env, key);
        }
        const slug = parseEventSlug(url.pathname);
        if (slug) {
            try { return await rewriteEventOg(request, env, slug); }
            catch (err) { console.error('OG rewrite failed', err); /* fall through */ }
        }
        return env.ASSETS.fetch(request);
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            const r = await runReminderSweep(env);
            console.log('reminder sweep', event.cron, r);
        })());
    },
};
