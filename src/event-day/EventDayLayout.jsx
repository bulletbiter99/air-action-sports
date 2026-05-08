// M5 Batch 12 — Event-day mode shell (Surface 5). Refactored in R12 to
// host the Context as a separate file (EventDayContext.jsx) and to apply
// styles via the dedicated event-day.css stylesheet (vs the original
// inline JS-object styles).
//
// The shell is mobile-first. CSS enforces the high-contrast palette
// (black bg, white text, signal orange accents) and 64px tap targets on
// interactive elements per the M5 prompt.

import { Outlet, Link, useNavigate } from 'react-router-dom';
import { EventDayProvider, useEventDay } from './EventDayContext.jsx';
import './styles/event-day.css';

// Re-export so the 5 existing import sites (EventDayHome / RosterLookup /
// EventHQ / IncidentReport) keep their `import { useEventDay } from
// './EventDayLayout.jsx'` line working without edits.
export { useEventDay };

function EventDayShell() {
    const { person, activeEvent, online, loading } = useEventDay();
    const navigate = useNavigate();

    async function logout() {
        await fetch('/api/portal/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        navigate('/');
    }

    if (loading) {
        return (
            <div className="aas-event-day__shell">
                <p className="aas-event-day__loading">Loading event-day mode…</p>
            </div>
        );
    }

    return (
        <div className="aas-event-day__shell">
            <header className="aas-event-day__header">
                <Link to="/event" className="aas-event-day__brand">EVENT-DAY</Link>
                {activeEvent && (
                    <span className="aas-event-day__event-badge">Event: {activeEvent.id}</span>
                )}
                {person && (
                    <div className="aas-event-day__person">
                        <span className="aas-event-day__person-name">{person.full_name}</span>
                        <button
                            type="button"
                            onClick={logout}
                            className="aas-event-day__logout-btn"
                        >
                            Sign out
                        </button>
                    </div>
                )}
            </header>
            <main className="aas-event-day__main">
                <Outlet />
            </main>
            <footer className="aas-event-day__footer">
                <span
                    className={
                        online
                            ? 'aas-event-day__indicator aas-event-day__indicator--online'
                            : 'aas-event-day__indicator aas-event-day__indicator--offline'
                    }
                >
                    {online ? '● Online' : '● Offline'}
                </span>
            </footer>
        </div>
    );
}

export default function EventDayLayout() {
    return (
        <EventDayProvider>
            <EventDayShell />
        </EventDayProvider>
    );
}
