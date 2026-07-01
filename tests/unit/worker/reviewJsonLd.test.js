// Batch 4 — server-injected review JSON-LD (home Organization + per-event Event).
// Verifies the Worker appends a <script type="application/ld+json"> into <head>
// ONLY when published reviews exist, and that review text is </script>-escaped.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx, installHTMLRewriterMock } from '../../helpers/workerEnvFixture.js';

const ORG = /FROM reviews WHERE status = 'published'/;
const EVENT_AGG = /FROM reviews WHERE event_id = \? AND status = 'published'/;
const EVENT_ROW = /SELECT title, display_date, location/;

function headContent(rewriter) {
    const cap = rewriter.invokeHandler('head');
    const append = (cap || []).find((c) => c.method === 'append');
    return append ? append.content : null;
}

describe('home Organization JSON-LD injection (Batch 4)', () => {
    let env; let ctx; let rewriter;
    beforeEach(() => { env = createWorkerEnv(); ctx = buildCtx(); rewriter = installHTMLRewriterMock(); });
    afterEach(() => rewriter.restore());

    it('injects a LocalBusiness aggregateRating into <head> when reviews exist', async () => {
        env.DB.__on(ORG, { average: 4.8, count: 10 }, 'first');
        await workerEntry.fetch(new Request('https://airactionsport.com/'), env, ctx);
        expect(rewriter.calls.map((c) => c.selector)).toContain('head');
        const content = headContent(rewriter);
        expect(content).toContain('<script type="application/ld+json">');
        expect(content).toContain('"@type":"LocalBusiness"');
        expect(content).toContain('"aggregateRating"');
        expect(content).toContain('"ratingValue":"4.8"');
        expect(content).toContain('"reviewCount":"10"');
    });

    it('injects NOTHING on the home page when there are zero reviews', async () => {
        env.DB.__on(ORG, { average: null, count: 0 }, 'first');
        await workerEntry.fetch(new Request('https://airactionsport.com/'), env, ctx);
        expect(rewriter.calls).toHaveLength(0);   // rewriter never constructed
    });
});

describe('per-event Event JSON-LD injection (Batch 4)', () => {
    let env; let ctx; let rewriter;
    beforeEach(() => { env = createWorkerEnv(); ctx = buildCtx(); rewriter = installHTMLRewriterMock(); });
    afterEach(() => rewriter.restore());

    const eventRow = {
        title: 'Operation Last Light', display_date: '25 July 2026', location: 'Ghost Town — Hiawatha, UT',
        short_description: 'A 12-hour mission op.', cover_image_url: null, og_image_url: null,
        id: 'ev_oll', date_iso: '2026-07-25T09:00:00', end_date_iso: null,
    };

    it('appends an Event aggregateRating when the event has published reviews', async () => {
        env.DB.__on(EVENT_ROW, eventRow, 'first');
        env.DB.__on(EVENT_AGG, { average: 4.6, count: 2 }, 'first');
        env.DB.__on(EVENT_AGG, { results: [{ rating: 5, title: 'Epic', comment: 'Loved it', author_name: 'Jane D.', created_at: Date.UTC(2026, 6, 26) }] }, 'all');

        await workerEntry.fetch(new Request('https://airactionsport.com/events/operation-last-light'), env, ctx);

        const selectors = rewriter.calls.map((c) => c.selector);
        expect(selectors).toContain('head');         // 10 meta + head
        expect(selectors.filter((s) => s !== 'head')).toHaveLength(10);  // meta rewrites untouched
        const content = headContent(rewriter);
        expect(content).toContain('"@type":"Event"');
        expect(content).toContain('"aggregateRating"');
        expect(content).toContain('"ratingValue":"4.6"');
        expect(content).toContain('"@type":"Review"');
    });

    it('escapes a </script> breakout in review text (stored-XSS guard)', async () => {
        env.DB.__on(EVENT_ROW, eventRow, 'first');
        env.DB.__on(EVENT_AGG, { average: 1, count: 1 }, 'first');
        env.DB.__on(EVENT_AGG, { results: [{ rating: 1, title: null, comment: '</script><img src=x onerror=alert(1)>', author_name: 'Hax</script>', created_at: Date.UTC(2026, 6, 26) }] }, 'all');

        await workerEntry.fetch(new Request('https://airactionsport.com/events/operation-last-light'), env, ctx);
        const content = headContent(rewriter);
        // The only </script> is the wrapper close; the review's is escaped.
        expect((content.match(/<\/script>/g) || []).length).toBe(1);
        expect(content).toContain('\\u003c/script\\u003e');
        expect(content).not.toContain('<img');
    });

    it('does NOT add a head handler for an event with no reviews (byte-identical)', async () => {
        env.DB.__on(EVENT_ROW, eventRow, 'first');
        env.DB.__on(EVENT_AGG, { average: null, count: 0 }, 'first');
        await workerEntry.fetch(new Request('https://airactionsport.com/events/operation-last-light'), env, ctx);
        expect(rewriter.calls.map((c) => c.selector)).not.toContain('head');
        expect(rewriter.calls).toHaveLength(10);   // exactly the 10 meta rewrites
    });
});
