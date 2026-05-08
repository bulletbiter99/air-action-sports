// M5 Batch 15 — Event-day checklist (Surface 5).
// Backend route deferred; UI scaffolding renders mock checklist for now.

import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function EventChecklist() {
    const [items, setItems] = useState([
        { id: '1', label: 'Pre-event safety briefing delivered', done: false },
        { id: '2', label: 'Chronograph station set up', done: false },
        { id: '3', label: 'Medic station active', done: false },
        { id: '4', label: 'All marshals checked in', done: false },
        { id: '5', label: 'Field hazards walked', done: false },
    ]);

    function toggle(id) {
        setItems((prev) => prev.map((i) => i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? Date.now() : null } : i));
    }

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>Event Checklist</h1>

            <p style={muted}>Persisted-state checklist backend ships in a follow-up batch. Frontend UX visible now.</p>

            {items.map((item) => (
                <div key={item.id} style={item.done ? rowDone : row} onClick={() => toggle(item.id)}>
                    <span style={{ fontSize: 24, marginRight: 12 }}>{item.done ? '☑' : '☐'}</span>
                    <span style={{ fontSize: 15, flex: 1 }}>{item.label}</span>
                    {item.doneAt && <span style={{ fontSize: 11, color: '#888' }}>{new Date(item.doneAt).toLocaleTimeString()}</span>}
                </div>
            ))}
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const muted = { color: '#888', fontSize: 13, marginBottom: 16, fontStyle: 'italic' };
const row = { background: '#1a1a1a', border: '1px solid #333', padding: '16px', marginBottom: 8, borderRadius: 4, display: 'flex', alignItems: 'center', cursor: 'pointer', minHeight: 56 };
const rowDone = { ...row, background: '#0a2a0a', border: '1px solid #5fba5f' };
