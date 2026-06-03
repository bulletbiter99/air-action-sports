import { useEffect, useState } from 'react';

// Module-level cache so repeat visits within a page session don't refetch.
let cache = null;

export function clearSitesCache() { cache = null; }

async function fetchSites() {
    if (cache) return cache;
    const res = await fetch('/api/sites', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load sites (${res.status})`);
    const data = await res.json();
    cache = data.sites || [];
    return cache;
}

// useSites() — public sites for the /locations page. Returns { sites, loading, error }.
export function useSites() {
    const [sites, setSites] = useState(() => cache || []);
    const [loading, setLoading] = useState(!cache);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        fetchSites()
            .then((list) => { if (alive) { setSites(list); setLoading(false); } })
            .catch((e) => { if (alive) { setError(e); setLoading(false); } });
        return () => { alive = false; };
    }, []);

    return { sites, loading, error };
}
