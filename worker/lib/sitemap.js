// Worker-served sitemap.xml.
//
// WHY: public/sitemap.xml was hand-maintained and carried the comment
// "Live event pages (add each on publish)" — an add step with no remove step
// and no reconciliation. It had already drifted: /games and
// /rules-of-engagement were missing entirely, while two concluded events sat
// at priority 0.8 as though they were the site's most important live pages,
// and three equally-real archived events were absent. Every future event
// compounds it.
//
// Generating from D1 makes the drift structurally impossible: publishing,
// archiving or renaming an event updates the sitemap on the next crawl with no
// human step.
//
// The event predicate MIRRORS the public detail route (worker/routes/events.js)
// and rewriteEventOg: `published = 1 OR past = 1`. Sprint 4 (#404) made
// archived events permanently public, so they belong in the sitemap — listing
// only published events would now hide most of the site's real content. If that
// visibility contract changes, all three sites change together.

// Public, indexable routes. Deliberately EXCLUDED:
//   /review, /waiver, /booking/success, /booking/cancelled, /booking/ticket,
//   /v/:token  — all carry a per-booking or per-vendor token in the query
//                string; listing them would invite indexing of live credentials.
//   /admin/*, /event/*, /portal, /vendor/*  — private surfaces.
//   /feedback  — no inbound link anywhere on the site and superseded by the
//                footer's feedback modal; listing it would advertise a page the
//                site itself does not link to.
export const STATIC_ROUTES = [
    { path: '/', priority: '1.0' },
    { path: '/events', priority: '0.9' },
    { path: '/booking', priority: '0.9' },
    { path: '/games', priority: '0.8' },
    { path: '/pricing', priority: '0.8' },
    { path: '/locations', priority: '0.8' },
    { path: '/new-players', priority: '0.8' },
    { path: '/rules-of-engagement', priority: '0.7' },
    { path: '/gallery', priority: '0.7' },
    { path: '/about', priority: '0.7' },
    { path: '/faq', priority: '0.7' },
    { path: '/contact', priority: '0.7' },
    { path: '/reviews', priority: '0.7' },
    { path: '/safety', priority: '0.6' },
    { path: '/privacy', priority: '0.3' },
];

// Events use slug as the public URL, but slug is nullable and legacy rows were
// seeded with the id doubling as the slug — the public route matches
// `id = ? OR slug = ?` for exactly that reason, so COALESCE mirrors it.
export const SITEMAP_EVENTS_SQL =
    `SELECT COALESCE(slug, id) AS loc_slug, updated_at
     FROM events
     WHERE (published = 1 OR past = 1) AND COALESCE(slug, id) IS NOT NULL
     ORDER BY date_iso DESC`;

export async function fetchSitemapEvents(env) {
    try {
        const res = await env.DB.prepare(SITEMAP_EVENTS_SQL).all();
        return res?.results || [];
    } catch {
        // A sitemap is not worth a 500. Degrade to static routes only.
        return [];
    }
}

// XML predefined entities. Slugs are slugified (lowercase alphanumeric +
// hyphens) so this should never fire — but a sitemap is generated from operator
// data, and an unescaped '&' produces an XML parse error that invalidates the
// WHOLE document, not just one entry.
function xmlEscape(s) {
    return String(s)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split('"').join('&quot;')
        .split("'").join('&apos;');
}

// lastmod as a full ISO 8601 instant with an explicit Z. Deliberately NOT a
// bare YYYY-MM-DD date derived from a calendar: updated_at is a true epoch
// timestamp, so emitting the instant is both spec-correct and sidesteps the
// UTC-vs-Denver date question entirely (see worker/lib/eventTime.js for why
// that question is a trap everywhere it does apply).
function lastmod(updatedAt) {
    if (updatedAt == null) return null;
    const n = Number(updatedAt);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function buildSitemapXml({ siteUrl, events = [] }) {
    const base = String(siteUrl || '').replace(/\/+$/, '');
    const urls = [];

    for (const r of STATIC_ROUTES) {
        urls.push(`  <url><loc>${xmlEscape(base + r.path)}</loc><priority>${r.priority}</priority></url>`);
    }

    for (const ev of events) {
        if (!ev?.loc_slug) continue;
        const lm = lastmod(ev.updated_at);
        const loc = xmlEscape(`${base}/events/${ev.loc_slug}`);
        urls.push(
            lm
                ? `  <url><loc>${loc}</loc><lastmod>${lm}</lastmod><priority>0.8</priority></url>`
                : `  <url><loc>${loc}</loc><priority>0.8</priority></url>`
        );
    }

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
