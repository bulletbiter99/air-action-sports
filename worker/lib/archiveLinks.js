// Post-M6 Track C — pure helpers for event archive links.
//
// Phase 1 supports two kinds: 'video' (YouTube embed) and 'photo'
// (Drive shared URL or any HTTPS image source). Phase 2 will add
// R2-hosted assets — same kind discriminator, different storage path.
//
// Used by:
//   - worker/routes/admin/eventArchive.js (PUT validation; embedUrl
//     computation)
//   - worker/routes/events.js (GET /api/events?archive=1 attaches
//     archiveLinks with computed embedUrl per row)

/**
 * Extracts a YouTube video ID from any of:
 *   - https://www.youtube.com/watch?v=XXXXXXXXXXX
 *   - https://youtu.be/XXXXXXXXXXX
 *   - https://www.youtube.com/embed/XXXXXXXXXXX
 *   - https://www.youtube.com/shorts/XXXXXXXXXXX
 *   - https://www.youtube-nocookie.com/embed/XXXXXXXXXXX
 * Returns null on no match.
 *
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
export function extractYouTubeId(url) {
    if (!url || typeof url !== 'string') return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
        return u.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') return u.searchParams.get('v');
        const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([^/?#]+)/);
        return m ? m[1] : null;
    }
    return null;
}

/**
 * Returns the embed-ready URL for a link, or null if it can't be embedded.
 *   - video + recognizable YouTube → https://www.youtube.com/embed/<id>?rel=0&modestbranding=1
 *   - photo → passthrough (caller renders as <a href> or <img src>)
 *   - unknown → null
 *
 * @param {{ kind: 'video'|'photo', url: string }} link
 * @returns {string|null}
 */
export function buildEmbedUrl(link) {
    if (!link || typeof link !== 'object') return null;
    if (link.kind === 'video') {
        const id = extractYouTubeId(link.url);
        return id ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1` : null;
    }
    if (link.kind === 'photo') return link.url || null;
    return null;
}

/**
 * Validate an incoming archive-link payload from the admin UI. Returns
 * { ok: true, normalized } or { ok: false, error }. Used by the admin
 * PUT endpoint to gate full-replace inputs.
 *
 * Rules:
 *   - kind must be 'video' or 'photo'
 *   - url must be a non-empty HTTPS URL (no http://, no data:, no file:)
 *   - For kind='video', URL must resolve to a YouTube ID (matches the
 *     embed-able set above)
 *   - title + thumbnail_url optional strings (trimmed); ordering coerced
 *     to non-negative integer
 *
 * @param {any} input
 * @returns {{ ok: true, normalized: {kind,url,title,thumbnailUrl,ordering} }
 *          | { ok: false, error: string }}
 */
export function validateLinkPayload(input) {
    if (!input || typeof input !== 'object') {
        return { ok: false, error: 'link must be an object' };
    }
    if (input.kind !== 'video' && input.kind !== 'photo') {
        return { ok: false, error: "kind must be 'video' or 'photo'" };
    }
    const urlStr = typeof input.url === 'string' ? input.url.trim() : '';
    if (!urlStr) return { ok: false, error: 'url is required' };
    let parsed;
    try { parsed = new URL(urlStr); } catch { return { ok: false, error: 'url is not a valid URL' }; }
    if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'url must use https://' };
    }
    if (input.kind === 'video' && extractYouTubeId(urlStr) === null) {
        return { ok: false, error: 'video url must be a YouTube link (youtube.com or youtu.be)' };
    }
    const title = typeof input.title === 'string' ? input.title.trim() : null;
    const thumbnailUrl = typeof input.thumbnail_url === 'string' ? input.thumbnail_url.trim() : null;
    let ordering = Number(input.ordering);
    if (!Number.isFinite(ordering) || ordering < 0) ordering = 0;
    ordering = Math.floor(ordering);
    return {
        ok: true,
        normalized: {
            kind: input.kind,
            url: urlStr,
            title: title || null,
            thumbnailUrl: thumbnailUrl || null,
            ordering,
        },
    };
}
