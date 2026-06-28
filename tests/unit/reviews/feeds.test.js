// Batch 3 — public read feeds: GET /api/reviews?event=, /summary, /all.
import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

const EVENT_RESOLVE = /FROM events WHERE id = \? OR slug = \?/;
const EVENT_REVIEWS = /FROM reviews WHERE event_id = \? AND status = 'published'/;
const OVERALL = /AVG\(rating\)[\s\S]*FROM reviews WHERE status = 'published'/;
const JOINED = /FROM reviews r JOIN events e[\s\S]*ORDER BY r\.created_at DESC/;
const PER_EVENT = /GROUP BY e\.id/;

function req(path) {
    return new Request(`https://airactionsport.com${path}`);
}
// A raw row carrying fields that must NEVER reach the public response.
function leakyRow(over = {}) {
    return {
        id: 'rv_1', rating: 5, title: 'Great', comment: 'Fun', author_name: 'Jane D.', created_at: 1000,
        email: 'jane@x.com', booking_id: 'bk_1', ip_hash: 'deadbeef', status: 'published', event_id: 'ev_1',
        event_slug: 'op', event_title: 'Op', ...over,
    };
}

describe('GET /api/reviews?event=', () => {
    it('400 without an event param', async () => {
        const res = await worker.fetch(req('/api/reviews'), createMockEnv(), {});
        expect(res.status).toBe(400);
    });

    it('404 for an unknown event', async () => {
        const env = createMockEnv();
        env.DB.__on(EVENT_RESOLVE, null, 'first');
        const res = await worker.fetch(req('/api/reviews?event=nope'), env, {});
        expect(res.status).toBe(404);
    });

    it('returns average + count + whitelisted reviews', async () => {
        const env = createMockEnv();
        env.DB.__on(EVENT_RESOLVE, { id: 'ev_1', slug: 'op', title: 'Op' }, 'first');
        env.DB.__on(EVENT_REVIEWS, { average: 4.5, count: 2 }, 'first');
        env.DB.__on(EVENT_REVIEWS, { results: [leakyRow()] }, 'all');
        const res = await worker.fetch(req('/api/reviews?event=op'), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toMatchObject({ event: { id: 'ev_1', slug: 'op', title: 'Op' }, average: 4.5, count: 2 });
        expect(json.reviews[0]).toEqual({ id: 'rv_1', rating: 5, title: 'Great', comment: 'Fun', authorName: 'Jane D.', publishedAt: 1000 });
        // Whitelist: no private fields leak.
        const blob = JSON.stringify(json);
        for (const leak of ['jane@x.com', 'bk_1', 'deadbeef', 'ip_hash', '"status"', 'booking_id']) {
            expect(blob).not.toContain(leak);
        }
    });

    it('reports average null + count 0 when an event has no reviews', async () => {
        const env = createMockEnv();
        env.DB.__on(EVENT_RESOLVE, { id: 'ev_1', slug: 'op', title: 'Op' }, 'first');
        env.DB.__on(EVENT_REVIEWS, { average: null, count: 0 }, 'first');
        env.DB.__on(EVENT_REVIEWS, { results: [] }, 'all');
        const res = await worker.fetch(req('/api/reviews?event=op'), env, {});
        const json = await res.json();
        expect(json.average).toBeNull();
        expect(json.count).toBe(0);
        expect(json.reviews).toEqual([]);
    });
});

describe('GET /api/reviews/summary', () => {
    it('returns overall + recent (with event), whitelisted', async () => {
        const env = createMockEnv();
        env.DB.__on(OVERALL, { average: 4.7, count: 12 }, 'first');
        env.DB.__on(JOINED, { results: [leakyRow()] }, 'all');
        const res = await worker.fetch(req('/api/reviews/summary'), env, {});
        const json = await res.json();
        expect(json.overall).toEqual({ average: 4.7, count: 12 });
        expect(json.recent[0]).toEqual({
            id: 'rv_1', rating: 5, title: 'Great', comment: 'Fun', authorName: 'Jane D.', publishedAt: 1000,
            event: { slug: 'op', title: 'Op' },
        });
        expect(json).not.toHaveProperty('perEvent');
        expect(JSON.stringify(json)).not.toContain('jane@x.com');
    });

    it('zero state → average null, count 0, empty recent', async () => {
        const env = createMockEnv();
        env.DB.__on(OVERALL, { average: null, count: 0 }, 'first');
        env.DB.__on(JOINED, { results: [] }, 'all');
        const res = await worker.fetch(req('/api/reviews/summary'), env, {});
        const json = await res.json();
        expect(json.overall).toEqual({ average: null, count: 0 });
        expect(json.recent).toEqual([]);
    });

    it('includes perEvent breakdown when perEvent=1', async () => {
        const env = createMockEnv();
        env.DB.__on(OVERALL, { average: 4.7, count: 12 }, 'first');
        env.DB.__on(JOINED, { results: [] }, 'all');
        env.DB.__on(PER_EVENT, { results: [{ event_id: 'ev_1', event_slug: 'op', event_title: 'Op', average: 4.7, count: 12 }] }, 'all');
        const res = await worker.fetch(req('/api/reviews/summary?perEvent=1'), env, {});
        const json = await res.json();
        expect(json.perEvent).toEqual([{ slug: 'op', title: 'Op', average: 4.7, count: 12 }]);
    });
});

describe('GET /api/reviews/all', () => {
    it('returns total + average + whitelisted reviews with event', async () => {
        const env = createMockEnv();
        env.DB.__on(OVERALL, { average: 4.6, total: 23 }, 'first');
        env.DB.__on(JOINED, { results: [leakyRow()] }, 'all');
        const res = await worker.fetch(req('/api/reviews/all'), env, {});
        const json = await res.json();
        expect(json).toMatchObject({ total: 23, average: 4.6 });
        expect(json.reviews[0]).toEqual({
            id: 'rv_1', rating: 5, title: 'Great', comment: 'Fun', authorName: 'Jane D.', publishedAt: 1000,
            event: { slug: 'op', title: 'Op' },
        });
        expect(JSON.stringify(json)).not.toContain('deadbeef');
    });

    it('zero state → total 0, average null', async () => {
        const env = createMockEnv();
        env.DB.__on(OVERALL, { average: null, total: 0 }, 'first');
        env.DB.__on(JOINED, { results: [] }, 'all');
        const res = await worker.fetch(req('/api/reviews/all'), env, {});
        const json = await res.json();
        expect(json.total).toBe(0);
        expect(json.average).toBeNull();
    });
});
