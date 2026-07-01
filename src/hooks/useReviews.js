import { useEffect, useState } from 'react';

// Standalone attendee-review hook (Batch 6). Deliberately SEPARATE from
// useEvents' adaptEvent + the worker formatEvent path — review display must not
// be coupled to event mapping. Backs three public surfaces, one per mode:
//
//   'summary' (default) → GET /api/reviews/summary?recent=N
//                         { overall:{average,count}, recent:[…] }   (Home)
//   'event'   (eventId) → GET /api/reviews?event=<id|slug>&limit=N
//                         { event, average, count, reviews:[…] }    (EventDetail)
//   'all'               → GET /api/reviews/all?limit=N
//                         { total, average, reviews:[…] }           (/reviews)
//
// Returns normalized convenience fields (average / count / reviews) that read
// the same across modes, plus the raw `data` for anything mode-specific.
export function useReviews({ mode, eventId = null, limit = 12, recent = 6 } = {}) {
    const resolvedMode = mode || (eventId ? 'event' : 'summary');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        // EventDetail passes eventId while the event is still loading — hold the
        // request until it resolves rather than firing an invalid one.
        if (resolvedMode === 'event' && !eventId) {
            setLoading(true);
            return undefined;
        }
        let alive = true;
        setLoading(true);
        setError(null);

        let url;
        if (resolvedMode === 'event') {
            url = `/api/reviews?event=${encodeURIComponent(eventId)}&limit=${limit}`;
        } else if (resolvedMode === 'all') {
            url = `/api/reviews/all?limit=${limit}`;
        } else {
            url = `/api/reviews/summary?recent=${recent}`;
        }

        fetch(url, { cache: 'no-store' })
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`reviews ${res.status}`))))
            .then((json) => { if (alive) { setData(json); setLoading(false); } })
            .catch((e) => { if (alive) { setError(e); setLoading(false); } });

        return () => { alive = false; };
    }, [resolvedMode, eventId, limit, recent]);

    const overall = data?.overall || null;
    const average = resolvedMode === 'summary'
        ? (overall?.average ?? null)
        : (data?.average ?? null);
    const count = resolvedMode === 'summary'
        ? (overall?.count ?? 0)
        : resolvedMode === 'all'
            ? (data?.total ?? 0)
            : (data?.count ?? 0);
    // summary mode's list is `recent`; event/all modes use `reviews`.
    const reviews = resolvedMode === 'summary'
        ? (data?.recent || [])
        : (data?.reviews || []);

    return { data, average, count, reviews, loading, error };
}
