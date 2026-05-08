import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sendEventReminder, sendEventReminder1hr } from './lib/emailSender.js';
import { loadTemplate, renderTemplate } from './lib/templates.js';
import { sendEmail } from './lib/email.js';
import { createVendorToken } from './lib/vendorToken.js';
import { runCustomerTagsSweep } from './lib/customerTags.js';

import events from './routes/events.js';
import bookings from './routes/bookings.js';
import webhooks from './routes/webhooks.js';
import waivers from './routes/waivers.js';
import publicTaxesFees from './routes/taxesFees.js';
import publicFeedback from './routes/feedback.js';
import vendorPublic from './routes/vendor.js';
import vendorAuth from './routes/vendorAuth.js';
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
import adminVendors from './routes/admin/vendors.js';
import adminEventVendors from './routes/admin/eventVendors.js';
import adminVendorContracts from './routes/admin/vendorContracts.js';
import adminWaiverDocuments from './routes/admin/waiverDocuments.js';
import adminFeedback from './routes/admin/feedback.js';
import adminFeatureFlags from './routes/admin/featureFlags.js';
import adminCustomers from './routes/admin/customers.js';
import adminSavedViews from './routes/admin/savedViews.js';
import adminDashboard from './routes/admin/dashboard.js';
import adminStaff from './routes/admin/staff.js';
import adminStaffDocuments from './routes/admin/staffDocuments.js';

const app = new Hono();

// CORS policy is tied to SITE_URL — never wildcard. Browsers that try to hit
// the API from any other origin (incl. attacker pages) get no CORS headers
// and their fetch fails. /api/webhooks/stripe deliberately gets no CORS
// middleware because it's server-to-server — browsers shouldn't touch it.
//
// Hono passes (originHeader, context) to the function. Return the origin to
// echo it back, or null to refuse CORS headers entirely.
function corsOrigin(reqOrigin, c) {
    const allowed = c.env.SITE_URL;
    return reqOrigin && allowed && reqOrigin === allowed ? reqOrigin : null;
}

// Public GET endpoints: events, taxes-fees, waivers, bookings lookup. No cookies.
app.use('/api/events/*', cors({ origin: corsOrigin, allowMethods: ['GET', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/api/events', cors({ origin: corsOrigin, allowMethods: ['GET', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/api/taxes-fees', cors({ origin: corsOrigin, allowMethods: ['GET', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/api/waivers/*', cors({ origin: corsOrigin, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
// Vendor magic-link + upload + sign routes. POST needed for sign + upload.
app.use('/api/vendor/*', cors({ origin: corsOrigin, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
// Vendor auth (cookie-bearing) gets credentials:true, same as admin.
app.use('/api/vendor/auth/*', cors({
    origin: corsOrigin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
}));

// Public booking checkout + lookup. No cookies; POSTs from the site.
app.use('/api/bookings/*', cors({ origin: corsOrigin, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/api/bookings', cors({ origin: corsOrigin, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));

// Admin: cookie-bearing. credentials:true requires an explicit origin, never '*'.
app.use('/api/admin/*', cors({
    origin: corsOrigin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/api/health', cors({ origin: corsOrigin, allowMethods: ['GET', 'OPTIONS'] }));

// /api/webhooks/* intentionally has NO cors middleware — server-to-server.

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
app.route('/api/feedback', publicFeedback);
app.route('/api/vendor/auth', vendorAuth);
app.route('/api/vendor', vendorPublic);
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
app.route('/api/admin/vendors', adminVendors);
app.route('/api/admin/event-vendors', adminEventVendors);
app.route('/api/admin/vendor-contracts', adminVendorContracts);
app.route('/api/admin/waiver-documents', adminWaiverDocuments);
app.route('/api/admin/feedback', adminFeedback);
app.route('/api/admin/feature-flags', adminFeatureFlags);
app.route('/api/admin/customers', adminCustomers);
app.route('/api/admin/saved-views', adminSavedViews);
app.route('/api/admin', adminDashboard);
app.route('/api/admin/staff', adminStaff);
app.route('/api/admin/staff-documents', adminStaffDocuments);

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
    // LIMIT 100 keeps the sweep inside Workers' CPU budget (~30s) even after a
    // big event drop. Next 15-min tick will pick up any leftovers — each row's
    // `column IS NULL` filter is its own idempotency key.
    const rows = await env.DB.prepare(
        `SELECT b.*, e.title AS event_title, e.display_date AS event_display_date,
                e.location AS event_location, e.check_in AS event_check_in,
                e.first_game AS event_first_game, e.date_iso AS event_date_iso
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.status IN ('paid', 'comp')
           AND b.${column} IS NULL
           AND b.email IS NOT NULL AND b.email != ''
           AND (unixepoch(e.date_iso) * 1000) BETWEEN ? AND ?
         LIMIT 100`
    ).bind(windowStart, windowEnd).all();

    const candidates = rows.results || [];
    const results = { considered: candidates.length, sent: 0, failed: 0 };

    // Sentinel-first idempotency: stamp the reminder column BEFORE sending.
    // If the send fails we null it back so the next tick retries.
    // If the Worker is evicted mid-flight, the stamp persists → no duplicate
    // email, at most a single skipped delivery (acceptable tradeoff vs spam).
    async function processOne(r) {
        const now = Date.now();
        try {
            const claimed = await env.DB.prepare(
                `UPDATE bookings SET ${column} = ? WHERE id = ? AND ${column} IS NULL`
            ).bind(now, r.id).run();
            // Another sweep (or another Worker instance) already claimed it.
            if (!claimed.meta?.changes) return 'skipped';

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
            await env.DB.prepare(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                 VALUES (NULL, ?, 'booking', ?, ?, ?)`
            ).bind(auditAction, r.id, JSON.stringify({ to: r.email, event_id: r.event_id }), now).run();
            return 'sent';
        } catch (err) {
            console.error('Reminder failed for booking', r.id, err);
            // Roll back sentinel so next tick retries.
            try {
                await env.DB.prepare(
                    `UPDATE bookings SET ${column} = NULL WHERE id = ? AND ${column} = ?`
                ).bind(r.id, now).run();
            } catch (rollbackErr) {
                console.error('Sentinel rollback failed for', r.id, rollbackErr);
            }
            return 'failed';
        }
    }

    // Small parallel batches: Resend rate limits start around 10 rps for most
    // plans, and D1 is fine with the concurrency. Bigger batches risk both.
    const BATCH = 10;
    for (let i = 0; i < candidates.length; i += BATCH) {
        const slice = candidates.slice(i, i + BATCH);
        const outcomes = await Promise.allSettled(slice.map(processOne));
        for (const o of outcomes) {
            if (o.status === 'fulfilled') {
                if (o.value === 'sent') results.sent++;
                else if (o.value === 'failed') results.failed++;
            } else {
                results.failed++;
            }
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

// ───── Vendor v1 cron sweeps ─────
// Each sweep stamps a sentinel column (`*_sent_at`) BEFORE attempting the
// send, same pattern as the booking reminder sweep: prevents duplicate mail
// if the Worker is evicted mid-flight, at the cost of at most one skipped
// delivery on Resend failure.

async function mintTokenFor(env, ev) {
    const expiresAt = ev.token_expires_at ?? (Date.now() + 30 * 24 * 60 * 60 * 1000);
    return createVendorToken(ev.id, ev.token_version, expiresAt, env.SESSION_SECRET);
}

async function trySendVendorEmail(env, slug, to, vars) {
    const template = await loadTemplate(env.DB, slug);
    if (!template || !to) return 'skipped';
    const rendered = renderTemplate(template, vars);
    try {
        await sendEmail({
            apiKey: env.RESEND_API_KEY,
            from: env.FROM_EMAIL,
            to,
            replyTo: env.REPLY_TO_EMAIL,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            tags: [{ name: 'type', value: slug }],
        });
        return 'sent';
    } catch (err) {
        console.error(`${slug} send failed`, err);
        return 'failed';
    }
}

async function runVendorSweep(env) {
    const now = Date.now();
    const results = { coi30: 0, coi7: 0, pkgReminder: 0, sigReminder: 0 };

    // COI expiry reminders. Scan vendors with a set coi_expires_on and at
    // least one non-revoked package (don't badger dormant vendors). Fire 30d
    // and 7d tiers; each stamped with its own sentinel column.
    async function sweepCoi(windowDays, sentinelCol) {
        const cutoffMs = now + windowDays * 24 * 60 * 60 * 1000;
        const rows = await env.DB.prepare(
            `SELECT v.id, v.company_name, v.coi_expires_on,
                    vc.email AS contact_email, vc.name AS contact_name
             FROM vendors v
             LEFT JOIN vendor_contacts vc ON vc.vendor_id = v.id
                 AND vc.is_primary = 1 AND vc.deleted_at IS NULL
             WHERE v.deleted_at IS NULL
               AND v.coi_expires_on IS NOT NULL
               AND v.${sentinelCol} IS NULL
               AND (julianday(v.coi_expires_on) - julianday('now')) * 86400000 < ?
               AND v.coi_expires_on >= date('now')
               AND EXISTS (SELECT 1 FROM event_vendors ev WHERE ev.vendor_id = v.id AND ev.status != 'revoked')
             LIMIT 50`
        ).bind(cutoffMs - now).all();

        let count = 0;
        for (const r of rows.results || []) {
            if (!r.contact_email) continue;
            const claimed = await env.DB.prepare(
                `UPDATE vendors SET ${sentinelCol} = ? WHERE id = ? AND ${sentinelCol} IS NULL`
            ).bind(now, r.id).run();
            if (!claimed.meta?.changes) continue;

            const daysLeft = Math.ceil((new Date(r.coi_expires_on + 'T23:59:59') - now) / (24 * 60 * 60 * 1000));
            const result = await trySendVendorEmail(env, 'vendor_coi_expiring', r.contact_email, {
                contact_name: r.contact_name || '',
                company_name: r.company_name,
                coi_expires_on: r.coi_expires_on,
                days_left: String(daysLeft),
            });
            if (result === 'failed') {
                await env.DB.prepare(
                    `UPDATE vendors SET ${sentinelCol} = NULL WHERE id = ? AND ${sentinelCol} = ?`
                ).bind(r.id, now).run();
            } else if (result === 'sent') count++;
        }
        return count;
    }
    results.coi30 = await sweepCoi(30, 'coi_reminder_30d_sent_at');
    results.coi7 = await sweepCoi(7, 'coi_reminder_7d_sent_at');

    // Package open reminder: event in 6-8 days, status === 'sent' (not yet
    // viewed), sentinel null.
    const SIX_D = 6 * 24 * 60 * 60 * 1000;
    const EIGHT_D = 8 * 24 * 60 * 60 * 1000;
    {
        const rows = await env.DB.prepare(
            `SELECT ev.*, e.title AS event_title, e.display_date AS event_display_date,
                    vc.email AS contact_email, vc.name AS contact_name
             FROM event_vendors ev
             JOIN events e ON e.id = ev.event_id
             LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id
             WHERE ev.status = 'sent'
               AND ev.package_reminder_sent_at IS NULL
               AND (unixepoch(e.date_iso) * 1000) BETWEEN ? AND ?
             LIMIT 50`
        ).bind(now + SIX_D, now + EIGHT_D).all();

        for (const r of rows.results || []) {
            if (!r.contact_email) continue;
            const claimed = await env.DB.prepare(
                `UPDATE event_vendors SET package_reminder_sent_at = ? WHERE id = ? AND package_reminder_sent_at IS NULL`
            ).bind(now, r.id).run();
            if (!claimed.meta?.changes) continue;
            const token = await mintTokenFor(env, r);
            const result = await trySendVendorEmail(env, 'vendor_package_reminder', r.contact_email, {
                contact_name: r.contact_name || '',
                event_title: r.event_title,
                event_date: r.event_display_date,
                package_url: `${env.SITE_URL}/v/${token}`,
            });
            if (result === 'failed') {
                await env.DB.prepare(
                    `UPDATE event_vendors SET package_reminder_sent_at = NULL WHERE id = ? AND package_reminder_sent_at = ?`
                ).bind(r.id, now).run();
            } else if (result === 'sent') results.pkgReminder++;
        }
    }

    // Signature reminder: contract_required AND not yet signed AND event in
    // 13-15 days AND sentinel null.
    const THIRTEEN_D = 13 * 24 * 60 * 60 * 1000;
    const FIFTEEN_D = 15 * 24 * 60 * 60 * 1000;
    {
        const rows = await env.DB.prepare(
            `SELECT ev.*, e.title AS event_title, e.display_date AS event_display_date,
                    vc.email AS contact_email, vc.name AS contact_name
             FROM event_vendors ev
             JOIN events e ON e.id = ev.event_id
             LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id
             WHERE ev.contract_required = 1
               AND ev.contract_signed_at IS NULL
               AND ev.status != 'revoked'
               AND ev.signature_reminder_sent_at IS NULL
               AND (unixepoch(e.date_iso) * 1000) BETWEEN ? AND ?
             LIMIT 50`
        ).bind(now + THIRTEEN_D, now + FIFTEEN_D).all();

        for (const r of rows.results || []) {
            if (!r.contact_email) continue;
            const claimed = await env.DB.prepare(
                `UPDATE event_vendors SET signature_reminder_sent_at = ? WHERE id = ? AND signature_reminder_sent_at IS NULL`
            ).bind(now, r.id).run();
            if (!claimed.meta?.changes) continue;
            const token = await mintTokenFor(env, r);
            const result = await trySendVendorEmail(env, 'vendor_signature_requested', r.contact_email, {
                contact_name: r.contact_name || '',
                event_title: r.event_title,
                event_date: r.event_display_date,
                package_url: `${env.SITE_URL}/v/${token}`,
            });
            if (result === 'failed') {
                await env.DB.prepare(
                    `UPDATE event_vendors SET signature_reminder_sent_at = NULL WHERE id = ? AND signature_reminder_sent_at = ?`
                ).bind(r.id, now).run();
            } else if (result === 'sent') results.sigReminder++;
        }
    }

    return results;
}

// Mark long-abandoned pending bookings as 'abandoned'. The capacity check in
// worker/routes/bookings.js:checkTicketInventory already excludes pending rows
// older than PENDING_HOLD_MS (10 min), so these don't actually reserve seats
// anymore — this sweep just prevents DB bloat and gives the UI a clearer
// signal. 30-minute cutoff = 3× the hold, comfortably past any legit Stripe
// Checkout completion window.
const PENDING_ABANDON_MS = 30 * 60 * 1000;
async function runAbandonPendingSweep(env) {
    const cutoff = Date.now() - PENDING_ABANDON_MS;
    const result = await env.DB.prepare(
        `UPDATE bookings
         SET status = 'abandoned'
         WHERE status = 'pending' AND created_at < ?`
    ).bind(cutoff).run();
    return { abandoned: result.meta?.changes ?? 0 };
}

// GET /uploads/* — serve R2 objects publicly with aggressive caching.
// Keys are random, so objects are treated as immutable once written.
//
// Allowlist of serveable key shapes. Matches what admin/uploads.js actually
// writes: <prefix>/<random>.<image-ext>. Rejecting anything else means that
// if a future workflow ever writes private objects to this bucket (backups,
// attendee photos, etc.), those remain unreachable through this endpoint.
const SERVEABLE_KEY = /^[a-z0-9_-]+\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/;

// Canonical Content-Type derived from the (regex-validated) key extension.
// Ignoring obj.httpMetadata.contentType means a malicious writer can't smuggle
// text/html into this serve path even if they somehow bypassed the upload
// endpoint's validation.
const EXT_TO_MIME = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
};

async function serveUpload(request, env, key) {
    if (!env.UPLOADS) return new Response('Uploads not configured', { status: 500 });
    if (!SERVEABLE_KEY.test(key)) return new Response('Not found', { status: 404 });
    const obj = await env.UPLOADS.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
    const headers = new Headers();
    headers.set('Content-Type', EXT_TO_MIME[ext] || 'application/octet-stream');
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
        `SELECT title, display_date, location, short_description,
                cover_image_url, og_image_url
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
    // Prefer the dedicated 1.91:1 OG asset when admin uploaded one. Falls
    // back to the universal cover, then the site-wide default.
    const image = row.og_image_url || row.cover_image_url || `${siteUrl}/images/og-image.jpg`;

    const rewriter = new HTMLRewriter()
        .on('title', {
            // html:false treats content as literal text — prevents XSS when
            // event title contains '<' or '>' characters.
            element(el) { el.setInnerContent(title, { html: false }); },
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

// Security response headers applied to every response the Worker returns.
// CSP is intentionally omitted here — it will be added in a follow-up once
// the Peek widget is removed from index.html (HANDOFF §11 item 2), because a
// strict CSP conflicts with Peek's external script/stylesheet until cutover.
// The remaining headers are non-breaking and high-value: they block
// clickjacking, TLS stripping, MIME-sniffing, and referer leakage of booking
// tokens.
function withSecurityHeaders(response) {
    const h = new Headers(response.headers);
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Camera for /admin/scan (QR); deny everything else by default.
    h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: h,
    });
}

async function handleRequest(request, env, ctx) {
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
}

export default {
    async fetch(request, env, ctx) {
        const res = await handleRequest(request, env, ctx);
        return withSecurityHeaders(res);
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            const startedAt = Date.now();
            const cron = event.cron || 'manual';
            let summary;

            // M3 B10: branch by cron schedule. The 03:00 UTC nightly
            // sweep refreshes customer_tags (tag_type='system') and
            // does NOT run the 15-min reminder/abandon/vendor sweeps.
            // Every other cron (today: just '*/15 * * * *') runs the
            // existing three-way reminder sweep.
            if (cron === '0 3 * * *') {
                const tags = await runCustomerTagsSweep(env).catch((err) => {
                    console.error('customer-tags sweep failed', err);
                    return { error: err?.message };
                });
                summary = { tags };
            } else {
                const [r, a, v] = await Promise.all([
                    runReminderSweep(env),
                    runAbandonPendingSweep(env).catch((err) => {
                        console.error('abandon sweep failed', err);
                        return { abandoned: 0, error: err?.message };
                    }),
                    runVendorSweep(env).catch((err) => {
                        console.error('vendor sweep failed', err);
                        return { error: err?.message };
                    }),
                ]);
                summary = { reminders: r, pending: a, vendor: v };
            }

            const finishedAt = Date.now();
            const durationMs = finishedAt - startedAt;

            // Always-on audit row, even when no work was done. Lets the admin
            // dashboard prove the cron is alive ("last sweep: N min ago")
            // independent of whether anything got sent.
            try {
                await env.DB.prepare(
                    `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                     VALUES (NULL, 'cron.swept', 'cron', ?, ?, ?)`
                ).bind(
                    cron,
                    JSON.stringify({ cron: event.cron || null, durationMs, ...summary }),
                    finishedAt,
                ).run();
            } catch (err) {
                console.error('cron.swept audit insert failed', err);
            }

            console.log('scheduled sweeps', cron, summary);
        })());
    },
};
