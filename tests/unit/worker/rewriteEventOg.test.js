// audit Group G #68-#69 — worker/index.js rewriteEventOg
//
// Per-event social unfurls. Scrapers (Facebook, iMessage, Slack, Twitter)
// don't run JS; HTMLRewriter injects real values into the SPA shell. Per
// docs/audit/06-do-not-touch.md (Critical), the event lookup is intentionally
// tight (single LIMIT 1 query) to keep page latency low.
//
// G68: Injects per-event title, meta description, og:*, twitter:* tags
// G69: Falls through to plain SPA shell on event-not-found
//
// HTMLRewriter is a Cloudflare runtime API absent in Node. tests/helpers/
// workerEnvFixture.js installs a mock that captures on(selector, handler)
// registrations + invokeHandler(selector) simulates the Cloudflare runtime
// invoking the handler against a real DOM element.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import {
    createWorkerEnv,
    buildCtx,
    installHTMLRewriterMock,
} from '../../helpers/workerEnvFixture.js';

describe('worker/index.js rewriteEventOg (Group G #68-#69)', () => {
    let env;
    let ctx;
    let rewriter;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
        rewriter = installHTMLRewriterMock();
    });

    afterEach(() => {
        rewriter.restore();
    });

    describe('G68 — injects per-event meta when event is published', () => {
        const eventRow = {
            title: 'Operation Nightfall',
            display_date: '9 May 2026',
            location: 'Ghost Town — rural neighborhood',
            short_description: 'Several hours of nonstop airsoft action.',
            cover_image_url: 'https://airactionsport.com/uploads/events/cover.png',
            og_image_url: 'https://airactionsport.com/uploads/events/og.png',
        };

        beforeEach(() => {
            env.DB.__on(/SELECT title, display_date, location/, eventRow, 'first');
        });

        it('looks up event by id-or-slug and only when published=1', async () => {
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const writes = env.DB.__writes();
            const lookup = writes.find((w) => /SELECT title, display_date, location/.test(w.sql));
            expect(lookup).toBeDefined();
            // Both binds are the slug — id and slug columns checked
            expect(lookup.args).toEqual(['operation-nightfall', 'operation-nightfall']);
            // The published filter is hard-coded
            expect(lookup.sql).toMatch(/published\s*=\s*1/);
            // LIMIT 1 — keep the per-request lookup cheap (audit DNT note)
            expect(lookup.sql).toMatch(/LIMIT 1/);
        });

        it('registers HTMLRewriter handlers for all 10 SEO selectors', async () => {
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const selectors = rewriter.calls.map((c) => c.selector);
            expect(selectors).toEqual([
                'title',
                'meta[name="description"]',
                'meta[property="og:title"]',
                'meta[property="og:description"]',
                'meta[property="og:url"]',
                'meta[property="og:image"]',
                'meta[property="og:type"]',
                'meta[name="twitter:title"]',
                'meta[name="twitter:description"]',
                'meta[name="twitter:image"]',
            ]);
        });

        it('title element gets the event title + display date, html:false (XSS-safe)', async () => {
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const captured = rewriter.invokeHandler('title');
            expect(captured).toEqual([{
                method: 'setInnerContent',
                content: 'Operation Nightfall — 9 May 2026 | Air Action Sports',
                opts: { html: false },
            }]);
        });

        it('meta description uses short_description when present', async () => {
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const captured = rewriter.invokeHandler('meta[name="description"]');
            expect(captured[0]).toEqual({
                method: 'setAttribute',
                name: 'content',
                value: 'Several hours of nonstop airsoft action.',
            });
        });

        it('og:title and og:description match the rendered title/description', async () => {
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const ogTitle = rewriter.invokeHandler('meta[property="og:title"]');
            expect(ogTitle[0].value).toBe('Operation Nightfall — 9 May 2026 | Air Action Sports');

            const ogDesc = rewriter.invokeHandler('meta[property="og:description"]');
            expect(ogDesc[0].value).toBe('Several hours of nonstop airsoft action.');
        });

        it('og:url uses SITE_URL + the requested slug', async () => {
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const ogUrl = rewriter.invokeHandler('meta[property="og:url"]');
            expect(ogUrl[0].value).toBe('https://airactionsport.com/events/operation-nightfall');
        });

        it('og:image prefers og_image_url, falls back to cover_image_url, then site default', async () => {
            // 1) og_image_url present → used
            let req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);
            let ogImg = rewriter.invokeHandler('meta[property="og:image"]');
            expect(ogImg[0].value).toBe('https://airactionsport.com/uploads/events/og.png');

            // 2) og_image_url absent, cover_image_url present
            env.DB.__reset();
            env.DB.__on(/SELECT title/, { ...eventRow, og_image_url: null }, 'first');
            rewriter.calls.length = 0;
            req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);
            ogImg = rewriter.invokeHandler('meta[property="og:image"]');
            expect(ogImg[0].value).toBe('https://airactionsport.com/uploads/events/cover.png');

            // 3) both absent — site-wide default
            env.DB.__reset();
            env.DB.__on(/SELECT title/, { ...eventRow, og_image_url: null, cover_image_url: null }, 'first');
            rewriter.calls.length = 0;
            req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);
            ogImg = rewriter.invokeHandler('meta[property="og:image"]');
            expect(ogImg[0].value).toBe('https://airactionsport.com/images/og-image.jpg');
        });

        it('og:type set to "article" (event-detail pages)', async () => {
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const ogType = rewriter.invokeHandler('meta[property="og:type"]');
            expect(ogType[0].value).toBe('article');
        });

        it('synthesizes description when short_description is missing', async () => {
            env.DB.__reset();
            env.DB.__on(/SELECT title/, { ...eventRow, short_description: null }, 'first');
            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            await workerEntry.fetch(req, env, ctx);

            const desc = rewriter.invokeHandler('meta[name="description"]');
            // Synthesizes "<title> airsoft event at <location-prefix> on <display_date>. Book your slot now."
            expect(desc[0].value).toMatch(/^Operation Nightfall airsoft event at Ghost Town on 9 May 2026/);
            expect(desc[0].value).toContain('Book your slot now');
        });
    });

    describe('G69 — falls through to plain SPA shell when event missing', () => {
        it('event-not-found: no rewriter constructed, ASSETS shell returned as-is', async () => {
            // DB returns null (no row matched)
            env.DB.__on(/SELECT title/, null, 'first');

            const req = new Request('https://airactionsport.com/events/nonexistent-event');
            const res = await workerEntry.fetch(req, env, ctx);

            // No HTMLRewriter handlers registered (the function returned origin
            // before constructing the rewriter)
            expect(rewriter.calls).toHaveLength(0);
            // Status comes from the ASSETS fallback (200 in our mock)
            expect(res.status).toBe(200);
        });

        it('ASSETS binding missing: returns null/undefined response (caught by handleRequest)', async () => {
            env.ASSETS = undefined;
            env.DB.__on(/SELECT title/, null, 'first');

            const req = new Request('https://airactionsport.com/events/operation-nightfall');
            // The Worker dispatch falls through to env.ASSETS.fetch at the end
            // when rewriteEventOg returns null. Without ASSETS, handleRequest
            // throws — but the outer fetch catches via Hono's onError equivalent.
            // We assert the test runs without crashing and rewriter wasn't used.
            await expect(workerEntry.fetch(req, env, ctx)).rejects.toThrow();
            expect(rewriter.calls).toHaveLength(0);
        });
    });

    describe('slug parsing', () => {
        // The parseEventSlug regex is /^\/events\/([^/?#]+)\/?$/
        // — accepts /events/<slug> and /events/<slug>/ but not /events alone.

        it('does NOT trigger rewriter for /events (no slug)', async () => {
            const req = new Request('https://airactionsport.com/events');
            await workerEntry.fetch(req, env, ctx);
            expect(rewriter.calls).toHaveLength(0);
        });

        it('trailing slash is accepted (/events/slug/)', async () => {
            env.DB.__on(/SELECT title/, {
                title: 'X', display_date: 'Y', location: 'Z',
                short_description: 'desc', cover_image_url: null, og_image_url: null,
            }, 'first');
            const req = new Request('https://airactionsport.com/events/slug-here/');
            await workerEntry.fetch(req, env, ctx);
            expect(rewriter.calls.length).toBeGreaterThan(0);
        });

        it('slug with query string strips the query before lookup', async () => {
            env.DB.__on(/SELECT title/, {
                title: 'X', display_date: 'Y', location: 'Z',
                short_description: 'desc', cover_image_url: null, og_image_url: null,
            }, 'first');
            const req = new Request('https://airactionsport.com/events/slug-x?utm=fb');
            await workerEntry.fetch(req, env, ctx);

            const writes = env.DB.__writes();
            const lookup = writes.find((w) => /SELECT title/.test(w.sql));
            expect(lookup.args[0]).toBe('slug-x');
        });

        it('decodes URL-encoded slug', async () => {
            env.DB.__on(/SELECT title/, {
                title: 'X', display_date: 'Y', location: 'Z',
                short_description: 'desc', cover_image_url: null, og_image_url: null,
            }, 'first');
            const req = new Request('https://airactionsport.com/events/event%20with%20spaces');
            await workerEntry.fetch(req, env, ctx);

            const writes = env.DB.__writes();
            const lookup = writes.find((w) => /SELECT title/.test(w.sql));
            expect(lookup.args[0]).toBe('event with spaces');
        });
    });
});
