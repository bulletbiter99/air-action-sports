// M4 B4b — refresh-cadence primitive for the persona-tailored AdminDashboard.
//
// Two hooks + one pure helper:
//
//   useTodayActive()                       → shared subscription to
//                                            /api/admin/today/active
//   useWidgetData(url, { tier })           → GETs `url`, polls per tier
//   intervalForTier(tier, todayState)      → pure helper for cadence rule
//
// Cadence rule (per docs/m4-discovery/persona-dashboard-audit.md lines 98–110):
//   tier='static'  → no polling; fetch once on mount
//   tier='live'    → 5min default
//                  → 30s when /today/active says activeEventToday
//                  → 10s when /today/active says checkInOpen
//
// Visibility-aware: polling pauses when document.visibilityState='hidden'
// and resumes immediately on visibilitychange to 'visible'.
//
// /today/active is fetched once at module level (shared across all
// useTodayActive subscribers) so 4–8 widgets per persona don't each
// fetch it independently.

import { useState, useEffect, useRef, useCallback } from 'react';

const TODAY_URL = '/api/admin/today/active';
const TODAY_POLL_MS = 30_000;

const TIER_DEFAULT_MS = 5 * 60_000;
const TIER_EVENT_DAY_MS = 30_000;
const TIER_CHECK_IN_MS = 10_000;

// ────────────────────────────────────────────────────────────────────
// Module-level shared /today/active subscription
// ────────────────────────────────────────────────────────────────────

const todayState = {
    data: null,
    subscribers: new Set(),
    intervalId: null,
};

async function refreshTodayActive() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
    }
    try {
        const res = await fetch(TODAY_URL, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        todayState.data = data;
        for (const cb of todayState.subscribers) cb(data);
    } catch {
        // Silent fail — widgets fall back to default cadence on error.
    }
}

function startTodayPolling() {
    if (todayState.intervalId !== null) return;
    refreshTodayActive();
    todayState.intervalId = setInterval(refreshTodayActive, TODAY_POLL_MS);
}

function stopTodayPolling() {
    if (todayState.intervalId !== null) {
        clearInterval(todayState.intervalId);
        todayState.intervalId = null;
    }
}

// Test-only escape hatch — not part of the public API. Used by vitest
// to reset module-level state between test cases without re-importing.
export function __resetTodayState() {
    stopTodayPolling();
    todayState.data = null;
    todayState.subscribers.clear();
}

export function useTodayActive() {
    const [data, setData] = useState(todayState.data);

    useEffect(() => {
        todayState.subscribers.add(setData);
        if (todayState.subscribers.size === 1) {
            startTodayPolling();
        }
        return () => {
            todayState.subscribers.delete(setData);
            if (todayState.subscribers.size === 0) {
                stopTodayPolling();
            }
        };
    }, []);

    return data;
}

// ────────────────────────────────────────────────────────────────────
// Pure cadence helper — exported for direct testing
// ────────────────────────────────────────────────────────────────────

export function intervalForTier(tier, todayActive) {
    if (tier !== 'live') return null;
    if (todayActive?.checkInOpen) return TIER_CHECK_IN_MS;
    if (todayActive?.activeEventToday) return TIER_EVENT_DAY_MS;
    return TIER_DEFAULT_MS;
}

// ────────────────────────────────────────────────────────────────────
// useWidgetData — fetch + poll a URL per tier
// ────────────────────────────────────────────────────────────────────

export function useWidgetData(url, options = {}) {
    const { tier = 'static' } = options;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const today = useTodayActive();
    const cancelledRef = useRef(false);

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (cancelledRef.current) return;
            setData(json);
            setError(null);
        } catch (e) {
            if (cancelledRef.current) return;
            setError(String(e.message || e));
        } finally {
            if (!cancelledRef.current) setLoading(false);
        }
    }, [url]);

    // Initial fetch on mount or url change
    useEffect(() => {
        cancelledRef.current = false;
        fetchData();
        return () => {
            cancelledRef.current = true;
        };
    }, [url, fetchData]);

    // Polling loop — restart whenever tier or the cadence-relevant fields
    // of today-active state change. Extracting fields to local consts so
    // the effect deps array references stable identifiers (avoids the
    // react-hooks/exhaustive-deps warning that triggers on `today?.x`).
    const todayActiveEvent = today?.activeEventToday;
    const todayCheckInOpen = today?.checkInOpen;
    useEffect(() => {
        const ms = intervalForTier(tier, { activeEventToday: todayActiveEvent, checkInOpen: todayCheckInOpen });
        if (ms === null) return undefined;

        const id = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return;
            }
            fetchData();
        }, ms);

        return () => clearInterval(id);
    }, [tier, todayActiveEvent, todayCheckInOpen, fetchData]);

    // Visibility-change refresh — when tab returns to visible, fetch
    // immediately rather than waiting for the next interval tick.
    useEffect(() => {
        if (tier === 'static') return undefined;
        if (typeof document === 'undefined') return undefined;
        function onVisibilityChange() {
            if (document.visibilityState === 'visible') {
                fetchData();
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [tier, fetchData]);

    return { data, loading, error, refresh: fetchData };
}
