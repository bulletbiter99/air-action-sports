// Post-M6 Track C — admin page for managing event archive links.
//
// Lists past events with link counts; click row to expand inline editor
// for per-event video + photo link management. Full-replace semantics
// match the backend: edit + save → DELETE + INSERT all.

import { useState, useEffect, useCallback } from 'react';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import { useAdmin } from './AdminContext';

export default function AdminEventArchive() {
    const { isAuthenticated, loading: authLoading } = useAdmin();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [openEventId, setOpenEventId] = useState(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch('/api/admin/event-archive', { credentials: 'include', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setEvents(data.events || []);
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (isAuthenticated) reload(); }, [isAuthenticated, reload]);

    if (authLoading || !isAuthenticated) return null;

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Event Archive"
                breadcrumb={[{ label: 'Event Archive' }]}
                description={
                    <>
                        Add highlight videos and photo gallery links to past events.
                        Changes appear on the public <a href="/games" target="_blank" rel="noopener noreferrer">/games</a> page.
                    </>
                }
            />

            {loading && <p style={muted}>Loading…</p>}
            {err && <p style={errStyle}>Error: {err}</p>}

            {!loading && !err && events.length === 0 && (
                <p style={muted}>No past events yet. Flip an event's `past` flag from the Events admin page first.</p>
            )}

            {!loading && events.map((ev) => (
                <details
                    key={ev.id}
                    open={openEventId === ev.id}
                    onToggle={(e) => setOpenEventId(e.currentTarget.open ? ev.id : null)}
                    style={eventRow}
                >
                    <summary style={summaryStyle}>
                        <div>
                            <div style={titleStyle}>{ev.title}</div>
                            <div style={meta}>{ev.dateIso} {ev.location && `· ${ev.location}`}</div>
                        </div>
                        <div style={counts}>
                            <span style={pill}>🎬 {ev.videoCount}</span>
                            <span style={pill}>📷 {ev.photoCount}</span>
                        </div>
                    </summary>
                    {openEventId === ev.id && (
                        <ArchiveEditor eventId={ev.id} onSaved={reload} />
                    )}
                </details>
            ))}
        </div>
    );
}

function ArchiveEditor({ eventId, onSaved }) {
    const [links, setLinks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/admin/event-archive/${encodeURIComponent(eventId)}`, {
                    credentials: 'include', cache: 'no-store',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled) setLinks(data.links || []);
            } catch (e) {
                if (!cancelled) setErr(String(e.message || e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [eventId]);

    function updateLink(idx, patch) {
        setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    }

    function removeLink(idx) {
        setLinks((prev) => prev.filter((_, i) => i !== idx));
    }

    function addLink(kind) {
        setLinks((prev) => [
            ...prev,
            { id: `new_${Date.now()}_${prev.length}`, kind, url: '', title: '', thumbnailUrl: '', ordering: prev.length },
        ]);
    }

    async function save() {
        setSaving(true);
        setErr(null);
        try {
            const payload = links.map((l) => ({
                kind: l.kind,
                url: l.url,
                title: l.title || null,
                thumbnail_url: l.thumbnailUrl || null,
                ordering: l.ordering,
            }));
            const res = await fetch(`/api/admin/event-archive/${encodeURIComponent(eventId)}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ links: payload }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(data.error || `HTTP ${res.status}`);
                return;
            }
            onSaved?.();
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <p style={muted}>Loading links…</p>;

    return (
        <div style={editorWrap}>
            {err && <p style={errStyle}>Error: {err}</p>}
            {links.map((link, idx) => (
                <div key={link.id} style={linkRow}>
                    <span style={kindBadge}>{link.kind === 'video' ? '🎬' : '📷'} {link.kind}</span>
                    <input
                        type="url"
                        placeholder={link.kind === 'video' ? 'YouTube URL' : 'Drive / image URL'}
                        value={link.url}
                        onChange={(e) => updateLink(idx, { url: e.target.value })}
                        style={inputStyle}
                    />
                    <input
                        type="text"
                        placeholder="Title (optional)"
                        value={link.title || ''}
                        onChange={(e) => updateLink(idx, { title: e.target.value })}
                        style={inputStyle}
                    />
                    <input
                        type="number"
                        min="0"
                        placeholder="Order"
                        value={link.ordering}
                        onChange={(e) => updateLink(idx, { ordering: Number(e.target.value) || 0 })}
                        style={{ ...inputStyle, width: 70 }}
                    />
                    <button type="button" onClick={() => removeLink(idx)} style={removeBtn}>×</button>
                </div>
            ))}
            <div style={addActions}>
                <button type="button" onClick={() => addLink('video')} style={addBtn}>+ Add video</button>
                <button type="button" onClick={() => addLink('photo')} style={addBtn}>+ Add photo</button>
                <button type="button" onClick={save} disabled={saving} style={saveBtn}>
                    {saving ? 'Saving…' : `Save (${links.length} link${links.length === 1 ? '' : 's'})`}
                </button>
            </div>
        </div>
    );
}

const pageWrap = { maxWidth: 1000, margin: '0 auto', padding: '2rem' };
const muted = { color: 'var(--color-text-muted)' };
const errStyle = { color: 'var(--color-danger)' };
const eventRow = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', marginBottom: '0.75rem', padding: '0.75rem 1rem', borderRadius: 4 };
const summaryStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '1rem' };
const titleStyle = { color: 'var(--color-text)', fontWeight: 600 };
const meta = { color: 'var(--color-text-muted)', fontSize: '0.85rem' };
const counts = { display: 'flex', gap: '0.5rem' };
const pill = { background: 'var(--color-bg-sunken)', color: 'var(--color-text)', padding: '0.25rem 0.5rem', borderRadius: 999, fontSize: '0.85rem' };
const editorWrap = { marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' };
const linkRow = { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' };
const kindBadge = { color: 'var(--color-text-muted)', fontSize: '0.85rem', minWidth: 80 };
const inputStyle = { flex: 1, padding: '0.4rem 0.6rem', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)' };
const removeBtn = { background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '1.1rem' };
const addActions = { display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' };
const addBtn = { background: 'var(--color-bg-sunken)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)', padding: '0.4rem 0.8rem', cursor: 'pointer' };
const saveBtn = { background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none', padding: '0.4rem 1rem', cursor: 'pointer', fontWeight: 700, marginLeft: 'auto' };
