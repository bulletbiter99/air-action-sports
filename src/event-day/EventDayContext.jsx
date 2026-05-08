// M5 R12 — Event-day Context, hook, and Provider extracted from EventDayLayout.
//
// Original M5 B12 inlined the Context inside EventDayLayout.jsx. Per the
// rework plan §B12, the prompt called for a separate file. Extraction
// keeps the API surface byte-identical:
//   - useEventDay() reads { person, activeEvent, online, refresh }
//   - EventDayProvider wraps the value-state logic the Layout used to own
//   - EventDayLayout re-exports useEventDay so the 5 existing import sites
//     (EventDayHome, RosterLookup, EventHQ, IncidentReport) keep working
//     without edits.
//
// The Provider is what owns:
//   - Person fetched from /api/portal/auth/me (portal cookie session)
//   - Active event from /api/admin/today/active
//   - Online/offline events on window
//   - refresh() callback to re-fetch both

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const DEFAULT_VALUE = { person: null, activeEvent: null, online: true, refresh: () => {} };

export const EventDayContext = createContext(DEFAULT_VALUE);

export function useEventDay() {
    return useContext(EventDayContext);
}

/**
 * Wraps an event-day subtree with shared session + active-event state.
 *
 * `loading` is exposed via the returned hook so the Layout can render a
 * spinner before the first fetch resolves; we expose `loading` on the
 * context value too so children that mount lazily can check it.
 */
export function EventDayProvider({ children }) {
    const [person, setPerson] = useState(null);
    const [activeEvent, setActiveEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [meRes, eventRes] = await Promise.all([
                fetch('/api/portal/auth/me', { credentials: 'include', cache: 'no-store' }),
                fetch('/api/admin/today/active', { credentials: 'include', cache: 'no-store' }),
            ]);
            if (meRes.ok) {
                const meBody = await meRes.json().catch(() => ({}));
                setPerson(meBody.person || null);
            } else {
                setPerson(null);
            }
            if (eventRes.ok) {
                const data = await eventRes.json().catch(() => ({}));
                setActiveEvent(data.activeEventToday ? { id: data.eventId } : null);
            } else {
                setActiveEvent(null);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        function onOnline() { setOnline(true); }
        function onOffline() { setOnline(false); }
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);

    return (
        <EventDayContext.Provider value={{ person, activeEvent, online, loading, refresh }}>
            {children}
        </EventDayContext.Provider>
    );
}
