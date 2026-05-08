// M5 Batch 15 — Event-day HQ dashboard (Surface 5).
// R15: switched from two admin-side fetches (silent 401 under portal
// cookie — same fix R14 applied to roster + equipment-return) to the
// single /api/event-day/hq endpoint. Adds checklists progress + recent
// activity feed (the rework plan called these out as "follow-up
// batch" — R15 is that follow-up).

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';

function formatRelative(at, now = Date.now()) {
    if (!at) return '—';
    const diff = now - at;
    if (diff < 60_000) return 'just now';
    if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`;
    return new Date(at).toLocaleDateString();
}

function formatAction(action) {
    if (!action) return '—';
    return action.replace(/^event_day\./, '').replace(/_/g, ' ');
}

export default function EventHQ() {
    const { activeEvent } = useEventDay();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorText, setErrorText] = useState('');

    const load = useCallback(async () => {
        if (!activeEvent?.id) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setErrorText('');
        try {
            const res = await fetch('/api/event-day/hq', {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!res.ok) {
                setErrorText(`Failed to load (${res.status})`);
                return;
            }
            setStats(await res.json());
        } catch (err) {
            setErrorText(err?.message || 'Network error');
        } finally {
            setLoading(false);
        }
    }, [activeEvent]);

    useEffect(() => { load(); }, [load]);

    if (!activeEvent) {
        return (
            <div>
                <Link to="/event" style={back}>← Back</Link>
                <h1 style={h1}>HQ Dashboard</h1>
                <p style={muted}>No active event today.</p>
            </div>
        );
    }

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>HQ Dashboard</h1>

            {loading && !stats && <p style={muted}>Loading…</p>}
            {errorText && (
                <p style={errText}>
                    {errorText} <button type="button" onClick={load} style={inlineBtn}>Retry</button>
                </p>
            )}

            {stats && (
                <>
                    <div style={kpiGrid}>
                        <Stat label="Players checked in" value={`${stats.rosterCheckedIn} / ${stats.rosterTotal}`} />
                        <Stat label="Staff present" value={`${stats.staffPresent} / ${stats.staffTotal}`} />
                        <Stat label="Checklists done" value={`${stats.checklistsCompleted} / ${stats.checklistsTotal}`} />
                    </div>

                    <button type="button" onClick={load} style={refreshBtn}>Refresh</button>

                    <h2 style={h2}>Recent activity</h2>
                    {(!stats.recentActivity || stats.recentActivity.length === 0) && (
                        <p style={muted}>No activity yet.</p>
                    )}
                    {stats.recentActivity?.map((a, idx) => (
                        <div key={idx} style={activityRow}>
                            <span style={{ flex: 1 }}>{formatAction(a.action)}</span>
                            <span style={{ color: '#888', fontSize: 12 }}>{formatRelative(a.at)}</span>
                        </div>
                    ))}
                </>
            )}
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
const h2 = { fontSize: 18, fontWeight: 800, marginTop: 24, marginBottom: 12 };
const muted = { color: '#888', fontSize: 13, marginTop: 16 };
const errText = { color: '#ff5050', fontSize: 13, marginBottom: 12 };
const inlineBtn = { background: 'transparent', border: '1px solid #ff5050', color: '#ff5050', padding: '4px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', marginLeft: 8 };
const refreshBtn = { padding: '10px 20px', background: 'transparent', color: '#ff8800', border: '1px solid #ff8800', cursor: 'pointer', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', borderRadius: 4, marginTop: 12 };
const kpiGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 };
const card = { background: '#1a1a1a', border: '1px solid #333', padding: 16, borderRadius: 4, textAlign: 'center' };
const statValue = { fontSize: 28, fontWeight: 900, color: '#ff8800' };
const statLabel = { fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 };
const activityRow = { display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 3, marginBottom: 6, color: '#ddd', fontSize: 13 };
