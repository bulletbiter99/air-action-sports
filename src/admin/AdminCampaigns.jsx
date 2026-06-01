// Marketing milestone Batch 3 — campaign list + composer.
//
// Backed by /api/admin/campaigns (B2a) + the send pipeline (B2b cron). A
// campaign is composed as a draft, previewed against its segment, then sent
// now or scheduled. Editing/sending is allowed only while draft|scheduled.
//
// Sends don't fire from here — POST /:id/send enqueues a recipient snapshot
// and the cron drains it (gated on the operator's Resend + postal-address
// config, per B2b). Until then a sent campaign sits at status 'sending' with
// 0/N delivered, which is expected pre-activation.

import { useState, useEffect, useCallback } from 'react';

const STATUS_FILTERS = ['', 'draft', 'scheduled', 'sending', 'sent', 'canceled'];
const STATUS_COLORS = {
    draft: 'var(--color-text-muted)',
    scheduled: 'var(--color-accent)',
    sending: 'var(--color-warning)',
    sent: 'var(--color-success)',
    canceled: 'var(--color-text-subtle)',
};

export default function AdminCampaigns() {
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [statusFilter, setStatusFilter] = useState('');
    const [editing, setEditing] = useState(null); // null | 'new' | {id,...}

    const reload = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
            const res = await fetch(`/api/admin/campaigns${qs}`, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setCampaigns(data.campaigns || []);
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { reload(); }, [reload]);

    return (
        <div style={pageWrap}>
            <header style={pageHeader}>
                <div>
                    <h1 style={pageTitle}>Campaigns</h1>
                    <p style={pageSub}>
                        One-off marketing emails to a customer segment (or the whole marketing-opted
                        base). Compose a draft, preview the audience, then send now or schedule.
                        Every send respects marketing consent and includes an unsubscribe link.
                    </p>
                </div>
                <button type="button" onClick={() => setEditing('new')} style={primaryBtn}>
                    + New campaign
                </button>
            </header>

            <div style={filterRow}>
                {STATUS_FILTERS.map((s) => (
                    <button
                        key={s || 'all'}
                        type="button"
                        onClick={() => setStatusFilter(s)}
                        style={statusFilter === s ? chipActive : chip}
                    >
                        {s ? s[0].toUpperCase() + s.slice(1) : 'All'}
                    </button>
                ))}
            </div>

            {err && <p style={errStyle}>Error: {err}</p>}
            {loading && <p style={muted}>Loading…</p>}

            {!loading && campaigns.length === 0 && (
                <p style={muted}>No campaigns{statusFilter ? ` in '${statusFilter}'` : ''} yet.</p>
            )}

            {!loading && campaigns.length > 0 && (
                <table style={table}>
                    <thead>
                        <tr>
                            <th style={th}>Name</th>
                            <th style={th}>Subject</th>
                            <th style={th}>Status</th>
                            <th style={th}>Recipients</th>
                            <th style={th}>Sent</th>
                            <th style={th}>Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        {campaigns.map((c) => (
                            <tr key={c.id} style={tr}>
                                <td style={td}>
                                    <button type="button" onClick={() => setEditing(c)} style={nameLink}>{c.name}</button>
                                </td>
                                <td style={td}>{c.subject}</td>
                                <td style={td}><StatusBadge status={c.status} /></td>
                                <td style={td}>{c.recipientCount}</td>
                                <td style={td}>
                                    {c.sentCount}{c.failedCount ? <span style={{ color: 'var(--color-danger)' }}> · {c.failedCount} failed</span> : ''}
                                </td>
                                <td style={td}>{formatRelative(c.updatedAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {editing && (
                <CampaignModal
                    initial={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onChanged={reload}
                />
            )}
        </div>
    );
}

function StatusBadge({ status }) {
    return <span style={{ color: STATUS_COLORS[status] || 'var(--color-text)', fontWeight: 700, textTransform: 'capitalize' }}>{status}</span>;
}

function CampaignModal({ initial, onClose, onChanged }) {
    const [current, setCurrent] = useState(initial); // null until created
    const [segments, setSegments] = useState([]);
    const [name, setName] = useState(initial?.name || '');
    const [subject, setSubject] = useState(initial?.subject || '');
    const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml || '');
    const [fromName, setFromName] = useState(initial?.fromName || '');
    const [segmentId, setSegmentId] = useState(initial?.segmentId || '');
    const [scheduleAt, setScheduleAt] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);
    const [preview, setPreview] = useState(null);
    const [stats, setStats] = useState(null);
    const [notice, setNotice] = useState(null);

    const status = current?.status || 'draft';
    const editable = !current || status === 'draft' || status === 'scheduled';

    // Load segments for the picker.
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/segments', { credentials: 'include', cache: 'no-store' });
                if (res.ok) setSegments((await res.json()).segments || []);
            } catch { /* picker just shows "Whole marketing base" */ }
        })();
    }, []);

    // Engagement stats for a sent/sending campaign (best-effort).
    useEffect(() => {
        if (!current?.id || (status !== 'sending' && status !== 'sent')) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/admin/campaigns/${encodeURIComponent(current.id)}/stats`, { credentials: 'include', cache: 'no-store' });
                if (!cancelled && res.ok) setStats((await res.json()).stats);
            } catch { /* stats are best-effort */ }
        })();
        return () => { cancelled = true; };
    }, [current?.id, status]);

    function bodyPayload() {
        return {
            name: name.trim(),
            subject: subject.trim(),
            bodyHtml,
            fromName: fromName.trim() || null,
            segmentId: segmentId || null,
        };
    }

    async function save(e) {
        e?.preventDefault();
        if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
            setErr('Name, subject, and body are all required.');
            return;
        }
        setSubmitting(true);
        setErr(null);
        try {
            const url = current ? `/api/admin/campaigns/${encodeURIComponent(current.id)}` : '/api/admin/campaigns';
            const res = await fetch(url, {
                method: current ? 'PUT' : 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload()),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(data.error || `HTTP ${res.status}`); return; }
            setCurrent(data.campaign);
            setNotice(current ? 'Saved.' : 'Draft created — preview the audience, then send.');
            onChanged?.();
        } catch (e2) {
            setErr(String(e2.message || e2));
        } finally {
            setSubmitting(false);
        }
    }

    async function action(path, payload, okMsg) {
        if (!current) return;
        setSubmitting(true);
        setErr(null);
        setNotice(null);
        try {
            const res = await fetch(`/api/admin/campaigns/${encodeURIComponent(current.id)}/${path}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(data.error || `HTTP ${res.status}`); return null; }
            if (data.campaign) setCurrent(data.campaign);
            if (okMsg) setNotice(okMsg);
            onChanged?.();
            return data;
        } catch (e2) {
            setErr(String(e2.message || e2));
            return null;
        } finally {
            setSubmitting(false);
        }
    }

    async function doPreview() {
        const data = await action('preview-recipients', {}, null);
        if (data) setPreview(data);
    }

    async function doSend() {
        if (!window.confirm('Send this campaign now? Recipients are locked in at send time and emails go out on the next cron tick.')) return;
        await action('send', {}, 'Send started — the cron will deliver in batches.');
    }

    async function doSchedule() {
        if (!scheduleAt) { setErr('Pick a date + time to schedule.'); return; }
        const ms = new Date(scheduleAt).getTime();
        if (!Number.isFinite(ms) || ms <= Date.now()) { setErr('Schedule time must be in the future.'); return; }
        await action('send', { scheduledAt: ms }, 'Scheduled.');
    }

    async function doCancel() {
        if (!window.confirm('Cancel this campaign? Un-sent recipients are dropped.')) return;
        await action('cancel', {}, 'Canceled.');
    }

    async function doDelete() {
        if (!current) { onClose(); return; }
        if (!window.confirm('Delete this campaign permanently?')) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/admin/campaigns/${encodeURIComponent(current.id)}`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(data.error || `HTTP ${res.status}`); return; }
            onChanged?.();
            onClose();
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
                    <h2 style={{ margin: 0 }}>
                        {current ? `Edit: ${current.name}` : 'New campaign'}
                        {current && <span style={{ marginLeft: '0.75rem' }}><StatusBadge status={status} /></span>}
                    </h2>
                    <button type="button" onClick={onClose} style={closeBtn}>×</button>
                </header>

                <form onSubmit={save} style={modalBody}>
                    <label style={field}>
                        <span style={fieldLabel}>Name (internal)</span>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={input} disabled={!editable} autoFocus placeholder="e.g. Spring VIP re-engage" />
                    </label>
                    <label style={field}>
                        <span style={fieldLabel}>Subject</span>
                        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} style={input} disabled={!editable} placeholder="What recipients see" />
                    </label>
                    <label style={field}>
                        <span style={fieldLabel}>Audience</span>
                        <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} style={input} disabled={!editable}>
                            <option value="">Whole marketing-opted base</option>
                            {segments.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}{s.lastPreviewCount != null ? ` (~${s.lastPreviewCount})` : ''}</option>
                            ))}
                        </select>
                    </label>
                    <label style={field}>
                        <span style={fieldLabel}>From name (optional)</span>
                        <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} style={input} disabled={!editable} placeholder="Air Action Sports" />
                    </label>
                    <label style={field}>
                        <span style={fieldLabel}>Body (HTML)</span>
                        <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} style={{ ...input, minHeight: 160, fontFamily: 'var(--font-mono, monospace)' }} disabled={!editable} placeholder="<p>Hi there…</p>" />
                        <span style={hint}>An unsubscribe link + the business postal address are appended automatically (CAN-SPAM).</span>
                    </label>

                    {preview && (
                        <div style={previewBox}>
                            <strong>{preview.count}</strong> recipient{preview.count === 1 ? '' : 's'}
                            {preview.sample?.length > 0 && (
                                <span style={muted}> · e.g. {preview.sample.slice(0, 3).map((r) => r.email).join(', ')}{preview.count > 3 ? '…' : ''}</span>
                            )}
                        </div>
                    )}

                    {stats && (
                        <div style={previewBox}>
                            <strong>Delivery</strong> · sent {stats.sent} · delivered {stats.delivered} · opened {stats.opened} · clicked {stats.clicked}
                            {(stats.bounced || stats.complained)
                                ? <span style={{ color: 'var(--color-danger)' }}> · {stats.bounced} bounced · {stats.complained} complained</span>
                                : null}
                        </div>
                    )}
                    {notice && <p style={noticeStyle}>{notice}</p>}
                    {err && <p style={errStyle}>{err}</p>}

                    <footer style={modalFooter}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {current && (status === 'draft' || status === 'canceled') && (
                                <button type="button" onClick={doDelete} disabled={submitting} style={deleteBtn}>Delete</button>
                            )}
                            {current && (status === 'draft' || status === 'scheduled') && (
                                <button type="button" onClick={doCancel} disabled={submitting} style={secondaryBtn}>Cancel campaign</button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            {editable && (
                                <button type="submit" disabled={submitting} style={secondaryBtn}>
                                    {submitting ? '…' : current ? 'Save' : 'Create draft'}
                                </button>
                            )}
                            {current && editable && (
                                <>
                                    <button type="button" onClick={doPreview} disabled={submitting} style={secondaryBtn}>Preview audience</button>
                                    <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} style={{ ...input, padding: '0.35rem 0.5rem' }} />
                                    <button type="button" onClick={doSchedule} disabled={submitting} style={secondaryBtn}>Schedule</button>
                                    <button type="button" onClick={doSend} disabled={submitting} style={primaryBtn}>Send now</button>
                                </>
                            )}
                            {!editable && <button type="button" onClick={onClose} style={primaryBtn}>Close</button>}
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
const pageHeader = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' };
const pageTitle = { color: 'var(--color-text)', margin: 0 };
const pageSub = { color: 'var(--color-text-muted)', marginTop: '0.25rem', maxWidth: 720 };
const muted = { color: 'var(--color-text-muted)' };
const errStyle = { color: 'var(--color-danger)' };
const noticeStyle = { color: 'var(--color-success)' };
const filterRow = { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' };
const chip = { background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-strong)', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' };
const chipActive = { ...chip, background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', borderColor: 'var(--color-accent)', fontWeight: 700 };
const table = { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' };
const th = { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: '0.85rem', textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: '0.5rem 0.75rem', color: 'var(--color-text)' };
const nameLink = { background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' };
const primaryBtn = { background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 700 };
const secondaryBtn = { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)', padding: '0.5rem 1rem', cursor: 'pointer' };
const deleteBtn = { background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' };
const modal = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', padding: 0, maxWidth: 680, width: '100%', maxHeight: '90vh', overflowY: 'auto' };
const modalHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid var(--color-border)' };
const modalBody = { padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' };
const modalFooter = { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' };
const closeBtn = { background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '1.5rem', cursor: 'pointer', padding: '0.25rem 0.5rem' };
const field = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };
const fieldLabel = { fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text)' };
const hint = { color: 'var(--color-text-muted)', fontSize: '0.8rem' };
const input = { padding: '0.4rem 0.6rem', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)' };
const previewBox = { background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', padding: '0.75rem 1rem', color: 'var(--color-text)' };
