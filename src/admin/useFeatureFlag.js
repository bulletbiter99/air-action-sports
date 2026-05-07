import { useState, useEffect, useCallback } from 'react';

// Module-level cache so multiple useFeatureFlag(...) callers in the same
// page share one /api/admin/feature-flags request. Cleared by refresh()
// or setFeatureFlagOverride(), and on auth-failure responses (so post-
// login the next read goes back to the network).
let cachedFlagsPromise = null;

function fetchFlags() {
    if (cachedFlagsPromise) return cachedFlagsPromise;
    const promise = fetch('/api/admin/feature-flags', {
        credentials: 'include',
        cache: 'no-store',
    })
        .then((res) => {
            if (!res.ok) {
                cachedFlagsPromise = null;
                return [];
            }
            return res.json().then((j) => j.flags || []);
        })
        .catch(() => {
            cachedFlagsPromise = null;
            return [];
        });
    cachedFlagsPromise = promise;
    return promise;
}

export function useFeatureFlag(key) {
    const [enabled, setEnabled] = useState(false);
    const [exists, setExists] = useState(false);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        cachedFlagsPromise = null;
        setLoading(true);
        const flags = await fetchFlags();
        const found = flags.find((f) => f.key === key);
        setEnabled(found ? Boolean(found.enabled) : false);
        setExists(Boolean(found));
        setLoading(false);
    }, [key]);

    useEffect(() => {
        let cancelled = false;
        fetchFlags().then((flags) => {
            if (cancelled) return;
            const found = flags.find((f) => f.key === key);
            setEnabled(found ? Boolean(found.enabled) : false);
            setExists(Boolean(found));
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [key]);

    return { enabled, exists, loading, refresh };
}

export async function setFeatureFlagOverride(key, enabled) {
    const res = await fetch(`/api/admin/feature-flags/${encodeURIComponent(key)}/override`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: Boolean(enabled) }),
    });
    cachedFlagsPromise = null;
    return res.ok;
}
