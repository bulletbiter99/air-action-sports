// M5 Batch 14 — Event-day roster lookup (Surface 5).
// R14: switched from the admin route (/api/admin/events/:id/roster
// — silent 401 under the portal cookie used in event-day mode) to
// the new /api/event-day/roster, which is gated by requireEventDayAuth
// and locked to the active event server-side. Server-side ?q= filter
// replaces the previous client-side substring filter.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';

export default function RosterLookup() {
    const { activeEvent } = useEventDay();
    const [roster, setRoster] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!activeEvent?.id) return;
        const controller = new AbortController();
        const debounce = setTimeout(() => {
            setLoading(true);
            const url = search.trim()
                ? `/api/event-day/roster?q=${encodeURIComponent(search.trim())}`
                : '/api/event-day/roster';
            fetch(url, { credentials: 'include', signal: controller.signal })
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (data) setRoster(data.attendees || []);
                })
                .catch(() => { /* abort or network */ })
                .finally(() => setLoading(false));
        }, 250);
        return () => {
            clearTimeout(debounce);
            controller.abort();
        };
    }, [activeEvent, search]);

    // Server-side filter handles substring match; no client-side
    // filtering needed. Keep the variable name for the render path.
    const filtered = roster;

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>Roster</h1>

            {!activeEvent && <p style={muted}>No active event today.</p>}
            {activeEvent && (
                <>
                    <input type="search" placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} style={searchInput} />
                    {loading && <p style={muted}>Loading…</p>}
                    {!loading && filtered.length === 0 && <p style={muted}>No match.</p>}
                    {filtered.map((a) => (
                        <div key={a.id} style={row}>
                            <strong style={{ fontSize: 16 }}>{a.fullName || '—'}</strong>
                            <div style={{ fontSize: 13, color: '#bbb' }}>
                                {a.checkedInAt ? '✓ Checked in' : '○ Not checked in'}
                                {a.waiverId ? ' · waiver ✓' : ' · ⚠️ no waiver'}
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const muted = { color: '#888', fontSize: 14, textAlign: 'center', padding: 20 };
const searchInput = { width: '100%', padding: 14, background: '#000', border: '1px solid #555', color: '#fff', fontSize: 16, marginBottom: 16, boxSizing: 'border-box', minHeight: 56 };
const row = { padding: '12px 16px', background: '#1a1a1a', border: '1px solid #333', marginBottom: 8, borderRadius: 4 };
