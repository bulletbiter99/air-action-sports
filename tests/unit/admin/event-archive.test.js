// Post-M6 Track C — combined tests for archiveLinks pure helpers + the
// admin event-archive route. Phase 1 (external links only).

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';
import { extractYouTubeId, buildEmbedUrl, validateLinkPayload } from '../../../worker/lib/archiveLinks.js';

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

describe('extractYouTubeId', () => {
    it('parses youtube.com/watch?v=ID', () => {
        expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('parses youtu.be/ID', () => {
        expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('parses youtube.com/embed/ID', () => {
        expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('parses youtube.com/shorts/ID', () => {
        expect(extractYouTubeId('https://www.youtube.com/shorts/abc123XYZ45')).toBe('abc123XYZ45');
    });

    it('parses youtube-nocookie.com/embed/ID', () => {
        expect(extractYouTubeId('https://www.youtube-nocookie.com/embed/abc123XYZ45')).toBe('abc123XYZ45');
    });

    it('parses m.youtube.com', () => {
        expect(extractYouTubeId('https://m.youtube.com/watch?v=abc123XYZ45')).toBe('abc123XYZ45');
    });

    it('returns null for non-YouTube URLs', () => {
        expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull();
        expect(extractYouTubeId('https://example.com/video.mp4')).toBeNull();
    });

    it('returns null for malformed input', () => {
        expect(extractYouTubeId('not-a-url')).toBeNull();
        expect(extractYouTubeId('')).toBeNull();
        expect(extractYouTubeId(null)).toBeNull();
        expect(extractYouTubeId(undefined)).toBeNull();
    });
});

describe('buildEmbedUrl', () => {
    it('returns YouTube embed URL for video kind', () => {
        const result = buildEmbedUrl({ kind: 'video', url: 'https://www.youtube.com/watch?v=ABC123XYZ45' });
        expect(result).toBe('https://www.youtube.com/embed/ABC123XYZ45?rel=0&modestbranding=1');
    });

    it('passes through photo kind URL', () => {
        const url = 'https://drive.google.com/file/d/12345/view';
        expect(buildEmbedUrl({ kind: 'photo', url })).toBe(url);
    });

    it('returns null for unrecognized video URL', () => {
        expect(buildEmbedUrl({ kind: 'video', url: 'https://vimeo.com/12345' })).toBeNull();
    });

    it('returns null for unknown kind', () => {
        expect(buildEmbedUrl({ kind: 'unknown', url: 'https://example.com' })).toBeNull();
    });

    it('returns null for null input', () => {
        expect(buildEmbedUrl(null)).toBeNull();
    });
});

describe('validateLinkPayload', () => {
    it('accepts a valid video link', () => {
        const r = validateLinkPayload({ kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' });
        expect(r.ok).toBe(true);
        expect(r.normalized.kind).toBe('video');
        expect(r.normalized.url).toBe('https://youtu.be/dQw4w9WgXcQ');
    });

    it('accepts a valid photo link with title + ordering', () => {
        const r = validateLinkPayload({
            kind: 'photo', url: 'https://drive.google.com/drive/folders/abc',
            title: 'Pit photos', ordering: 5,
        });
        expect(r.ok).toBe(true);
        expect(r.normalized.title).toBe('Pit photos');
        expect(r.normalized.ordering).toBe(5);
    });

    it('rejects non-https URL', () => {
        const r = validateLinkPayload({ kind: 'photo', url: 'http://example.com/img.jpg' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/https/);
    });

    it('rejects video URL that is not YouTube', () => {
        const r = validateLinkPayload({ kind: 'video', url: 'https://vimeo.com/12345' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/YouTube/);
    });

    it('rejects empty url', () => {
        expect(validateLinkPayload({ kind: 'video', url: '' }).ok).toBe(false);
    });

    it('rejects unknown kind', () => {
        expect(validateLinkPayload({ kind: 'audio', url: 'https://example.com/x.mp3' }).ok).toBe(false);
    });

    it('coerces ordering to non-negative integer', () => {
        const r1 = validateLinkPayload({ kind: 'video', url: 'https://youtu.be/A', ordering: -5 });
        expect(r1.normalized.ordering).toBe(0);
        const r2 = validateLinkPayload({ kind: 'video', url: 'https://youtu.be/A', ordering: 3.7 });
        expect(r2.normalized.ordering).toBe(3);
    });
});

// ────────────────────────────────────────────────────────────────────
// Admin route — GET /api/admin/event-archive + GET/PUT /:eventId
// ────────────────────────────────────────────────────────────────────

let env;
let cookieHeader;

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

function jsonReq(path, method, body, init = {}) {
    return req(path, {
        method,
        headers: { cookie: cookieHeader, 'content-type': 'application/json', ...(init.headers || {}) },
        body: JSON.stringify(body),
    });
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/event-archive', () => {
    it('returns 403 without events.archive.write capability', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await worker.fetch(req('/api/admin/event-archive', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(403);
    });

    it('returns past events with link counts', async () => {
        bindCapabilities(env.DB, 'u_owner', ['events.archive.write']);
        env.DB.__on(/FROM events e\s+LEFT JOIN/, {
            results: [
                { id: 'ev_1', slug: 'op-1', title: 'Op One', date_iso: '2025-06-01', location: 'Site G', video_count: 2, photo_count: 1 },
                { id: 'ev_2', slug: 'op-2', title: 'Op Two', date_iso: '2025-05-01', location: 'Site F', video_count: 0, photo_count: 0 },
            ],
        }, 'all');

        const res = await worker.fetch(req('/api/admin/event-archive', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.events).toHaveLength(2);
        expect(data.events[0].videoCount).toBe(2);
        expect(data.events[1].videoCount).toBe(0);
    });
});

describe('GET /api/admin/event-archive/:eventId', () => {
    it('returns 404 when event missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['events.archive.write']);
        env.DB.__on(/SELECT id, slug, title.*FROM events WHERE id = \?/, null, 'first');
        const res = await worker.fetch(req('/api/admin/event-archive/missing', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(404);
    });

    it('returns event + links with computed embedUrl', async () => {
        bindCapabilities(env.DB, 'u_owner', ['events.archive.write']);
        env.DB.__on(/SELECT id, slug, title.*FROM events WHERE id = \?/, {
            id: 'ev_1', slug: 'op-1', title: 'Op One', date_iso: '2025-06-01', past: 1,
        }, 'first');
        env.DB.__on(/FROM event_archive_links\s+WHERE event_id = \?/, {
            results: [
                { id: 'eal_a', kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Highlight reel', thumbnail_url: null, ordering: 0, created_at: 1000, updated_at: 1000 },
            ],
        }, 'all');

        const res = await worker.fetch(req('/api/admin/event-archive/ev_1', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.event.past).toBe(true);
        expect(data.links).toHaveLength(1);
        expect(data.links[0].embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1');
    });
});

describe('PUT /api/admin/event-archive/:eventId', () => {
    it('returns 403 without capability', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await worker.fetch(jsonReq('/api/admin/event-archive/ev_1', 'PUT', { links: [] }), env, {});
        expect(res.status).toBe(403);
    });

    it('returns 400 when body.links is not an array', async () => {
        bindCapabilities(env.DB, 'u_owner', ['events.archive.write']);
        const res = await worker.fetch(jsonReq('/api/admin/event-archive/ev_1', 'PUT', { links: 'oops' }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 404 when event missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['events.archive.write']);
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, null, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/event-archive/missing', 'PUT', { links: [] }), env, {});
        expect(res.status).toBe(404);
    });

    it('returns 400 on invalid link in array', async () => {
        bindCapabilities(env.DB, 'u_owner', ['events.archive.write']);
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'ev_1' }, 'first');
        const res = await worker.fetch(jsonReq('/api/admin/event-archive/ev_1', 'PUT', {
            links: [{ kind: 'video', url: 'http://insecure.com' }],
        }), env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/links\[0\]/);
    });

    it('full-replaces links: DELETEs then INSERTs each, writes audit', async () => {
        bindCapabilities(env.DB, 'u_owner', ['events.archive.write']);
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'ev_1' }, 'first');
        env.DB.__on(/DELETE FROM event_archive_links WHERE event_id = \?/, { meta: { changes: 5 } }, 'run');
        env.DB.__on(/INSERT INTO event_archive_links/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/event-archive/ev_1', 'PUT', {
            links: [
                { kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Highlight' },
                { kind: 'photo', url: 'https://drive.google.com/file/d/abc/view', ordering: 1 },
            ],
        }), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.linkCount).toBe(2);

        const writes = env.DB.__writes();
        const del = writes.find((w) => /DELETE FROM event_archive_links/.test(w.sql) && w.kind === 'run');
        expect(del).toBeDefined();
        const inserts = writes.filter((w) => /INSERT INTO event_archive_links/.test(w.sql) && w.kind === 'run');
        expect(inserts.length).toBe(2);
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('event_archive.updated'));
        expect(audit).toBeDefined();
    });
});
