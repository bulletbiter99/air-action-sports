// M5 Batch 14 — Incident report form (Surface 5).
// Posts to /api/event-day/incidents (route in Batch 14 backend).

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';

export default function IncidentReport() {
    const { activeEvent } = useEventDay();
    const navigate = useNavigate();
    const [form, setForm] = useState({
        type: 'injury', severity: 'minor', location: '', personsInvolved: '', narrative: '',
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    async function submit() {
        setError(null);
        setSubmitting(true);
        try {
            const res = await fetch('/api/event-day/incidents', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, eventId: activeEvent?.id }),
            });
            if (res.ok) navigate('/event');
            else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to file incident');
            }
        } finally { setSubmitting(false); }
    }

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>Incident Report</h1>

            <div style={card}>
                <label style={lbl}>Type
                    <select value={form.type} onChange={(e) => setForm({...form, type: e.target.value})} style={input}>
                        <option value="injury">Injury</option>
                        <option value="dispute">Dispute</option>
                        <option value="safety">Safety violation</option>
                        <option value="equipment">Equipment failure</option>
                        <option value="weather">Weather</option>
                        <option value="other">Other</option>
                    </select>
                </label>
                <label style={lbl}>Severity
                    <select value={form.severity} onChange={(e) => setForm({...form, severity: e.target.value})} style={input}>
                        <option value="minor">Minor</option>
                        <option value="moderate">Moderate</option>
                        <option value="serious">Serious (escalates to Owner)</option>
                    </select>
                </label>
                <label style={lbl}>Location <input type="text" value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} style={input} placeholder="Field 2, by the bunker line" /></label>
                <label style={lbl}>Persons involved (names) <input type="text" value={form.personsInvolved} onChange={(e) => setForm({...form, personsInvolved: e.target.value})} style={input} /></label>
                <label style={lbl}>Narrative <textarea value={form.narrative} onChange={(e) => setForm({...form, narrative: e.target.value})} rows={6} style={input} placeholder="What happened, in your own words…" /></label>

                {error && <p style={errText}>{error}</p>}
                <button type="button" onClick={submit} disabled={submitting || !form.narrative} style={primaryBtn}>
                    {submitting ? 'Filing…' : 'File Incident'}
                </button>
            </div>
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const card = { background: '#1a1a1a', border: '1px solid #333', padding: 16, borderRadius: 4 };
const lbl = { display: 'block', fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 };
const input = { width: '100%', padding: 14, background: '#000', border: '1px solid #555', color: '#fff', fontSize: 16, marginTop: 6, boxSizing: 'border-box', fontFamily: 'inherit' };
const primaryBtn = { padding: '14px 32px', background: '#ff5050', color: '#fff', border: 0, fontSize: 16, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', minHeight: 56, width: '100%' };
const errText = { color: '#ff5050', fontSize: 13, marginBottom: 12 };
