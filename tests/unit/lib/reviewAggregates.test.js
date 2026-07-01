// Batch 4 — server-side review aggregates + JSON-LD builders + the mandatory
// </script>-escaping serializer (attendee-verified reviews, 0077).

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    getOrgReviewAggregate,
    getEventReviewBundle,
    serializeJsonLd,
    buildOrgJsonLd,
    buildEventJsonLd,
} from '../../../worker/lib/reviewAggregates.js';

const ORG = /FROM reviews WHERE status = 'published'/;
const EVENT_AGG = /FROM reviews WHERE event_id = \? AND status = 'published'/;

describe('getOrgReviewAggregate', () => {
    it('returns {average,count} when published reviews exist', async () => {
        const env = createMockEnv();
        env.DB.__on(ORG, { average: 4.8, count: 10 }, 'first');
        expect(await getOrgReviewAggregate(env)).toEqual({ average: 4.8, count: 10 });
    });
    it('returns null at zero reviews (so the injector omits the block)', async () => {
        const env = createMockEnv();
        env.DB.__on(ORG, { average: null, count: 0 }, 'first');
        expect(await getOrgReviewAggregate(env)).toBeNull();
    });
    it('returns null on a query error (e.g. table missing pre-migration)', async () => {
        const env = createMockEnv();
        env.DB.__on(ORG, () => { throw new Error('no such table: reviews'); }, 'first');
        expect(await getOrgReviewAggregate(env)).toBeNull();
    });
    it('uses the shared status=published predicate (= the public route + admin avg)', async () => {
        const env = createMockEnv();
        await getOrgReviewAggregate(env);
        expect(env.DB.__writes()[0].sql).toMatch(/WHERE status = 'published'/);
    });
});

describe('getEventReviewBundle', () => {
    it('returns null without an eventId (no query issued)', async () => {
        const env = createMockEnv();
        expect(await getEventReviewBundle(env, '')).toBeNull();
        expect(env.DB.__writes()).toHaveLength(0);
    });
    it('returns null when the event has no published reviews', async () => {
        const env = createMockEnv();
        env.DB.__on(EVENT_AGG, { average: null, count: 0 }, 'first');
        expect(await getEventReviewBundle(env, 'ev_1')).toBeNull();
    });
    it('returns aggregate + recent reviews when present', async () => {
        const env = createMockEnv();
        env.DB.__on(EVENT_AGG, { average: 4.5, count: 3 }, 'first');
        env.DB.__on(EVENT_AGG, { results: [{ rating: 5, title: 'A', comment: 'B', author_name: 'Jane D.', created_at: 1000 }] }, 'all');
        const out = await getEventReviewBundle(env, 'ev_1');
        expect(out.aggregate).toEqual({ average: 4.5, count: 3 });
        expect(out.reviews).toHaveLength(1);
    });
    it('returns null on a query error', async () => {
        const env = createMockEnv();
        env.DB.__on(EVENT_AGG, () => { throw new Error('boom'); }, 'first');
        expect(await getEventReviewBundle(env, 'ev_1')).toBeNull();
    });
});

describe('serializeJsonLd — XSS / breakout escaping', () => {
    it('neutralizes a </script> breakout in review text (the critical guard)', () => {
        const malicious = '</script><img src=x onerror=alert(1)>';
        const obj = { '@type': 'Review', reviewBody: malicious, author: { name: 'a</script>b' } };
        const out = serializeJsonLd(obj);
        expect(out).not.toContain('</script>');
        expect(out).not.toContain('<img');
        expect(out).not.toContain('<');           // every < is escaped
        expect(out).toContain('\\u003c');          // ...to <
        // Still valid JSON the crawler can parse back to the original text.
        expect(JSON.parse(out).reviewBody).toBe(malicious);
    });
    it('escapes >, &, and the U+2028/U+2029 JS line separators', () => {
        // Build the input with fromCharCode so the source stays pure ASCII — a
        // literal U+2028/U+2029 in source can itself confuse parsers.
        const u2028 = String.fromCharCode(0x2028);
        const u2029 = String.fromCharCode(0x2029);
        const out = serializeJsonLd({ a: `> &${u2028}${u2029}` });
        expect(out).toContain('\\u003e');
        expect(out).toContain('\\u0026');
        expect(out).toContain('\\u2028');
        expect(out).toContain('\\u2029');
        // No raw separators remain in the output.
        expect(out.includes(u2028)).toBe(false);
        expect(out.includes(u2029)).toBe(false);
    });
});

describe('buildOrgJsonLd', () => {
    it('includes aggregateRating when an aggregate is supplied', () => {
        const obj = buildOrgJsonLd({ siteUrl: 'https://x.com', aggregate: { average: 4.8, count: 10 } });
        expect(obj['@type']).toBe('LocalBusiness');
        expect(obj.url).toBe('https://x.com');
        expect(obj.aggregateRating).toMatchObject({ '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '10', bestRating: '5', worstRating: '1' });
    });
    it('omits aggregateRating when no aggregate', () => {
        expect(buildOrgJsonLd({ siteUrl: 'https://x.com' })).not.toHaveProperty('aggregateRating');
    });
});

describe('buildEventJsonLd', () => {
    const event = { title: 'Operation Last Light', date_iso: '2026-07-25T09:00:00', end_date_iso: null, location: 'Ghost Town — Hiawatha, UT' };
    const bundle = {
        aggregate: { average: 4.6, count: 2 },
        reviews: [
            { rating: 5, title: 'Epic', comment: 'Loved it', author_name: 'Jane D.', created_at: Date.UTC(2026, 6, 26) },
            { rating: 4, title: null, comment: null, author_name: 'Sam R.', created_at: Date.UTC(2026, 6, 27) },
        ],
    };
    it('builds an Event node with aggregateRating + mapped reviews', () => {
        const obj = buildEventJsonLd({ siteUrl: 'https://x.com', slug: 'operation-last-light', event, bundle });
        expect(obj['@type']).toBe('Event');
        expect(obj.name).toBe('Operation Last Light');
        expect(obj.url).toBe('https://x.com/events/operation-last-light');
        expect(obj.startDate).toBe('2026-07-25T09:00:00');
        expect(obj).not.toHaveProperty('endDate');           // single-day → no endDate (not an instant op)
        expect(obj.location).toMatchObject({ '@type': 'Place', name: 'Ghost Town — Hiawatha, UT' });
        expect(obj.aggregateRating).toMatchObject({ ratingValue: '4.6', reviewCount: '2' });
        expect(obj.review).toHaveLength(2);
        expect(obj.review[0]).toMatchObject({
            '@type': 'Review',
            reviewRating: { ratingValue: '5', bestRating: '5', worstRating: '1' },
            author: { '@type': 'Person', name: 'Jane D.' },
            name: 'Epic', reviewBody: 'Loved it', datePublished: '2026-07-26',
        });
        // Null title/comment omitted.
        expect(obj.review[1]).not.toHaveProperty('name');
        expect(obj.review[1]).not.toHaveProperty('reviewBody');
    });
    it('omits aggregateRating/review when no bundle', () => {
        const obj = buildEventJsonLd({ siteUrl: 'https://x.com', slug: 's', event, bundle: null });
        expect(obj).not.toHaveProperty('aggregateRating');
        expect(obj).not.toHaveProperty('review');
    });
    it('emits endDate only for a genuine multi-day event', () => {
        const multiDay = { ...event, end_date_iso: '2026-07-26T20:00:00' };
        const obj = buildEventJsonLd({ siteUrl: 'https://x.com', slug: 's', event: multiDay, bundle: null });
        expect(obj.startDate).toBe('2026-07-25T09:00:00');
        expect(obj.endDate).toBe('2026-07-26T20:00:00');
    });
});
