// Marketing milestone Batch 1 — admin segments list + create/edit modal.
//
// Backed by /api/admin/segments. Phase 1 supports tag-membership (any/
// all/none) + LTV range + booking-count range filters; live preview
// count via POST /api/admin/segments/preview as the operator types.

import { useState, useEffect, useCallback } from 'react';

const SYSTEM_TAGS = ['vip', 'frequent', 'lapsed', 'new'];

export default function AdminSegments() {
    const [segments, setSegments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [editingSegment, setEditingSegment] = useState(null); // null | 'new' | {id,...}

    const reload = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch('/api/admin/segments', { credentials: 'include', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setSegments(data.segments || []);
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    async function handleDelete(id) {
        if (!window.confirm('Delete this segment? It will be permanently removed (B1 has no undo).')) return;
        try {
            const res = await fetch(`/api/admin/segments/${encodeURIComponent(id)}`, {
                method: 'DELETE', credentials: 'include',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await reload();
        } catch (e) {
            setErr(String(e.message || e));
        }
    }

    return (
        <div style={pageWrap}>
            <header style={pageHeader}>
                <div>
                    <h1 style={pageTitle}>Segments</h1>
                    <p style={pageSub}>
                        Customer groups for analysis (Batch 1) and campaigns (Batch 2+). Each
                        segment combines tags + LTV + booking count, AND-ed together. All
                        segments respect customer email-marketing consent automatically.
                    </p>
                </div>
                <button type="button" onClick={() => setEditingSegment('new')} style={primaryBtn}>
                    + New segment
                </button>
            </header>

            {err && <p style={errStyle}>Error: {err}</p>}

            {loading && <p style={muted}>Loading…</p>}

            {!loading && segments.length === 0 && (
                <p style={muted}>
                    No segments yet. Click "+ New segment" to create one for the next campaign.
                </p>
            )}

            {!loading && segments.length > 0 && (
                <table style={table}>
                    <thead>
                        <tr>
                            <th style={th}>Name</th>
                            <th style={th}>Criteria</th>
                            <th style={th}>Last count</th>
                            <th style={th}>Shared</th>
                            <th style={th}>Updated</th>
                            <th style={th}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {segments.map((s) => (
                            <tr key={s.id} style={tr}>
                                <td style={td}>
                                    <button
                                        type="button"
                                        onClick={() => setEditingSegment(s)}
                                        style={nameLink}
                                    >
                                        {s.name}
                                    </button>
                                </td>
                                <td style={td}>
                                    <code style={code}>{s.querySummary || '(no filters)'}</code>
                                </td>
                                <td style={td}>
                                    {s.lastPreviewCount != null
                                        ? `${s.lastPreviewCount}`
                                        : <em style={muted}>—</em>}
                                </td>
                                <td style={td}>{s.shared ? '✓' : ''}</td>
                                <td style={td}>{formatRelative(s.updatedAt)}</td>
                                <td style={td}>
                                    <button type="button" onClick={() => handleDelete(s.id)} style={deleteBtn}>
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {editingSegment && (
                <SegmentEditModal
                    segment={editingSegment === 'new' ? null : editingSegment}
                    onClose={() => setEditingSegment(null)}
                    onSaved={() => { setEditingSegment(null); reload(); }}
                />
            )}
        </div>
    );
}

function SegmentEditModal({ segment, onClose, onSaved }) {
    const isNew = !segment;
    const [name, setName] = useState(segment?.name || '');
    const [shared, setShared] = useState(segment?.shared || false);
    const [tagsAny, setTagsAny] = useState((segment?.query?.tags?.any || []).join(', '));
    const [tagsAll, setTagsAll] = useState((segment?.query?.tags?.all || []).join(', '));
    const [tagsNone, setTagsNone] = useState((segment?.query?.tags?.none || []).join(', '));
    const [ltvMin, setLtvMin] = useState(segment?.query?.ltvCents?.min != null ? String(segment.query.ltvCents.min / 100) : '');
    const [ltvMax, setLtvMax] = useState(segment?.query?.ltvCents?.max != null ? String(segment.query.ltvCents.max / 100) : '');
    const [bookingsMin, setBookingsMin] = useState(segment?.query?.totalBookings?.min != null ? String(segment.query.totalBookings.min) : '');
    const [bookingsMax, setBookingsMax] = useState(segment?.query?.totalBookings?.max != null ? String(segment.query.totalBookings.max) : '');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);

    function parseTagsCsv(s) {
        return s.split(',').map((t) => t.trim()).filter(Boolean);
    }

    function buildQuery() {
        const q = {
            v: 1,
            tags: {
                any: parseTagsCsv(tagsAny),
                all: parseTagsCsv(tagsAll),
                none: parseTagsCsv(tagsNone),
            },
            ltvCents: {},
            totalBookings: {},
        };
        if (ltvMin.trim()) q.ltvCents.min = Math.round(Number(ltvMin) * 100);
        if (ltvMax.trim()) q.ltvCents.max = Math.round(Number(ltvMax) * 100);
        if (bookingsMin.trim()) q.totalBookings.min = Number(bookingsMin);
        if (bookingsMax.trim()) q.totalBookings.max = Number(bookingsMax);
        return q;
    }

    // Debounced live preview: refetch the count whenever inputs change.
    useEffect(() => {
        let cancelled = false;
        setPreviewing(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetch('/api/admin/segments/preview', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: buildQuery() }),
                });
                if (cancelled) return;
                const data = await res.json();
                if (res.ok) setPreview(data);
                else setPreview({ error: data.error || `HTTP ${res.status}` });
            } catch (e) {
                if (!cancelled) setPreview({ error: String(e.message || e) });
            } finally {
                if (!cancelled) setPreviewing(false);
            }
        }, 400);
        return () => { cancelled = true; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tagsAny, tagsAll, tagsNone, ltvMin, ltvMax, bookingsMin, bookingsMax]);

    async function submit(e) {
        e.preventDefault();
        if (!name.trim()) { setErr('Name is required'); return; }
        setSubmitting(true);
        setErr(null);
        try {
            const payload = { name: name.trim(), query: buildQuery(), shared };
            const url = isNew
                ? '/api/admin/segments'
                : `/api/admin/segments/${encodeURIComponent(segment.id)}`;
            const method = isNew ? 'POST' : 'PUT';
            const res = await fetch(url, {
                method,
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(data.error || `HTTP ${res.status}`);
                return;
            }
            onSaved?.();
        } catch (e2) {
            setErr(String(e2.message || e2));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={modalBg} onClick={onClose}>
            <div style={modal} onClick={(e) => e.stopPropagation()}>
                <header style={modalHeader}>
                    <h2 style={{ margin: 0 }}>{isNew ? 'New segment' : `Edit: ${segment.name}`}</h2>
                    <button type="button" onClick={onClose} style={closeBtn}>×</button>
                </header>
                <form onSubmit={submit} style={modalBody}>
                    <label style={field}>
                        <span style={fieldLabel}>Name</span>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            style={input}
                            autoFocus
                            placeholder="e.g. VIP locals"
                        />
                    </label>
                    <label style={{ ...field, flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                        <span>Share with other admins</span>
                    </label>

                    <fieldset style={fieldset}>
                        <legend style={legend}>Tag criteria</legend>
                        <p style={hint}>System tags: <code>{SYSTEM_TAGS.join(', ')}</code>. Comma-separated; add manual tags as freeform text.</p>
                        <label style={field}>
                            <span style={fieldLabel}>Match ANY of</span>
                            <input type="text" value={tagsAny} onChange={(e) => setTagsAny(e.target.value)} style={input} placeholder="vip, frequent" />
                        </label>
                        <label style={field}>
                            <span style={fieldLabel}>Match ALL of</span>
                            <input type="text" value={tagsAll} onChange={(e) => setTagsAll(e.target.value)} style={input} placeholder="vip" />
                        </label>
                        <label style={field}>
                            <span style={fieldLabel}>Exclude</span>
                            <input type="text" value={tagsNone} onChange={(e) => setTagsNone(e.target.value)} style={input} placeholder="lapsed" />
                        </label>
                    </fieldset>

                    <fieldset style={fieldset}>
                        <legend style={legend}>Lifetime value (USD)</legend>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <label style={field}>
                                <span style={fieldLabel}>Min</span>
                                <input type="number" step="0.01" min="0" value={ltvMin} onChange={(e) => setLtvMin(e.target.value)} style={input} placeholder="0.00" />
                            </label>
                            <label style={field}>
                                <span style={fieldLabel}>Max</span>
                                <input type="number" step="0.01" min="0" value={ltvMax} onChange={(e) => setLtvMax(e.target.value)} style={input} placeholder="(unbounded)" />
                            </label>
                        </div>
                    </fieldset>

                    <fieldset style={fieldset}>
                        <legend style={legend}>Booking count</legend>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <label style={field}>
                                <span style={fieldLabel}>Min</span>
                                <input type="number" min="0" value={bookingsMin} onChange={(e) => setBookingsMin(e.target.value)} style={input} />
                            </label>
                            <label style={field}>
                                <span style={fieldLabel}>Max</span>
                                <input type="number" min="0" value={bookingsMax} onChange={(e) => setBookingsMax(e.target.value)} style={input} placeholder="(unbounded)" />
                            </label>
                        </div>
                    </fieldset>

                    <div style={previewBox}>
                        <strong>Live preview</strong>
                        {previewing && <span style={muted}> · computing…</span>}
                        {preview && preview.error && <span style={errStyle}> · error: {preview.error}</span>}
                        {preview && !preview.error && (
                            <span> · <strong>{preview.count}</strong> customer{preview.count === 1 ? '' : 's'} match</span>
                        )}
                    </div>

                    {err && <p style={errStyle}>{err}</p>}

                    <footer style={modalFooter}>
                        <button type="button" onClick={onClose} disabled={submitting} style={secondaryBtn}>Cancel</button>
                        <button type="submit" disabled={submitting || !name.trim()} style={primaryBtn}>
                            {submitting ? 'Saving…' : isNew ? 'Create segment' : 'Save changes'}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
}

function formatRelative(ms) {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(ms).toLocaleDateString();
}

const pageWrap = { maxWidth: 1100, margin: '0 auto', padding: '2rem' };
const pageHeader = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem' };
const pageTitle = { color: 'var(--color-text)', margin: 0 };
const pageSub = { color: 'var(--color-text-muted)', marginTop: '0.25rem', maxWidth: 700 };
const muted = { color: 'var(--color-text-muted)' };
const errStyle = { color: 'var(--color-danger)' };
const table = { width: '100%', borderCollapse: 'collapse', marginTop: '1rem' };
const th = { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: '0.85rem', textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: '0.5rem 0.75rem', color: 'var(--color-text)' };
const nameLink = { background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' };
const code = { background: 'var(--color-bg-sunken)', padding: '2px 6px', borderRadius: 3, fontSize: '0.85rem' };
const primaryBtn = { background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 700 };
const secondaryBtn = { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)', padding: '0.5rem 1rem', cursor: 'pointer' };
const deleteBtn = { background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' };
const modal = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', padding: 0, maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' };
const modalHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid var(--color-border)' };
const modalBody = { padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' };
const modalFooter = { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' };
const closeBtn = { background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '1.5rem', cursor: 'pointer', padding: '0.25rem 0.5rem' };
const field = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };
const fieldLabel = { fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text)' };
const fieldset = { border: '1px solid var(--color-border)', padding: '1rem', margin: 0 };
const legend = { fontWeight: 700, color: 'var(--color-accent)', padding: '0 0.5rem' };
const hint = { color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 };
const input = { padding: '0.4rem 0.6rem', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)' };
const previewBox = { background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', padding: '0.75rem 1rem', color: 'var(--color-text)' };
