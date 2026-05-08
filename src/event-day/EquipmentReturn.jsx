// M5 Batch 14 — Equipment return scaffolding.
// Reuses /api/admin/rentals scanner pattern.

import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function EquipmentReturn() {
    const [token, setToken] = useState('');
    const [item, setItem] = useState(null);
    const [condition, setCondition] = useState('good');
    const [notes, setNotes] = useState('');
    const [status, setStatus] = useState(null);

    async function lookup() {
        setStatus(null);
        const res = await fetch(`/api/admin/rentals/lookup/${encodeURIComponent(token)}`, { credentials: 'include' });
        if (res.ok) setItem(await res.json());
        else setStatus({ kind: 'err', text: 'Not found' });
    }

    async function complete() {
        if (!item?.assignment?.id) return;
        const res = await fetch(`/api/admin/rentals/assignments/${item.assignment.id}/return`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition, notes }),
        });
        if (res.ok) {
            setStatus({ kind: 'ok', text: 'Equipment returned' });
            setItem(null); setToken(''); setNotes(''); setCondition('good');
        } else {
            setStatus({ kind: 'err', text: 'Return failed' });
        }
    }

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>Equipment Return</h1>

            <div style={card}>
                <label style={lbl}>Item QR/serial
                    <input type="text" value={token} onChange={(e) => setToken(e.target.value)} style={input} placeholder="rt_..." autoFocus />
                </label>
                <button type="button" onClick={lookup} style={primaryBtn} disabled={!token}>Look up</button>
            </div>

            {status && <div style={status.kind === 'ok' ? okBox : errBox}>{status.text}</div>}

            {item?.assignment && (
                <div style={card}>
                    <h2 style={h2}>{item.item?.name || 'Item'}</h2>
                    <p style={{ color: '#bbb' }}>Assigned to: {item.assignment.attendee_name || '—'}</p>

                    <label style={lbl}>Condition on return
                        <select value={condition} onChange={(e) => setCondition(e.target.value)} style={input}>
                            <option value="good">Good</option>
                            <option value="fair">Fair</option>
                            <option value="damaged">Damaged</option>
                            <option value="lost">Lost</option>
                        </select>
                    </label>

                    {(condition === 'damaged' || condition === 'lost') && (
                        <label style={lbl}>Damage notes
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={input} />
                        </label>
                    )}

                    <button type="button" onClick={complete} style={primaryBtn}>Complete Return</button>

                    {(condition === 'damaged' || condition === 'lost') && (
                        <p style={{ color: '#ffaa44', marginTop: 12, fontSize: 13 }}>
                            Damage charge fast-path (M5 B16) creates a pending booking_charge linked to this assignment.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const h2 = { fontSize: 20, fontWeight: 800, margin: '0 0 8px' };
const card = { background: '#1a1a1a', border: '1px solid #333', padding: 16, marginBottom: 16, borderRadius: 4 };
const lbl = { display: 'block', fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 };
const input = { width: '100%', padding: 14, background: '#000', border: '1px solid #555', color: '#fff', fontSize: 16, marginTop: 6, boxSizing: 'border-box', fontFamily: 'inherit' };
const primaryBtn = { padding: '14px 32px', background: '#ff8800', color: '#000', border: 0, fontSize: 16, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', minHeight: 56, width: '100%' };
const okBox = { background: '#003300', border: '1px solid #5fba5f', color: '#5fba5f', padding: 12, marginBottom: 16, borderRadius: 4 };
const errBox = { background: '#330000', border: '1px solid #ff5050', color: '#ff5050', padding: 12, marginBottom: 16, borderRadius: 4 };
