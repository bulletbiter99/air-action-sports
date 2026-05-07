import { useState, useEffect, useCallback } from 'react';

// Module-level cache so multiple useFeatureFlag(...) callers in the same
// page share one /api/admin/feature-flags request. Cleared by refresh().
let cachedFlagsPromise = null;

function fetchFlags() {
    if (cachedFlagsPromise) return cachedFlagsPromise;
    cachedFlagsPromise = fetch('/api/admin/feature-flags', {
        credentials: 'include',
        cache: 'no-store',
    })
        .then((res) => (res.ok ? res.json() : { flags: [] }))
        .then((j) => j.flags || [])
        .catch(() => []);
    return cachedFlagsPromise;
}

export function useFeatureFlag(key) {
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        cachedFlagsPromise = null;
        setLoading(true);
        const flags = await fetchFlags();
        const found = flags.find((f) => f.key === key);
        setEnabled(found ? Boolean(found.enabled) : false);
        setLoading(false);
    }, [key]);

    useEffect(() => {
        let cancelled = false;
        fetchFlags().then((flags) => {
            if (cancelled) return;
            const found = flags.find((f) => f.key === key);
            setEnabled(found ? Boolean(found.enabled) : false);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [key]);

    return { enabled, loading, refresh };
}
