// M5 Batch 12 — Event-day home tile grid (Surface 5).
//
// 5 tiles: Check-in / Roster / Equipment / Incident / Checklist.
// Plus HQ tile for Lead Marshal / Event Director (capability-gated).
// All tiles have 64px+ tap targets per Surface 5 design.

import { Link } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';

export default function EventDayHome() {
    const { person, activeEvent, online } = useEventDay();

    if (!person) {
        return (
            <div style={empty}>
                <h1 style={h1}>Sign in required</h1>
                <p style={muted}>Use the magic link from your event invitation email.</p>
            </div>
        );
    }

    if (!activeEvent) {
        return (
            <div style={empty}>
                <h1 style={h1}>No event today</h1>
                <p style={muted}>Event-day mode is only available when an event is active.</p>
                <p style={muted}>Last sign-in active is logged.</p>
            </div>
        );
    }

    return (
        <div>
            <h1 style={h1}>What needs doing?</h1>
            {!online && <div style={offlineBanner}>You are offline — actions queue until you reconnect.</div>}

            <div style={grid}>
                <Tile to="/event/check-in" label="Check In" desc="Scan ticket QR + walk-up bookings" color="#5fba5f" />
                <Tile to="/event/roster" label="Roster" desc="Find a player + medical info" color="#4a90c2" />
                <Tile to="/event/equipment-return" label="Equipment Return" desc="Scan rental + log condition" color="#ff8800" />
                <Tile to="/event/incident" label="Incident Report" desc="Log injury / dispute / safety event" color="#ff5050" />
                <Tile to="/event/checklist" label="Checklist" desc="Tick off your event-day tasks" color="#a890c2" />
                <Tile to="/event/hq" label="HQ Dashboard" desc="Event status overview (Lead Marshal+)" color="#888" />
            </div>
        </div>
    );
}

function Tile({ to, label, desc, color }) {
    return (
        <Link to={to} style={{ ...tile, borderLeftColor: color }}>
            <div style={tileLabel}>{label}</div>
            <div style={tileDesc}>{desc}</div>
        </Link>
    );
}

const h1 = { fontSize: 24, fontWeight: 900, letterSpacing: '-0.5px', margin: '0 0 16px' };
const empty = { textAlign: 'center', padding: 32 };
const muted = { color: '#888', fontSize: 14 };
const offlineBanner = {
    background: '#332200', border: '1px solid #ff8800', color: '#ffaa44',
    padding: '12px 16px', marginBottom: 16, borderRadius: 4, fontSize: 13,
};
const grid = { display: 'grid', gridTemplateColumns: '1fr', gap: 12 };
const tile = {
    background: '#1a1a1a', border: '1px solid #333', borderLeft: '6px solid',
    padding: '20px 16px', textDecoration: 'none', color: '#fff', display: 'block',
    minHeight: 80, transition: 'background 0.1s',
};
const tileLabel = { fontSize: 18, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 };
const tileDesc = { fontSize: 13, color: '#bbb' };
