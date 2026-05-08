// M5 Batch 15 — Event-day HQ dashboard (Surface 5).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';

export default function EventHQ() {
    const { activeEvent } = useEventDay();
    const [stats, setStats] = useState(null);

    useEffect(() => {
        if (!activeEvent?.id) return;
        Promise.all([
            fetch(`/api/admin/events/${activeEvent.id}/roster`, { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
            fetch(`/api/admin/event-staffing?event_id=${activeEvent.id}`, { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
        ]).then(([roster, staffing]) => {
            const checkedIn = roster?.attendees?.filter((a) => a.checkedInAt).length || 0;
            const total = roster?.attendees?.length || 0;
            const staffPresent = staffing?.assignments?.filter((s) => s.status === 'confirmed' || s.status === 'completed').length || 0;
            setStats({ checkedIn, total, staffPresent, staffTotal: staffing?.assignments?.length || 0 });
        });
    }, [activeEvent]);

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>HQ Dashboard</h1>

            {!activeEvent && <p style={muted}>No active event today.</p>}
            {activeEvent && stats && (
                <>
                    <div style={kpiGrid}>
                        <Stat label="Players checked in" value={`${stats.checkedIn} / ${stats.total}`} />
                        <Stat label="Staff present" value={`${stats.staffPresent} / ${stats.staffTotal}`} />
                    </div>
                    <p style={muted}>Auto-refresh + recent activity feed land in a follow-up batch.</p>
                </>
            )}
            {activeEvent && !stats && <p style={muted}>Loading…</p>}
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div style={card}>
            <div style={statValue}>{value}</div>
            <div style={statLabel}>{label}</div>
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const muted = { color: '#888', fontSize: 13, marginTop: 16 };
const kpiGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const card = { background: '#1a1a1a', border: '1px solid #333', padding: 16, borderRadius: 4, textAlign: 'center' };
const statValue = { fontSize: 28, fontWeight: 900, color: '#ff8800' };
const statLabel = { fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 };
