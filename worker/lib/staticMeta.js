// Per-route <title> and description for the STATIC public pages, mirrored from
// each page's <SEO> component.
//
// WHY THIS EXISTS
// The SPA sets its meta client-side via react-helmet, which social scrapers and
// non-JS crawlers never execute. Before this, every page except / and
// /events/:slug served the shell's generic "Air Action Sports" title and the
// homepage description — so sharing /safety, /faq or /reviews anywhere unfurled
// as the same card. Measured live 2026-08 against production.
//
// WHY IT IS A MIRROR AND NOT AN IMPORT
// The worker cannot safely import from src/ — a page module pulls in React, and
// a file's top-level imports run when the module loads (the same trap that broke
// a deploy when worker/index.js transitively imported a Node-only CLI script).
// tests/unit/worker/staticMeta.test.js reads the real page files and fails if
// this map and a page's <SEO> ever disagree, so the mirror cannot drift
// silently.
//
// Routes deliberately ABSENT:
//   /events/:slug   — richer per-event meta already, via rewriteEventOg
//   /review         — tokenized + noindex; must never be indexed
//   /waiver, /booking/success, /booking/cancelled, /booking/ticket — per-booking
//   /v/:token, /vendor/*  — private vendor portal
//   404             — nothing to promote

export const STATIC_PAGE_META = {
    "/": {
        title: "Air Action Sports \u2014 Airsoft Events Across Multiple Elite Outdoor Sites",
        description: "Air Action Sports runs tactical airsoft events across multiple outdoor sites. Milsim, skirmish, and private rental. Book your next battle today.",
    },
    "/about": {
        title: "About Us | Air Action Sports",
        description: "The story behind Air Action Sports. Born in the field, built for the community \u2014 our mission, our sites, and our commitment to player safety.",
    },
    "/booking": {
        title: "Book Your Battle | Air Action Sports",
        description: "Book your next airsoft event with Air Action Sports. Pick your event, ticket, and gear rentals \u2014 secure checkout.",
    },
    "/contact": {
        title: "Contact Us | Air Action Sports",
        description: "Get in touch with Air Action Sports. Inquiries about bookings, private rental, corporate events, and more.",
    },
    "/faq": {
        title: "FAQ \u2014 Air Action Sports",
        description: "Frequently asked questions about Air Action Sports airsoft events. Everything you need to know before your first game.",
    },
    "/gallery": {
        title: "Gallery | Air Action Sports",
        description: "Photos and videos from Air Action Sports airsoft events. See our locations, game days, and tactical operations in action.",
    },
    "/games": {
        title: "Past Games | Air Action Sports",
        description: "Browse highlight videos and photo galleries from past airsoft operations at Air Action Sports. Recap the action from previous events.",
    },
    "/locations": {
        title: "Our Sites | Air Action Sports",
        description: "Explore Air Action Sports airsoft locations. Woodland, CQB and open field sites across multiple elite venues.",
    },
    "/new-players": {
        title: "New Players Guide | Air Action Sports",
        description: "Everything you need to know before your first airsoft game. Gear, rules, what to expect, and how to book.",
    },
    "/pricing": {
        title: "Pricing | Air Action Sports",
        description: "Transparent airsoft event pricing. Admission, rental packages, and BB purchases. No hidden fees.",
    },
    "/privacy": {
        title: "Privacy Policy | Air Action Sports",
        description: "Air Action Sports privacy policy. How we collect, use, and protect your personal data.",
    },
    "/reviews": {
        title: "Player Reviews \u2014 Air Action Sports",
        description: "Verified reviews from players at Air Action Sports airsoft events. Real ratings from attendees who booked and played.",
    },
    "/rules-of-engagement": {
        title: "Rules of Engagement | Air Action Sports",
        description: "Air Action Sports rules of engagement: weapon class FPS limits, minimum engagement distances, safety requirements, hit calling, and conduct policies.",
    },
    "/safety": {
        title: "Safety Briefing | Air Action Sports",
        description: "The Air Action Sports safety briefing every player receives at check-in: eye protection, green zones, fire and vehicle safety, engagement rules, chrono compliance, and emergency procedures. Read it before you arrive.",
    },
};

// Exact-match lookup, tolerating one trailing slash. Returns null for anything
// not explicitly listed — an unknown path must fall through to the shell, never
// borrow another page's meta.
export function metaForPath(pathname) {
    if (typeof pathname !== 'string' || !pathname) return null;
    const clean = pathname.length > 1 && pathname.endsWith('/')
        ? pathname.slice(0, -1)
        : pathname;
    return STATIC_PAGE_META[clean] || null;
}
