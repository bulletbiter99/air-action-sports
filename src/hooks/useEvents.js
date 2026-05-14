import { useEffect, useState } from 'react';

// Module-level cache so multiple components hitting the hook during the same
// page visit don't trigger redundant fetches. Cleared on page reload.
let cache = { upcoming: null, all: null };

export function clearEventsCache() { cache = { upcoming: null, all: null }; }

// Map an API event (from /api/events) to the shape legacy page components expect.
// Keeps the public pages portable between the old static data/events.js and D1.
export function adaptEvent(apiEvent) {
    const addons = apiEvent.addons || [];
    const rentals = addons
        .filter((a) => a.type === 'rental')
        .map((a) => ({
            name: a.name,
            price: `$${((a.price_cents || 0) / 100).toFixed(0)}`,
            description: a.description || '',
        }));
    const bbPurchases = addons
        .filter((a) => a.type === 'consumable')
        .map((a) => ({
            name: a.name,
            price: `$${((a.price_cents || 0) / 100).toFixed(0)}`,
        }));
    // e.g. "May 2026" → "may" for the Events page filter
    const monthKey = (apiEvent.displayMonth || '')
        .toLowerCase()
        .split(' ')[0]
        ?.slice(0, 3) || '';

    return {
        id: apiEvent.id,
        slug: apiEvent.slug || apiEvent.id,
        date: {
            day: apiEvent.displayDay || apiEvent.dateIso?.slice(8, 10) || '',
            month: apiEvent.displayMonth || '',
        },
        type: apiEvent.type || 'airsoft',
        title: apiEvent.title,
        location: apiEvent.location || '',
        time: apiEvent.timeRange || '',
        checkIn: apiEvent.checkIn || '',
        firstGame: apiEvent.firstGame || '',
        endTime: apiEvent.endTime || '',
        slots: { total: apiEvent.totalSlots || 0, taken: apiEvent.seatsSold || 0 },
        price: apiEvent.basePriceDisplay || `$${Math.round((apiEvent.basePriceCents || 0) / 100)}/head`,
        site: apiEvent.site || '',
        month: monthKey,
        past: !!apiEvent.past,
        featured: !!apiEvent.featured,
        gameModes: apiEvent.gameModes || [],
        rentals,
        bbPurchases,
        shortDescription: apiEvent.shortDescription || '',
        coverImageUrl: apiEvent.coverImageUrl || null,
        cardImageUrl: apiEvent.cardImageUrl || null,
        heroImageUrl: apiEvent.heroImageUrl || null,
        bannerImageUrl: apiEvent.bannerImageUrl || null,
        ogImageUrl: apiEvent.ogImageUrl || null,
        cardOverlayOpacity: apiEvent.cardOverlayOpacity ?? null,
        heroOverlayOpacity: apiEvent.heroOverlayOpacity ?? null,
        bannerOverlayOpacity: apiEvent.bannerOverlayOpacity ?? null,
        dateIso: apiEvent.dateIso || '',
        ticketTypes: apiEvent.ticketTypes || [],
    };
}

async function fetchAll({ includePast = true } = {}) {
    const key = includePast ? 'all' : 'upcoming';
    if (cache[key]) return cache[key];
    const url = includePast ? '/api/events?include_past=1' : '/api/events';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
    const data = await res.json();
    const adapted = (data.events || []).map(adaptEvent);
    cache[key] = adapted;
    return adapted;
}

// useEvents({ includePast: true|false }) — returns { events, loading, error }.
export function useEvents({ includePast = true } = {}) {
    const [events, setEvents] = useState(() => {
        const key = includePast ? 'all' : 'upcoming';
        return cache[key] || [];
    });
    const [loading, setLoading] = useState(events.length === 0);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        fetchAll({ includePast })
            .then((list) => { if (alive) { setEvents(list); setLoading(false); } })
            .catch((e) => { if (alive) { setError(e); setLoading(false); } });
        return () => { alive = false; };
    }, [includePast]);

    return { events, loading, error };
}

// Fetch a single event by id-or-slug. Returns the adapted shape + original
// API fields like ticketTypes so the detail page has everything it needs.
export async function fetchEventBySlug(slug) {
    const res = await fetch(`/api/events/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.event) return null;
    return adaptEvent(data.event);
}
