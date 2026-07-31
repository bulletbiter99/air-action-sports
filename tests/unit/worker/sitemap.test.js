// Worker-served sitemap.xml (replaces the hand-maintained public/sitemap.xml).
//
// The defect this closes: the static file carried "Live event pages (add each
// on publish)" — an add step with no remove step — and had already drifted,
// omitting /games and /rules-of-engagement while listing two concluded events
// at priority 0.8 and missing three other archived-but-public events.

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';
import { buildSitemapXml, STATIC_ROUTES, SITEMAP_EVENTS_SQL } from '../../../worker/lib/sitemap.js';

const SITE = 'https://airactionsport.com';

describe('buildSitemapXml', () => {
    it('emits every static route with its priority', () => {
        const xml = buildSitemapXml({ siteUrl: SITE, events: [] });
        for (const r of STATIC_ROUTES) {
            expect(xml).toContain(`<loc>${SITE}${r.path}</loc>`);
        }
        // The two the hand-maintained file had lost.
        expect(xml).toContain(`<loc>${SITE}/games</loc>`);
        expect(xml).toContain(`<loc>${SITE}/rules-of-engagement</loc>`);
    });

    it('never lists a tokenized or private route', () => {
        const xml = buildSitemapXml({ siteUrl: SITE, events: [] });
        // Each of these carries a live per-booking/per-vendor credential in its
        // query string, or is a private surface. Indexing any of them leaks it.
        for (const p of ['/review', '/waiver', '/booking/success', '/booking/cancelled', '/booking/ticket', '/admin', '/portal', '/vendor', '/event/']) {
            expect(xml).not.toContain(`<loc>${SITE}${p}</loc>`);
        }
    });

    it('adds an entry per event with an ISO lastmod', () => {
        const xml = buildSitemapXml({
            siteUrl: SITE,
            events: [{ loc_slug: 'operation-last-light', updated_at: 1_785_265_375_716 }],
        });
        expect(xml).toContain(`<loc>${SITE}/events/operation-last-light</loc>`);
        expect(xml).toMatch(/<lastmod>2026-\d{2}-\d{2}T[\d:.]+Z<\/lastmod>/);
    });

    it('omits lastmod rather than emitting an invalid one', () => {
        // Number(null) === 0 (the recurring M5.5 lesson #7) — a null updated_at
        // must not become 1970-01-01, which would tell crawlers every event page
        // is 56 years stale.
        for (const bad of [null, undefined, 0, 'nonsense', NaN]) {
            const xml = buildSitemapXml({ siteUrl: SITE, events: [{ loc_slug: 'e', updated_at: bad }] });
            expect(xml).toContain(`<loc>${SITE}/events/e</loc>`);
            expect(xml).not.toContain('<lastmod>');
            expect(xml).not.toContain('1970');
        }
    });

    it('escapes XML entities so one bad slug cannot invalidate the document', () => {
        const xml = buildSitemapXml({ siteUrl: SITE, events: [{ loc_slug: 'a&b', updated_at: null }] });
        expect(xml).toContain('a&amp;b');
        expect(xml).not.toMatch(/events\/a&b/);
    });

    it('tolerates a trailing slash on SITE_URL without doubling it', () => {
        const xml = buildSitemapXml({ siteUrl: 'https://airactionsport.com/', events: [] });
        expect(xml).toContain('<loc>https://airactionsport.com/</loc>');
        expect(xml).not.toContain('//events');
    });

    it('is well-formed and declares the sitemap namespace', () => {
        const xml = buildSitemapXml({ siteUrl: SITE, events: [{ loc_slug: 'x', updated_at: 1_785_265_375_716 }] });
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
        expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
        expect((xml.match(/<url>/g) || []).length).toBe((xml.match(/<\/url>/g) || []).length);
    });
});

describe('SITEMAP_EVENTS_SQL', () => {
    it('mirrors the public visibility contract, not published-only', () => {
        // Archived events are permanently public since #404, so a published-only
        // sitemap would hide most of the site's real content.
        expect(SITEMAP_EVENTS_SQL).toMatch(/\(\s*published\s*=\s*1\s+OR\s+past\s*=\s*1\s*\)/);
    });
});

describe('GET /sitemap.xml', () => {
    let env; let ctx;
    beforeEach(() => { env = createWorkerEnv(); ctx = buildCtx(); });

    it('serves generated XML with the right content type', async () => {
        env.DB.__on(/FROM events/, { results: [{ loc_slug: 'operation-fire-storm', updated_at: 1_785_265_375_716 }] }, 'all');

        const res = await workerEntry.fetch(new Request(`${SITE}/sitemap.xml`), env, ctx);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/xml');
        const body = await res.text();
        expect(body).toContain('<loc>https://airactionsport.com/events/operation-fire-storm</loc>');
        expect(body).toContain('<loc>https://airactionsport.com/games</loc>');
    });

    it('still serves static routes when the events query fails', async () => {
        // A sitemap is not worth a 500 — degrade, do not fail.
        env.DB.__on(/FROM events/, () => { throw new Error('d1 down'); }, 'all');

        const res = await workerEntry.fetch(new Request(`${SITE}/sitemap.xml`), env, ctx);

        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('<loc>https://airactionsport.com/</loc>');
        expect(body).not.toContain('/events/');
    });
});
