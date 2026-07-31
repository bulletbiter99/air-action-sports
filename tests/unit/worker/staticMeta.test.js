// Per-route server-rendered meta for the static public pages.
//
// Two jobs here, and the second is the important one.
//
// 1. The rewrite works: /about serves About's real title, an unlisted path is
//    left alone, and the richer /events/:slug and / branches still win.
//
// 2. THE MIRROR CANNOT DRIFT. worker/lib/staticMeta.js duplicates each page's
//    <SEO> title/description because the worker cannot import from src/ (a page
//    module pulls in React, and top-level imports run on module load — the trap
//    that broke a deploy when worker/index.js transitively imported a Node-only
//    CLI script). A duplicate with no guard is exactly the pattern that has bitten
//    this repo repeatedly, so the drift test below reads the REAL page files and
//    compares. Change a page's <SEO> and this fails until the map is updated.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import workerEntry from '../../../worker/index.js';
import { STATIC_PAGE_META, metaForPath } from '../../../worker/lib/staticMeta.js';
import { createWorkerEnv, buildCtx, installHTMLRewriterMock } from '../../helpers/workerEnvFixture.js';

// Route -> page component file. Kept explicit rather than parsed out of App.jsx
// so a routing refactor surfaces here as a loud failure, not a silent skip.
const ROUTE_TO_PAGE = {
    '/': 'Home',
    '/about': 'About',
    '/booking': 'Booking',
    '/contact': 'Contact',
    '/faq': 'FAQ',
    '/gallery': 'Gallery',
    '/games': 'GameArchive',
    '/locations': 'Locations',
    '/new-players': 'NewPlayers',
    '/pricing': 'Pricing',
    '/privacy': 'Privacy',
    '/reviews': 'Reviews',
    '/rules-of-engagement': 'RulesOfEngagement',
    '/safety': 'Safety',
};

function seoPropsFor(component) {
    const path = `src/pages/${component}.jsx`;
    if (!existsSync(path)) return null;
    const src = readFileSync(path, 'utf8');
    const block = src.match(/<SEO\b([\s\S]*?)\/>/);
    if (!block) return null;
    const title = block[1].match(/title="([^"]+)"/);
    const description = block[1].match(/description="([^"]+)"/);
    if (!title || !description) return null;
    return { title: title[1], description: description[1] };
}

describe('staticMeta map — drift guard against the real pages', () => {
    it('covers every route in the route->page table', () => {
        expect(Object.keys(STATIC_PAGE_META).sort()).toEqual(Object.keys(ROUTE_TO_PAGE).sort());
    });

    for (const [route, component] of Object.entries(ROUTE_TO_PAGE)) {
        it(`${route} matches ${component}.jsx <SEO> exactly`, () => {
            const actual = seoPropsFor(component);
            // A null here means the page stopped using a literal <SEO> title or
            // moved — either way the map is now unverifiable and must be revisited.
            expect(actual, `could not read literal <SEO> props from ${component}.jsx`).not.toBeNull();
            expect(STATIC_PAGE_META[route]).toEqual(actual);
        });
    }
});

describe('metaForPath', () => {
    it('resolves a known route', () => {
        expect(metaForPath('/about').title).toContain('About Us');
    });

    it('tolerates one trailing slash', () => {
        expect(metaForPath('/about/')).toEqual(metaForPath('/about'));
    });

    it('returns null for anything unlisted — never borrows another page meta', () => {
        for (const p of ['/nope', '/waiver', '/review', '/vendor/login', '/events/x', '/about/x', '']) {
            expect(metaForPath(p), p).toBeNull();
        }
    });

    it('does not blow up on non-string input', () => {
        expect(metaForPath(null)).toBeNull();
        expect(metaForPath(undefined)).toBeNull();
    });
});

describe('static page meta injection', () => {
    let env; let ctx; let rewriter;
    beforeEach(() => { env = createWorkerEnv(); ctx = buildCtx(); rewriter = installHTMLRewriterMock(); });
    afterEach(() => rewriter.restore());

    function contentFor(selector) {
        const cap = rewriter.invokeHandler(selector);
        const set = (cap || []).find((c) => c.method === 'setInnerContent' || c.method === 'setAttribute');
        return set ? (set.content ?? set.value) : null;
    }

    it('serves the real title + description on /about', async () => {
        await workerEntry.fetch(new Request('https://airactionsport.com/about'), env, ctx);
        const selectors = rewriter.calls.map((c) => c.selector);
        expect(selectors).toContain('title');
        expect(selectors).toContain('meta[name="description"]');
        expect(selectors).toContain('meta[property="og:title"]');
        expect(selectors).toContain('meta[name="twitter:title"]');
        expect(contentFor('title')).toBe(STATIC_PAGE_META['/about'].title);
    });

    it('leaves an unlisted path completely untouched', async () => {
        // The pre-fix behaviour for EVERY page. A rewriter constructed here would
        // mean some path is silently borrowing another page's identity.
        await workerEntry.fetch(new Request('https://airactionsport.com/definitely-not-a-page'), env, ctx);
        expect(rewriter.calls).toHaveLength(0);
    });

    it('does not hijack the tokenized /review page', async () => {
        await workerEntry.fetch(new Request('https://airactionsport.com/review?token=abc'), env, ctx);
        expect(rewriter.calls).toHaveLength(0);
    });

    it('gives the home page its real title alongside the JSON-LD', async () => {
        env.DB.__on(/FROM reviews WHERE status = 'published'/, { average: 4.7, count: 3 }, 'first');
        await workerEntry.fetch(new Request('https://airactionsport.com/'), env, ctx);
        const selectors = rewriter.calls.map((c) => c.selector);
        expect(selectors).toContain('title');   // meta, which home never had
        expect(selectors).toContain('head');    // and the JSON-LD, which it did
        expect(contentFor('title')).toBe(STATIC_PAGE_META['/'].title);
    });
});
