// Marketing milestone Batch 5b — automations list + composer.
//
// Backed by /api/admin/automations (B5a) + the cron engine (runAutomationSweep).
// An automation is a standing rule: created paused, then activated. v1 triggers:
//   recurring  — re-send to the audience every N days.
//   tag_added  — send once to each customer that holds a tag.
//
// Sends are driven by the 15-min cron (gated on the operator's Resend + postal
// address, per B2b) — nothing fires from this page directly.

import { useState, useEffect, useCallback } from 'react';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';

const SYSTEM_TAGS = ['vip', 'frequent', 'lapsed', 'new'];

export default function AdminAutomations() {
    const [automations, setAutomations] = useState([]);
    const [segments, setSegments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [editing, setEditing] = useState(null); // null | 'new' | {id,...}

    const reload = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch('/api/admin/automations', { credentials: 'include', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setAutomations((await res.json()).automations || []);
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { reload(); }, [reload]);
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/segments', { credentials: 'include', cache: 'no-store' });
                if (res.ok) setSegments((await res.json()).segments || []);
            } catch { /* recurring just shows "Whole marketing base" */ }
        })();
    }, []);

    async function toggle(a) {
        const path = a.status === 'active' ? 'pause' : 'activate';
        try {
            const res = await fetch(`/api/admin/automations/${encodeURIComponent(a.id)}/${path}`, { method: 'POST', credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await reload();
        } catch (e) {
            setErr(String(e.message || e));
        }
    }

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Automations"
                description="Standing rules that email customers when a trigger fires — a recurring send to a segment, or a one-time send when a customer earns a tag. Create paused, then activate. Every send respects marketing consent + includes an unsubscribe link."
                breadcrumb={[{ label: 'Automations' }]}
                primaryAction={
                    <button type="button" onClick={() => setEditing('new')} style={primaryBtn}>+ New automation</button>
                }
            />

            {err && <p style={errStyle}>Error: {err}</p>}
            {loading && <p style={muted}>Loading…</p>}
            {!loading && automations.length === 0 && <p style={muted}>No automations yet.</p>}

            {!loading && automations.length > 0 && (
                <table style={table}>
                    <thead>
                        <tr>
                            <th style={th}>Name</th>
                            <th style={th}>Trigger</th>
                            <th style={th}>Status</th>
                            <th style={th}>Sent</th>
                            <th style={th}>Last run</th>
                            <th style={th}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {automations.map((a) => (
                            <tr key={a.id} style={tr}>
                                <td style={td}><button type="button" onClick={() => setEditing(a)} style={nameLink}>{a.name}</button></td>
                                <td style={td}>{describeTrigger(a)}</td>
                                <td style={td}>
                                    <span style={{ color: a.status === 'active' ? 'var(--color-success)' : 'var(--color-text-muted)', fontWeight: 700, textTransform: 'capitalize' }}>{a.status}</span>
                                </td>
                                <td style={td}>{a.sentCount}</td>
                                <td style={td}>{a.lastRunAt ? formatRelative(a.lastRunAt) : '—'}</td>
                                <td style={td}>
                                    <button type="button" onClick={() => toggle(a)} style={secondaryBtn}>
                                        {a.status === 'active' ? 'Pause' : 'Activate'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {editing && (
                <AutomationModal
                    initial={editing === 'new' ? null : editing}
                    segments={segments}
                    onClose={() => setEditing(null)}
                    onChanged={reload}
                />
            )}
        </div>
    );
}

function describeTrigger(a) {
    if (a.triggerType === 'recurring') return `Every ${a.triggerConfig?.intervalDays ?? '?'} days`;
    if (a.triggerType === 'tag_added') return `Tag added: ${a.triggerConfig?.tag ?? '?'}`;
    return a.triggerType;
}

function AutomationModal({ initial, segments, onClose, onChanged }) {
    const [current, setCurrent] = useState(initial);
    const [name, setName] = useState(initial?.name || '');
    const [subject, setSubject] = useState(initial?.subject || '');
    const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml || '');
    const [fromName, setFromName] = useState(initial?.fromName || '');
    const [triggerType, setTriggerType] = useState(initial?.triggerType || 'recurring');
    const [intervalDays, setIntervalDays] = useState(initial?.triggerConfig?.intervalDays ? String(initial.triggerConfig.intervalDays) : '30');
    const [tag, setTag] = useState(initial?.triggerConfig?.tag || '');
    const [segmentId, setSegmentId] = useState(initial?.segmentId || '');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);
    const [notice, setNotice] = useState(null);

    function triggerConfig() {
        return triggerType === 'recurring'
            ? { intervalDays: Number(intervalDays) }
            : { tag: tag.trim() };
    }

    async function save(e) {
        e?.preventDefault();
        if (!name.trim() || !subject.trim() || !bodyHtml.trim()) { setErr('Name, subject, and body are required.'); return; }
        if (triggerType === 'tag_added' && !tag.trim()) { setErr('Pick a tag for the tag-added trigger.'); return; }
        setSubmitting(true);
        setErr(null);
        try {
            const payload = {
                name: name.trim(), subject: subject.trim(), bodyHtml,
                fromName: fromName.trim() || null,
                triggerType, triggerConfig: triggerConfig(),
                segmentId: triggerType === 'recurring' ? (segmentId || null) : null,
            };
            const url = current ? `/api/admin/automations/${encodeURIComponent(current.id)}` : '/api/admin/automations';
            const res = await fetch(url, {
                method: current ? 'PUT' : 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(data.error || `HTTP ${res.status}`); return; }
            setCurrent(data.automation);
            setNotice(current ? 'Saved.' : 'Created (paused) — activate it when ready.');
            onChanged?.();
        } catch (e2) {
            setErr(String(e2.message || e2));
        } finally {
            setSubmitting(false);
        }
    }

    async function remove() {
        if (!current) { onClose(); return; }
        if (!window.confirm('Delete this automation? Its send history is removed too.')) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/admin/automations/${encodeURIComponent(current.id)}`, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) { setErr(`HTTP ${res.status}`); return; }
            onChanged?.();
            onClose();
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={modalBg} onClick={onClose}>
            <div style={modal} onClick={(e) => e.stopPropagation()}>
                <header style={modalHeader}>
                    <h2 style={{ margin: 0 }}>{current ? `Edit: ${current.name}` : 'New automation'}</h2>
                    <button type="button" onClick={onClose} style={closeBtn}>×</button>
                </header>
                <form onSubmit={save} style={modalBody}>
                    <label style={field}>
                        <span style={fieldLabel}>Name (internal)</span>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={input} autoFocus placeholder="e.g. New-customer welcome" />
                    </label>

                    <fieldset style={fieldset}>
                        <legend style={legend}>Trigger</legend>
                        <label style={field}>
                            <span style={fieldLabel}>When</span>
                            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} style={input}>
                                <option value="recurring">Recurring — every N days</option>
                                <option value="tag_added">Tag added — customer earns a tag</option>
                            </select>
                        </label>
                        {triggerType === 'recurring' ? (
                            <label style={field}>
                                <span style={fieldLabel}>Interval (days)</span>
                                <input type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} style={input} />
                            </label>
                        ) : (
                            <label style={field}>
                                <span style={fieldLabel}>Tag</span>
                                <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} style={input} placeholder="vip" list="aas-system-tags" />
                                <datalist id="aas-system-tags">
                                    {SYSTEM_TAGS.map((t) => <option key={t} value={t} />)}
                                </datalist>
                            </label>
                        )}
                    </fieldset>

                    {triggerType === 'recurring' && (
                        <label style={field}>
                            <span style={fieldLabel}>Audience</span>
                            <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} style={input}>
                                <option value="">Whole marketing-opted base</option>
                                {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </label>
                    )}

                    <label style={field}>
                        <span style={fieldLabel}>Subject</span>
                        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} style={input} />
                    </label>
                    <label style={field}>
                        <span style={fieldLabel}>From name (optional)</span>
                        <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} style={input} placeholder="Air Action Sports" />
                    </label>
                    <label style={field}>
                        <span style={fieldLabel}>Body (HTML)</span>
                        <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} style={{ ...input, minHeight: 140, fontFamily: 'var(--font-mono, monospace)' }} placeholder="<p>Hi there…</p>" />
                        <span style={hint}>Unsubscribe link + postal address are appended automatically (CAN-SPAM).</span>
                    </label>

                    {notice && <p style={noticeStyle}>{notice}</p>}
                    {err && <p style={errStyle}>{err}</p>}

                    <footer style={modalFooter}>
                        {current && <button type="button" onClick={remove} disabled={submitting} style={deleteBtn}>Delete</button>}
                        <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                            <button type="button" onClick={onClose} disabled={submitting} style={secondaryBtn}>Close</button>
                            <button type="submit" disabled={submitting} style={primaryBtn}>{submitting ? '…' : current ? 'Save' : 'Create (paused)'}</button>
                        </div>
                    </footer>
                </form>
            </div>
        </div>
    );
}

function formatRelative(ms) {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(ms).toLocaleDateString();
}

const pageWrap = { maxWidth: 1100, margin: '0 auto', padding: '2rem' };
const muted = { color: 'var(--color-text-muted)' };
const errStyle = { color: 'var(--color-danger)' };
const noticeStyle = { color: 'var(--color-success)' };
const table = { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' };
const th = { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: '0.85rem', textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: '0.5rem 0.75rem', color: 'var(--color-text)' };
const nameLink = { background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' };
const primaryBtn = { background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 700 };
const secondaryBtn = { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)', padding: '0.4rem 0.85rem', cursor: 'pointer' };
const deleteBtn = { background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' };
const modal = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', padding: 0, maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' };
const modalHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid var(--color-border)' };
const modalBody = { padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' };
const modalFooter = { display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' };
const closeBtn = { background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '1.5rem', cursor: 'pointer', padding: '0.25rem 0.5rem' };
const field = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };
const fieldLabel = { fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text)' };
const fieldset = { border: '1px solid var(--color-border)', padding: '1rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const legend = { fontWeight: 700, color: 'var(--color-accent)', padding: '0 0.5rem' };
const hint = { color: 'var(--color-text-muted)', fontSize: '0.8rem' };
const input = { padding: '0.4rem 0.6rem', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)' };
