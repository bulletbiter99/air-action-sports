// Server-side review aggregates → crawler-visible JSON-LD (migration 0077, Batch 4).
//
// Client-rendered JSON-LD (react-helmet) is invisible to non-JS AI/search
// crawlers, so the REAL aggregateRating must be injected into the raw HTML by
// the Worker (the rewriteEventOg precedent). These helpers feed that injection.
//
// SINGLE shared visibility predicate: status='published' — identical to the
// public reviews API + the admin average, so the marked-up rating ALWAYS equals
// the visible rating (Google's review-snippet policy).
//
// Both getters return NULL when there are zero published reviews (or on ANY
// error — e.g. the reviews table not existing before 0077 is applied). The
// injector then OMITS the block entirely: we never emit an empty / zero
// aggregateRating (policy + honesty), and a pre-migration deploy is a safe no-op.

const ORG_AGG_SQL =
    `SELECT ROUND(AVG(rating), 1) AS average, COUNT(*) AS count FROM reviews WHERE status = 'published'`;

export async function getOrgReviewAggregate(env) {
    try {
        const row = await env.DB.prepare(ORG_AGG_SQL).first();
        if (!row || !row.count) return null;
        return { average: row.average, count: row.count };
    } catch {
        return null;
    }
}

export async function getEventReviewBundle(env, eventId, { recent = 5 } = {}) {
    if (!eventId) return null;
    try {
        const agg = await env.DB.prepare(
            `SELECT ROUND(AVG(rating), 1) AS average, COUNT(*) AS count
             FROM reviews WHERE event_id = ? AND status = 'published'`
        ).bind(eventId).first();
        if (!agg || !agg.count) return null;
        const rowsRes = await env.DB.prepare(
            `SELECT rating, title, comment, author_name, created_at
             FROM reviews WHERE event_id = ? AND status = 'published'
             ORDER BY created_at DESC LIMIT ?`
        ).bind(eventId, recent).all();
        return { aggregate: { average: agg.average, count: agg.count }, reviews: rowsRes?.results || [] };
    } catch {
        return null;
    }
}

// MANDATORY for ALL server-injected JSON-LD that can contain review text.
// JSON.stringify alone does NOT neutralize a literal </script> inside a JSON
// string in HTML context — a review comment of "</script><script>…</script>"
// would break out of the <script type="application/ld+json"> element and
// execute (stored XSS; reviews auto-publish, and the site has no CSP). Escaping
// '<' (and '>' '&' + the U+2028/U+2029 JS line separators) to their \uXXXX forms
// keeps the payload inert while remaining valid JSON the crawler still parses.
// NOTE: the separators are matched via \u escape sequences, NOT literal chars —
// a literal U+2028/U+2029 inside a regex literal is itself a line terminator and
// breaks the regex.
export function serializeJsonLd(obj) {
    // ASCII-only source: BS is a real backslash; the separators come from
    // fromCharCode. No backslash/separator literals in source (a literal
    // backslash-escape or U+2028 here is easy to get wrong / breaks a regex).
    const BS = String.fromCharCode(0x5c);
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    return JSON.stringify(obj)
        .split('<').join(BS + 'u003c')
        .split('>').join(BS + 'u003e')
        .split('&').join(BS + 'u0026')
        .split(LS).join(BS + 'u2028')
        .split(PS).join(BS + 'u2029');
}

const SITE_NAME = 'Air Action Sports';
const SITE_DESC = 'Full-day airsoft events across varied outdoor and urban sites.';

function ratingNode(aggregate) {
    return {
        '@type': 'AggregateRating',
        ratingValue: String(aggregate.average),
        reviewCount: String(aggregate.count),
        bestRating: '5',
        worstRating: '1',
    };
}

// Organization/LocalBusiness node for the home page. aggregate is required by
// the caller (home injects only when it's non-null), but guarded defensively.
export function buildOrgJsonLd({ siteUrl, aggregate }) {
    const obj = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: SITE_NAME,
        description: SITE_DESC,
        url: siteUrl,
    };
    if (aggregate) obj.aggregateRating = ratingNode(aggregate);
    return obj;
}

// Event node for /events/:slug. startDate/endDate use the stored naive-local
// ISO datetime (date_iso has no offset; emitting a wrong DST offset would be
// worse than none — schema.org accepts local datetime).
export function buildEventJsonLd({ siteUrl, slug, event, bundle }) {
    const obj = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: event.title,
        url: `${siteUrl}/events/${slug}`,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        organizer: { '@type': 'Organization', name: SITE_NAME, url: siteUrl },
    };
    if (event.date_iso) obj.startDate = event.date_iso;
    // Only emit endDate for genuine multi-day events — echoing date_iso would
    // tell crawlers a 12-hour single-day op ends the instant it starts.
    if (event.end_date_iso) obj.endDate = event.end_date_iso;
    if (event.location) obj.location = { '@type': 'Place', name: event.location, address: event.location };
    if (bundle?.aggregate) {
        obj.aggregateRating = ratingNode(bundle.aggregate);
        obj.review = (bundle.reviews || []).map((r) => {
            const rev = {
                '@type': 'Review',
                reviewRating: { '@type': 'Rating', ratingValue: String(r.rating), bestRating: '5', worstRating: '1' },
                author: { '@type': 'Person', name: r.author_name },
                datePublished: new Date(r.created_at).toISOString().slice(0, 10),
            };
            if (r.title) rev.name = r.title;
            if (r.comment) rev.reviewBody = r.comment;
            return rev;
        });
    }
    return obj;
}
