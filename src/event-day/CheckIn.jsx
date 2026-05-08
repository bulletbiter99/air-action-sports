// M5 Batch 13 — Event-day check-in (Surface 5).
// Minimal scaffold: manual token lookup + check-in action.
// QR scanner integration reuses /admin/scan code path; full kiosk
// scanner UX lands in a focused follow-up.

import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function CheckIn() {
    const [token, setToken] = useState('');
    const [status, setStatus] = useState(null);
    const [attendee, setAttendee] = useState(null);

    async function lookup() {
        setStatus(null);
        setAttendee(null);
        if (!token) return;
        const res = await fetch(`/api/admin/attendees/by-qr/${encodeURIComponent(token)}`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            setAttendee(data.attendee || null);
            if (!data.attendee) setStatus({ kind: 'err', text: 'Not found' });
        } else if (res.status === 404) {
            setStatus({ kind: 'err', text: 'Not found' });
        } else {
            setStatus({ kind: 'err', text: 'Lookup failed' });
        }
    }

    async function checkIn(attendeeId) {
        const res = await fetch(`/api/admin/attendees/${attendeeId}/check-in`, { method: 'POST', credentials: 'include' });
        if (res.ok) {
            setStatus({ kind: 'ok', text: 'Checked in' });
            setAttendee(null);
            setToken('');
        } else {
            const data = await res.json().catch(() => ({}));
            setStatus({ kind: 'err', text: data.error || 'Check-in failed' });
        }
    }

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>Check In</h1>

            <div style={card}>
                <label style={lbl}>QR Token (scan or paste)
                    <input type="text" value={token} onChange={(e) => setToken(e.target.value)} style={input} placeholder="qr_..." autoFocus />
                </label>
                <button type="button" onClick={lookup} style={primaryBtn} disabled={!token}>Look up</button>
            </div>

            {status && <div style={status.kind === 'ok' ? okBox : errBox}>{status.text}</div>}

            {attendee && (
                <div style={card}>
                    <h2 style={h2}>{attendee.full_name || attendee.fullName || '—'}</h2>
                    <p style={{ color: '#bbb' }}>Event: {attendee.event_id || attendee.eventId}</p>
                    <p style={{ color: attendee.checked_in_at ? '#5fba5f' : '#ffaa44' }}>
                        {attendee.checked_in_at ? '✓ Already checked in' : 'Not yet checked in'}
                    </p>
                    {!attendee.waiver_id && (
                        <p style={{ color: '#ff5050' }}>⚠️ Waiver missing — Lead Marshal can override</p>
                    )}
                    <button type="button" onClick={() => checkIn(attendee.id)} style={primaryBtn} disabled={!!attendee.checked_in_at}>
                        ✓ Check In
                    </button>
                </div>
            )}
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const h2 = { fontSize: 20, fontWeight: 800, margin: '0 0 8px' };
const card = { background: '#1a1a1a', border: '1px solid #333', padding: 16, marginBottom: 16, borderRadius: 4 };
const lbl = { display: 'block', fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 };
const input = { width: '100%', padding: '14px', background: '#000', border: '1px solid #555', color: '#fff', fontSize: 16, marginTop: 6, boxSizing: 'border-box', minHeight: 56 };
const primaryBtn = { padding: '14px 32px', background: '#ff8800', color: '#000', border: 0, fontSize: 16, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', minHeight: 56, width: '100%' };
const okBox = { background: '#003300', border: '1px solid #5fba5f', color: '#5fba5f', padding: 12, marginBottom: 16, borderRadius: 4 };
const errBox = { background: '#330000', border: '1px solid #ff5050', color: '#ff5050', padding: 12, marginBottom: 16, borderRadius: 4 };
