// Route-mock layer + representative fixtures for the PUBLIC visual-regression
// suite (2026-07-02 — conversion from live-prod capture to the proven
// tests/visual-admin local-serve + route-mock harness).
//
// WHY MOCKS (a philosophy change from the original M4 design): the suite used
// to screenshot LIVE airactionsport.com. Discovered 2026-07-01: /api/events had
// NEVER successfully loaded from GitHub-runner CI — the committed
// events-listing baseline AND the original M4 capture (860d13a) both show the
// "Couldn't load events. Please refresh in a moment." error state. Every
// capture + compare reproduced the same failure, so the check sat stable-green
// while event content (home hero/cards/countdown, events grid, event detail)
// had ZERO real visual coverage. /api/events returns Cache-Control: no-store
// (never edge-cached) and has no rate limiter; the leading suspect is
// Cloudflare bot management challenging datacenter-IP XHR from headless
// Chrome. Rather than allowlisting CI traffic against production, the suite
// now serves the built SPA locally (playwright.public.config.js webServer) and
// route-mocks /api/* with the representative fixtures below — deterministic
// pixels (no more live-prod races / recapture churn), and event content is
// finally pixel-locked. See docs/runbooks/visual-regression.md.
//
// Fixture shapes mirror the real serializers:
//   * events  — formatEvent + formatTicketType (worker/lib/formatters.js)
//               inside the /api/events envelopes (worker/routes/events.js:
//               list adds ticketTypes[] + seatsSold per event)
//   * reviews — publicReview / publicReviewWithEvent (worker/routes/reviews.js)
//   * sites   — formatPublicSite (worker/routes/sites.js)
//
// Determinism: installPublicMocks() freezes the browser clock
// (page.clock.setFixedTime) so the home CountdownTimer, spots signals, and any
// "days until" math render identical pixels on every run; the config pins
// timezoneId + locale so toLocale* date renders are reproducible. Fixture
// images are static /images/* assets that ship in dist/ — never Worker-only
// /uploads/* keys, which the local preview server can't serve.

// Frozen "now" for every capture — a fixed instant safely BEFORE the fixture
// event dates, so countdowns and spots read as upcoming. 09:00 Denver time.
export const FROZEN_NOW = new Date('2026-07-01T09:00:00-06:00');

// Static assets that ship in dist/ (from public/images/).
const IMG_GHOST = '/images/ghost-town.jpg';
const IMG_TRENCH = '/images/trench-warfare.jpg';
const IMG_FOXTROT = '/images/foxtrot-fields.jpeg';

/**
 * Single-day event — details:null so EventDetail renders every hardcoded
 * fallback section (rules, terrain, briefing), like most real events.
 * Featured, so it's the home hero + countdown + booking preselect target.
 */
export function mockEventSingle() {
    return {
        id: 'evt_mock_single',
        title: 'Operation Mock Alpha',
        slug: 'operation-mock-alpha',
        dateIso: '2026-07-25T08:30:00',
        endDateIso: null,
        displayDay: '25',
        displayMonth: 'July 2026',
        displayDate: '',
        location: 'Ghost Town — Hiawatha, UT',
        site: '',
        type: 'milsim',
        timeRange: '9:00 AM – 9:00 PM',
        checkIn: '8:30 AM',
        firstGame: '9:00 AM',
        endTime: '9:00 PM',
        basePriceCents: 6000,
        basePriceDisplay: '$60/head',
        totalSlots: 80,
        coverImageUrl: IMG_GHOST,
        cardImageUrl: IMG_GHOST,
        heroImageUrl: IMG_GHOST,
        bannerImageUrl: IMG_GHOST,
        ogImageUrl: null,
        cardOverlayOpacity: null,
        heroOverlayOpacity: null,
        bannerOverlayOpacity: null,
        cardImagePosition: '50% 40%',
        heroImagePosition: '50% 40%',
        bannerImagePosition: '50% 40%',
        shortDescription: 'A single-day 12-hour mission op. Two factions, one objective, zero respawn sympathy.',
        addons: [],
        gameModes: ['Milsim', 'Objective Play'],
        details: null,
        customQuestions: [],
        salesCloseAt: null,
        past: false,
        featured: true,
        seatsSold: 25,
        ticketTypes: [
            { id: 'tt_mock_std', eventId: 'evt_mock_single', name: 'Standard Entry', description: 'Full-day admission — bring your own gear.', priceCents: 6000, priceDisplay: '$60.00', capacity: 80, sold: 25, remaining: 55, soldOut: false, minPerOrder: 1, maxPerOrder: 10, saleStartsAt: null, saleEndsAt: null, sortOrder: 0 },
            { id: 'tt_mock_rental', eventId: 'evt_mock_single', name: 'Entry + Rental Package', description: 'Admission plus rifle, mask, and starter BBs.', priceCents: 8500, priceDisplay: '$85.00', capacity: 20, sold: 6, remaining: 14, soldOut: false, minPerOrder: 1, maxPerOrder: 4, saleStartsAt: null, saleEndsAt: null, sortOrder: 1 },
        ],
    };
}

/**
 * Multi-day (overnight) event — endDateIso spans a later day, so isMultiDay
 * drives the displayDate range label; the day-keyed details.schedule renders
 * the "Day N"-grouped Operation Timeline; documents/briefing exercise the
 * data-driven detail sections (the paths details:null never touches).
 */
export function mockEventMultiDay() {
    return {
        id: 'evt_mock_multiday',
        title: 'Operation Mock Overnight',
        slug: 'operation-mock-overnight',
        dateIso: '2026-08-15T19:45:00',
        endDateIso: '2026-08-16T12:00:00',
        displayDay: '15',
        displayMonth: 'August 2026',
        displayDate: '15–16 August 2026',
        location: 'Foxtrot Fields — Kaysville, UT',
        site: '',
        type: 'milsim',
        timeRange: '8:00 PM – 12:00 PM',
        checkIn: '7:45 PM',
        firstGame: '9:00 PM',
        endTime: '12:00 PM (Day 2)',
        basePriceCents: 8000,
        basePriceDisplay: '$80/head',
        totalSlots: 60,
        coverImageUrl: IMG_TRENCH,
        cardImageUrl: IMG_TRENCH,
        heroImageUrl: IMG_TRENCH,
        bannerImageUrl: IMG_TRENCH,
        ogImageUrl: null,
        cardOverlayOpacity: null,
        heroOverlayOpacity: null,
        bannerOverlayOpacity: null,
        cardImagePosition: null,
        heroImagePosition: null,
        bannerImagePosition: null,
        shortDescription: 'A 16-hour overnight operation. Limited ammo, night vision recommended, sleep optional.',
        addons: [],
        gameModes: ['Milsim', 'Night Ops'],
        details: {
            firstGameLabel: 'END OF PEACE',
            missionBriefing: [
                'Two rival factions dig in for a 16-hour overnight operation across the full Foxtrot AO. Control of the fuel depot decides who eats warm rations at dawn.',
                'Limited ammo is in effect: carry what you are issued, raid hidden caches, and capture the resupply truck to keep your squad in the fight.',
            ],
            schedule: [
                { day: 1, time: '7:45 PM', label: 'Check-in opens — staging + safety brief' },
                { day: 1, time: '9:00 PM', label: 'END OF PEACE — night operations begin' },
                { day: 2, time: '6:30 AM', label: 'Dawn offensive phase' },
                { day: 2, time: '12:00 PM', label: 'ENDEX — debrief + awards' },
            ],
            scheduleNote: 'Timeline may flex with field conditions.',
            documents: [
                { label: 'Safety Briefing', url: '/safety', note: 'Required reading before check-in.' },
            ],
        },
        customQuestions: [
            { id: 'q_faction', label: 'Faction', type: 'select', required: true, options: ['Russian Forces', 'NATO Forces'] },
        ],
        salesCloseAt: null,
        past: false,
        featured: false,
        seatsSold: 18,
        ticketTypes: [
            { id: 'tt_mock_full', eventId: 'evt_mock_multiday', name: 'Full Event', description: 'Both days, all 16 hours.', priceCents: 8000, priceDisplay: '$80.00', capacity: 60, sold: 18, remaining: 42, soldOut: false, minPerOrder: 1, maxPerOrder: 8, saleStartsAt: null, saleEndsAt: null, sortOrder: 0 },
        ],
    };
}

export function mockEvents() {
    // ORDER BY featured DESC, date_iso ASC — the featured single-day op first,
    // so it's events[0] (home hero / countdown / featured booking target).
    return [mockEventSingle(), mockEventMultiDay()];
}

/** Public sites (formatPublicSite). photoUrl values match src/data/locations.js
 *  photos so Home's focalForPhoto() lookup resolves like production. */
export function mockSites() {
    return [
        { id: 'site_mock_ghost', slug: 'ghost-town', name: 'Ghost Town', siteNumber: 1, badge: 'open', photoUrl: IMG_GHOST, photoPosition: 'center', locationBlurb: 'Hiawatha, UT — a rural neighborhood of 19 buildings with bunker systems.', features: ['19 buildings', 'Bunker systems', 'Fortified objectives'], gameTypes: ['Milsim', 'Skirmish'] },
        { id: 'site_mock_foxtrot', slug: 'foxtrot', name: 'Foxtrot Fields', siteNumber: 2, badge: 'open', photoUrl: IMG_FOXTROT, photoPosition: 'center', locationBlurb: 'Kaysville, UT — 25 acres of open field with varied terrain zones.', features: ['25 acres', 'Staging areas', 'Varied terrain'], gameTypes: ['Milsim', 'Skirmish'] },
    ];
}

// Published-review fixtures (publicReview shape + the WithEvent variant).
// ≥3 entries carry comments so Home takes the LIVE-testimonials branch (the
// data-driven path) instead of the static curated fallback. createdAt-derived
// publishedAt values are fixed June-2026 constants.
const REVIEWS = [
    { id: 'rev_mock_1', rating: 5, title: 'Best op of the year', comment: 'The night push on the fuel depot was the most intense 40 minutes I have had in airsoft. Marshals were dialed in all day.', authorName: 'Jake R.', publishedAt: 1_782_000_000_000 },
    { id: 'rev_mock_2', rating: 5, title: null, comment: 'First event with AAS and it will not be the last. Check-in was fast and the field brief actually made the missions make sense.', authorName: 'Maria S.', publishedAt: 1_781_500_000_000 },
    { id: 'rev_mock_3', rating: 4, title: 'Great field, long chrono line', comment: 'Ghost Town is an unreal place to play. Only gripe was the morning chrono queue — bring patience.', authorName: 'Devon K.', publishedAt: 1_781_000_000_000 },
    { id: 'rev_mock_4', rating: 5, title: null, comment: 'Squad-based objectives all day, zero downtime. Rental gear was in better shape than my own kit.', authorName: 'Priya N.', publishedAt: 1_780_500_000_000 },
];

const reviewWithEvent = (r) => ({
    ...r,
    event: { slug: 'operation-mock-alpha', title: 'Operation Mock Alpha' },
});

export function mockReviewSummary() {
    return {
        overall: { average: 4.8, count: 12 },
        recent: REVIEWS.map(reviewWithEvent),
    };
}

export function mockReviewsAll() {
    return { total: 4, average: 4.8, limit: 12, offset: 0, reviews: REVIEWS.map(reviewWithEvent) };
}

function mockReviewsForEvent(eventParam) {
    const single = mockEventSingle();
    const multi = mockEventMultiDay();
    // The single-day event has a populated feed; the multi-day one has zero
    // reviews so EventDetail's omitted-at-0 branch stays covered too.
    if (eventParam === multi.id || eventParam === multi.slug) {
        return { event: { id: multi.id, slug: multi.slug, title: multi.title }, average: null, count: 0, limit: 20, offset: 0, reviews: [] };
    }
    return { event: { id: single.id, slug: single.slug, title: single.title }, average: 4.8, count: 4, limit: 20, offset: 0, reviews: REVIEWS };
}

/**
 * Install the public API mock + frozen clock on a page. Call BEFORE page.goto
 * so the initial fetches are intercepted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ overrides?: Array<{ match: string|RegExp, body: any, status?: number }> }} [opts]
 *   overrides → per-test responses for specific endpoints. `match` is a path
 *   suffix (endsWith) or RegExp tested against the pathname; first hit wins.
 *   Unmatched paths fall through to the fixture defaults.
 */
export async function installPublicMocks(page, { overrides = [] } = {}) {
    // Freeze Date (timers keep running) so the countdown band + any relative
    // date math render the same pixels on every capture and compare.
    await page.clock.setFixedTime(FROZEN_NOW);

    // Pre-seed cookie consent so the fixed-position CookieBanner never mounts —
    // it overlays real content mid-page in fullPage captures, and a fixed
    // element destabilizes Playwright's scroll-and-stitch screenshot (the
    // two-consecutive-stable-frames check can spin until test timeout).
    await page.addInitScript(() => {
        try { localStorage.setItem('cookieConsent', 'accepted'); } catch { /* unavailable in some contexts */ }
    });

    await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const json = (body, status = 200) =>
            route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

        for (const o of overrides) {
            const hit = o.match instanceof RegExp ? o.match.test(path) : path.endsWith(o.match);
            if (hit) return json(o.body, o.status || 200);
        }

        // Events — list (query params irrelevant: same fixtures either way),
        // then single-event detail by id-or-slug.
        if (path === '/api/events') return json({ events: mockEvents() });
        const detail = path.match(/^\/api\/events\/([^/]+)$/);
        if (detail) {
            const key = decodeURIComponent(detail[1]);
            const ev = mockEvents().find((e) => e.id === key || e.slug === key);
            return ev ? json({ event: ev }) : json({ error: 'Event not found' }, 404);
        }

        if (path === '/api/sites') return json({ sites: mockSites() });

        // Reviews — summary (Home), all (/reviews), per-event (EventDetail).
        if (path === '/api/reviews/summary') return json(mockReviewSummary());
        if (path === '/api/reviews/all') return json(mockReviewsAll());
        if (path === '/api/reviews') return json(mockReviewsForEvent(url.searchParams.get('event') || ''));

        // Booking loads active taxes/fees; empty = the page's own catch
        // fallback shape, so pre-selection totals render the same $0 state.
        if (path === '/api/taxes-fees') return json({ taxesFees: [] });

        // Waiver error surface — mirror the real 404 body (worker/routes/waivers.js).
        if (path.startsWith('/api/waivers/')) return json({ error: 'Invalid waiver link' }, 404);
        if (path.startsWith('/api/bookings/')) return json({ error: 'Booking not found' }, 404);

        // Anything unmocked 404s loudly — a new public endpoint shows up as an
        // obvious error state in the pixel diff instead of silently passing.
        return json({ error: `No public visual mock for ${path}` }, 404);
    });
}
