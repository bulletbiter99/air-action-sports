import { Hono } from 'hono';

// Public sites route — backs the /locations page + the Home locations preview.
// Read-only; no auth. Exposes only the public marketing fields (migration 0072),
// never the operational columns (acreage, buffers, blackouts).

const publicSites = new Hono();

function safeJsonArray(str) {
    try {
        const v = str ? JSON.parse(str) : [];
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}

function formatPublicSite(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        siteNumber: row.site_number,
        badge: row.badge,
        photoUrl: row.photo_url,
        photoPosition: row.photo_position,
        locationBlurb: row.location_blurb,
        features: safeJsonArray(row.features_json),
        gameTypes: safeJsonArray(row.game_types_json),
    };
}

// GET /api/sites — sites flagged show_on_locations, in display order.
publicSites.get('/', async (c) => {
    const res = await c.env.DB.prepare(
        `SELECT id, slug, name, site_number, badge, photo_url, photo_position,
                location_blurb, features_json, game_types_json
         FROM sites
         WHERE show_on_locations = 1 AND archived_at IS NULL
         ORDER BY sort_order ASC, name ASC`,
    ).all();
    return c.json({ sites: (res.results || []).map(formatPublicSite) });
});

export default publicSites;
