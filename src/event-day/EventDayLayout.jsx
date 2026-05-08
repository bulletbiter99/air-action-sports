// M5 Batch 12 — Event-day mode shell (Surface 5).
//
// Mobile-first kiosk shell. High-contrast palette. 64px tap targets.
// Reuses portal session machinery but renders a different shell.

import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';

const EventDayContext = createContext({ person: null, activeEvent: null, online: true });

export function useEventDay() {
    return useContext(EventDayContext);
}

export default function EventDayLayout() {
    const [person, setPerson] = useState(null);
    const [activeEvent, setActiveEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const navigate = useNavigate();

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [meRes, eventRes] = await Promise.all([
                fetch('/api/portal/auth/me', { credentials: 'include', cache: 'no-store' }),
                fetch('/api/admin/today/active', { credentials: 'include', cache: 'no-store' }),
            ]);
            if (meRes.ok) setPerson((await meRes.json()).person);
            if (eventRes.ok) {
                const data = await eventRes.json();
                setActiveEvent(data.activeEventToday ? { id: data.eventId } : null);
            }
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
        function onOnline() { setOnline(true); }
        function onOffline() { setOnline(false); }
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);

    async function logout() {
        await fetch('/api/portal/auth/logout', { method: 'POST', credentials: 'include' });
        setPerson(null);
        navigate('/');
    }

    if (loading) {
        return <div style={shell}><p style={muted}>Loading event-day mode…</p></div>;
    }

    return (
        <EventDayContext.Provider value={{ person, activeEvent, online, refresh }}>
            <div style={shell}>
                <header style={header}>
                    <Link to="/event" style={brand}>EVENT-DAY</Link>
                    {activeEvent && <span style={eventBadge}>Event: {activeEvent.id}</span>}
                    {person && (
                        <div style={personInfo}>
                            <span style={personName}>{person.full_name}</span>
                            <button type="button" onClick={logout} style={logoutBtn}>Sign out</button>
                        </div>
                    )}
                </header>
                <main style={main}>
                    <Outlet />
                </main>
                <footer style={footer}>
                    <span style={online ? online_indicator : offline_indicator}>
                        {online ? '● Online' : '● Offline'}
                    </span>
                </footer>
            </div>
        </EventDayContext.Provider>
    );
}

const shell = {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    background: '#0a0a0a', color: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
const header = {
    padding: '20px 16px',
    background: '#000', borderBottom: '2px solid #ff8800',
    display: 'flex', alignItems: 'center', gap: 16,
    minHeight: 72,
};
const brand = {
    color: '#ff8800', fontWeight: 900, fontSize: 16, letterSpacing: 3,
    textDecoration: 'none', textTransform: 'uppercase',
};
const eventBadge = {
    background: '#ff8800', color: '#000', padding: '4px 10px',
    fontSize: 11, fontWeight: 800, letterSpacing: 1,
    borderRadius: 3,
};
const personInfo = { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 };
const personName = { fontSize: 14, color: '#fff' };
const logoutBtn = {
    background: 'transparent', color: '#fff', border: '1px solid #555',
    padding: '8px 16px', fontSize: 12, fontWeight: 700, letterSpacing: 1,
    textTransform: 'uppercase', cursor: 'pointer', minHeight: 44,
};
const main = { flex: 1, padding: 16, maxWidth: 720, margin: '0 auto', width: '100%' };
const footer = {
    padding: '12px 16px', background: '#000', borderTop: '1px solid #333',
    display: 'flex', justifyContent: 'center',
};
const online_indicator = { color: '#5fba5f', fontSize: 12, fontWeight: 700, letterSpacing: 1 };
const offline_indicator = { color: '#ff5050', fontSize: 12, fontWeight: 700, letterSpacing: 1 };
const muted = { color: '#888', textAlign: 'center', padding: 32 };
