// C6 (2026-07-27) — admin incidents: file, review, resolve.
//
// Incidents could previously only be filed through the event-day kiosk, which
// is dead end-to-end, and could never be resolved at all — the resolution
// columns have existed since M5 with nothing writing them. Production has zero
// incidents, not because none happened but because there was nowhere to put
// one. So this ships a filing path as well as a resolve action.

import { useState, useEffect, useCallback } from 'react';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import { useAdmin } from './AdminContext';

const TYPES = [
    { value: 'injury', label: 'Injury' },
    { value: 'dispute', label: 'Dispute' },
    { value: 'safety', label: 'Safety' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'weather', label: 'Weather' },
    { value: 'other', label: 'Other' },
];

const SEVERITIES = [
    { value: 'minor', label: 'Minor' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'serious', label: 'Serious — escalates to the owner' },
];

const severityStyle = (s) => ({
    padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    ...(s === 'serious'
        ? { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }
        : s === 'moderate'
            ? { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }
            : { background: 'var(--color-bg-sunken)', color: 'var(--color-text-muted)' }),
});

const fmt = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

export default function AdminIncidents() {
    const { hasRole } = useAdmin();
    const canWrite = hasRole?.('manager');

    const [incidents, setIncidents] = useState([]);
    const [summary, setSummary] = useState({ open: 0, openSerious: 0 });
    const [status, setStatus] = useState('open');
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [filing, setFiling] = useState(false);
    const [resolving, setResolving] = useState(null); // incident being resolved

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const qs = status ? `?status=${encodeURIComponent(status)}` : '';
            const res = await fetch(`/api/admin/incidents${qs}`, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json();
            setIncidents(d.incidents || []);
            setSummary(d.summary || { open: 0, openSerious: 0 });
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => { load(); }, [load]);

    return (
        <div style={{ padding: 'var(--space-24)' }}>
            <AdminPageHeader
                title="Incidents"
                description="Injuries, disputes, safety and equipment reports. File one here or from the event-day tools, then resolve it with a note once it is closed out."
                breadcrumb={[{ label: 'Incidents' }]}
                primaryAction={canWrite && (
                    <button type="button" style={primaryBtn} onClick={() => setFiling(true)}>+ File incident</button>
                )}
            />

            {summary.openSerious > 0 && (
                <div style={alertBanner} role="status">
                    <strong>{summary.openSerious} serious incident{summary.openSerious > 1 ? 's' : ''}</strong>{' '}
                    still open.
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, margin: '0 0 var(--space-12)' }}>
                {[['open', `Open (${summary.open})`], ['resolved', 'Resolved'], ['', 'All']].map(([v, label]) => (
                    <button
                        key={v || 'all'}
                        type="button"
                        onClick={() => setStatus(v)}
                        style={status === v ? chipActive : chip}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {err && <p style={{ color: 'var(--color-danger)' }}>Error: {err}</p>}
            {loading && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}

            {!loading && incidents.length === 0 && (
                <p style={{ color: 'var(--olive-light)', fontStyle: 'italic' }}>
                    No {status || ''} incidents.
                </p>
            )}

            {!loading && incidents.map((inc) => (
                <div key={inc.id} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                            <span style={severityStyle(inc.severity)}>{inc.severity}</span>
                            <strong style={{ marginLeft: 8, color: 'var(--cream)' }}>
                                {TYPES.find((t) => t.value === inc.type)?.label || inc.type}
                            </strong>
                            {inc.resolvedAt && <span style={resolvedPill}>Resolved</span>}
                            {!inc.resolvedAt && inc.escalatedAt && <span style={escalatedPill}>Escalated</span>}
                        </div>
                        {canWrite && (
                            <div style={{ display: 'flex', gap: 6 }}>
                                {!inc.resolvedAt && (
                                    <button type="button" style={smallBtn} onClick={() => setResolving(inc)}>Resolve</button>
                                )}
                                {inc.resolvedAt && (
                                    <button
                                        type="button"
                                        style={smallBtn}
                                        onClick={async () => {
                                            await fetch(`/api/admin/incidents/${encodeURIComponent(inc.id)}/reopen`, {
                                                method: 'POST', credentials: 'include',
                                            });
                                            load();
                                        }}
                                    >
                                        Reopen
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--tan-light)', marginTop: 4 }}>
                        {inc.eventTitle || inc.eventId} · filed {fmt(inc.filedAt)}
                        {inc.filedByName ? ` by ${inc.filedByName}` : ''}
                        {inc.location ? ` · ${inc.location}` : ''}
                    </div>
                    {inc.narrative && (
                        <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontSize: 13 }}>{inc.narrative}</p>
                    )}
                    {inc.resolvedAt && (
                        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--olive-light)' }}>
                            Resolved {fmt(inc.resolvedAt)} — {inc.resolutionNote}
                        </p>
                    )}
                </div>
            ))}

            {filing && <FileIncidentModal onClose={() => setFiling(false)} onFiled={() => { setFiling(false); load(); }} />}
            {resolving && (
                <ResolveModal
                    incident={resolving}
                    onClose={() => setResolving(null)}
                    onResolved={() => { setResolving(null); load(); }}
                />
            )}
        </div>
    );
}

function FileIncidentModal({ onClose, onFiled }) {
    const [events, setEvents] = useState([]);
    const [eventId, setEventId] = useState('');
    const [type, setType] = useState('injury');
    const [severity, setSeverity] = useState('minor');
    const [location, setLocation] = useState('');
    const [narrative, setNarrative] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : { events: [] }))
            .then((d) => {
                if (cancelled) return;
                const list = d.events || [];
                setEvents(list);
                if (list.length) setEventId((prev) => prev || list[0].id);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const submit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setErr(null);
        try {
            const res = await fetch('/api/admin/incidents', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    eventId, type, severity,
                    location: location.trim() || null,
                    narrative: narrative.trim(),
                }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(d.error || `HTTP ${res.status}`); return; }
            onFiled?.();
        } catch (e2) {
            setErr(String(e2.message || e2));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form style={modalBox} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
                <h3 style={{ marginTop: 0 }}>File an incident</h3>
                {err && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>Error: {err}</p>}

                <label style={label} htmlFor="inc-event">Event</label>
                <select id="inc-event" style={input} value={eventId} onChange={(e) => setEventId(e.target.value)} required>
                    <option value="">— select —</option>
                    {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </select>

                <label style={label} htmlFor="inc-type">Type</label>
                <select id="inc-type" style={input} value={type} onChange={(e) => setType(e.target.value)}>
                    {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>

                <label style={label} htmlFor="inc-severity">Severity</label>
                <select id="inc-severity" style={input} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                    {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>

                <label style={label} htmlFor="inc-location">Location <span style={{ fontWeight: 400 }}>(optional)</span></label>
                <input id="inc-location" style={input} value={location} onChange={(e) => setLocation(e.target.value)} />

                <label style={label} htmlFor="inc-narrative">What happened</label>
                <textarea
                    id="inc-narrative" rows={6} style={input} required
                    value={narrative} onChange={(e) => setNarrative(e.target.value)}
                    placeholder="Who, what, where, when, and what was done about it."
                />

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={primaryBtn} disabled={submitting || !eventId || !narrative.trim()}>
                        {submitting ? 'Filing…' : 'File incident'}
                    </button>
                </div>
            </form>
        </div>
    );
}

function ResolveModal({ incident, onClose, onResolved }) {
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);

    const submit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setErr(null);
        try {
            const res = await fetch(`/api/admin/incidents/${encodeURIComponent(incident.id)}/resolve`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ note: note.trim() }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(d.error || `HTTP ${res.status}`); return; }
            onResolved?.();
        } catch (e2) {
            setErr(String(e2.message || e2));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form style={modalBox} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
                <h3 style={{ marginTop: 0 }}>Resolve incident</h3>
                {err && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>Error: {err}</p>}
                <p style={{ fontSize: 13, color: 'var(--tan-light)' }}>
                    The note is the record of how this was closed out — it is kept with the
                    incident and in the audit log. Resolving can be undone.
                </p>
                <label style={label} htmlFor="inc-note">Resolution</label>
                <textarea
                    id="inc-note" rows={5} style={input} required
                    value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="What was done, by whom, and any follow-up still owed."
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={primaryBtn} disabled={submitting || !note.trim()}>
                        {submitting ? 'Resolving…' : 'Resolve'}
                    </button>
                </div>
            </form>
        </div>
    );
}

const card = { background: 'var(--surface-card, #fff)', border: '1px solid var(--color-border-subtle)', borderRadius: 4, padding: 'var(--space-16)', marginBottom: 'var(--space-12)' };
const alertBanner = { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', color: 'var(--color-text)', padding: 'var(--space-12)', borderRadius: 4, marginBottom: 'var(--space-12)', fontSize: 13 };
const chip = { padding: '6px 12px', background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)', borderRadius: 999, fontSize: 12, cursor: 'pointer' };
const chipActive = { ...chip, background: 'var(--orange)', color: '#fff', borderColor: 'var(--orange)' };
const primaryBtn = { padding: '10px 20px', background: 'var(--orange)', color: '#fff', border: 0, fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const ghostBtn = { padding: '10px 20px', background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const smallBtn = { padding: '4px 10px', background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const resolvedPill = { marginLeft: 8, padding: '2px 8px', borderRadius: 12, background: 'var(--color-bg-sunken)', color: 'var(--color-text-subtle)', fontSize: 11, fontWeight: 700 };
const escalatedPill = { marginLeft: 8, padding: '2px 8px', borderRadius: 12, background: 'var(--color-warning-soft)', color: 'var(--color-warning)', fontSize: 11, fontWeight: 700 };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '5vh', zIndex: 1000 };
const modalBox = { background: 'var(--surface-card, #fff)', border: '1px solid var(--color-border-strong)', borderRadius: 4, padding: 'var(--space-24)', width: 'min(560px, 92vw)', maxHeight: '85vh', overflowY: 'auto' };
const label = { display: 'block', fontWeight: 600, fontSize: 12, margin: '12px 0 4px' };
const input = { width: '100%', padding: '8px 10px', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' };
