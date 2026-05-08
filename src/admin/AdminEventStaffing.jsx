// M5 R9 — admin event staffing page (Surface 4b).
// Standalone page at /admin/events/:id/staffing — list assignments,
// invite new staff, change RSVP/role/pay, mark no-show/complete.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

const STATUS_LABELS = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    declined: 'Declined',
    no_show: 'No-show',
    completed: 'Completed',
};

// Domain-specific status colors stay raw — info density wins over tokens.
const STATUS_COLORS = {
    pending: { bg: 'rgba(240,160,64,0.15)', fg: 'var(--color-warning)' },
    confirmed: { bg: 'rgba(45,165,90,0.15)', fg: 'var(--color-success)' },
    declined: { bg: 'rgba(149,165,166,0.15)', fg: 'var(--color-text-muted)' },
    no_show: { bg: 'rgba(231,76,60,0.15)', fg: 'var(--color-danger)' },
    completed: { bg: 'rgba(74,144,194,0.15)', fg: 'var(--color-info)' },
};

export default function AdminEventStaffing() {
    const { id: eventId } = useParams();
    const navigate = useNavigate();
    const { isAuthenticated, loading, hasRole } = useAdmin();

    const [event, setEvent] = useState(null);
    const [assignments, setAssignments] = useState([]);
    const [loadingList, setLoadingList] = useState(true);
    const [showInvite, setShowInvite] = useState(false);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const load = useCallback(async () => {
        if (!eventId) return;
        setLoadingList(true);
        try {
            const [evRes, asRes] = await Promise.all([
                fetch(`/api/admin/events/${eventId}/detail`, { credentials: 'include', cache: 'no-store' }),
                fetch(`/api/admin/event-staffing?event_id=${encodeURIComponent(eventId)}`, { credentials: 'include', cache: 'no-store' }),
            ]);
            if (evRes.ok) setEvent((await evRes.json()).event);
            if (asRes.ok) setAssignments((await asRes.json()).assignments || []);
        } finally {
            setLoadingList(false);
        }
    }, [eventId]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    const updateStatus = async (assignmentId, newStatus) => {
        const res = await fetch(`/api/admin/event-staffing/${assignmentId}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus, respondedAt: Date.now() }),
        });
        if (res.ok) load();
    };

    const remove = async (assignmentId) => {
        if (!window.confirm('Remove this assignment? Only pending assignments can be removed.')) return;
        const res = await fetch(`/api/admin/event-staffing/${assignmentId}`, {
            method: 'DELETE', credentials: 'include',
        });
        if (res.ok) load();
        else {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'Remove failed');
        }
    };

    const markNoShow = async (assignmentId) => {
        if (!window.confirm('Mark this person as no-show? This is a permanent record on the event.')) return;
        const res = await fetch(`/api/admin/event-staffing/${assignmentId}/no-show`, {
            method: 'POST', credentials: 'include',
        });
        if (res.ok) load();
    };

    const markComplete = async (assignmentId) => {
        const res = await fetch(`/api/admin/event-staffing/${assignmentId}/complete`, {
            method: 'POST', credentials: 'include',
        });
        if (res.ok) load();
    };

    const stats = useMemo(() => {
        const counts = { pending: 0, confirmed: 0, declined: 0, no_show: 0, completed: 0 };
        for (const a of assignments) {
            if (a.status in counts) counts[a.status]++;
        }
        return counts;
    }, [assignments]);

    if (loading || !isAuthenticated) return null;

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title={event ? `Staffing — ${event.title}` : 'Staffing'}
                description={event ? `${event.displayDate || event.dateIso?.slice(0, 10)} · ${event.location || ''}` : 'Loading…'}
                breadcrumb={[
                    { label: 'Events', to: '/admin/events' },
                    { label: 'Staffing' },
                ]}
                secondaryActions={<Link to="/admin/events" style={subtleBtn}>← All events</Link>}
                primaryAction={hasRole('manager') && (
                    <button onClick={() => setShowInvite(true)} style={primaryBtn}>+ Assign staff</button>
                )}
            />

            <div style={statsGrid}>
                {['pending', 'confirmed', 'declined', 'no_show', 'completed'].map((s) => (
                    <div key={s} style={statCard}>
                        <div style={statLabel}>{STATUS_LABELS[s]}</div>
                        <div style={{ ...statValue, color: STATUS_COLORS[s].fg }}>{stats[s]}</div>
                    </div>
                ))}
            </div>

            <section style={tableBox}>
                {loadingList && <EmptyState variant="loading" title="Loading assignments…" compact />}
                {!loadingList && assignments.length === 0 && (
                    <EmptyState
                        title="No staff assigned yet"
                        description="Click '+ Assign staff' to invite the first person to this event."
                        action={hasRole('manager') && (
                            <button onClick={() => setShowInvite(true)} style={primaryBtn}>+ Assign staff</button>
                        )}
                    />
                )}
                {!loadingList && assignments.length > 0 && (
                    <div className="admin-table-wrap"><table style={table}>
                        <thead>
                            <tr>
                                <th style={th}>Person</th>
                                <th style={th}>Role</th>
                                <th style={th}>Shift</th>
                                <th style={th}>Status</th>
                                <th style={th}>Pay</th>
                                <th style={th}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {assignments.map((a) => {
                                const sColors = STATUS_COLORS[a.status] || STATUS_COLORS.pending;
                                return (
                                    <tr key={a.id} style={tr}>
                                        <td style={td}>
                                            <strong>{a.personName}</strong>
                                            <div style={subRow}>{a.personEmail}</div>
                                        </td>
                                        <td style={td}>{a.roleName}</td>
                                        <td style={tdSmall}>
                                            {a.shiftStartAt ? new Date(a.shiftStartAt).toLocaleString() : '—'}
                                            {a.shiftEndAt && <div>→ {new Date(a.shiftEndAt).toLocaleString()}</div>}
                                        </td>
                                        <td style={td}>
                                            <span style={{ ...statusPill, background: sColors.bg, color: sColors.fg }}>
                                                {STATUS_LABELS[a.status] || a.status}
                                            </span>
                                        </td>
                                        <td style={tdSmall}>
                                            {a.payKind || '—'}
                                            {a.payRateCents != null && (
                                                <div>${(a.payRateCents / 100).toFixed(2)}{a.payKind?.includes('hourly') ? '/hr' : ''}</div>
                                            )}
                                        </td>
                                        <td style={td}>
                                            {hasRole('manager') && a.status === 'pending' && (
                                                <>
                                                    <button onClick={() => updateStatus(a.id, 'confirmed')} style={subtleBtn}>Confirm</button>
                                                    <button onClick={() => updateStatus(a.id, 'declined')} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Decline</button>
                                                    <button onClick={() => remove(a.id)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Remove</button>
                                                </>
                                            )}
                                            {hasRole('manager') && (a.status === 'confirmed' || a.status === 'pending') && (
                                                <>
                                                    <button onClick={() => markComplete(a.id)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Complete</button>
                                                    <button onClick={() => markNoShow(a.id)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>No-show</button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table></div>
                )}
            </section>

            {showInvite && (
                <InviteStaffModal
                    eventId={eventId}
                    onClose={() => setShowInvite(false)}
                    onSaved={() => { setShowInvite(false); load(); }}
                />
            )}
        </div>
    );
}

function InviteStaffModal({ eventId, onClose, onSaved }) {
    const [form, setForm] = useState({
        personId: '', roleId: '',
        shiftStartAt: '', shiftEndAt: '',
        payKind: 'volunteer', payRateCents: '',
        notes: '',
    });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const [persons, setPersons] = useState([]);
    const [roles, setRoles] = useState([]);

    useEffect(() => {
        (async () => {
            const [pRes, rRes] = await Promise.all([
                fetch('/api/admin/staff?limit=200', { credentials: 'include', cache: 'no-store' }),
                fetch('/api/admin/persons-helpers/roles', { credentials: 'include', cache: 'no-store' }).catch(() => ({ ok: false })),
            ]);
            if (pRes.ok) setPersons((await pRes.json()).persons || []);
            // Roles endpoint may not exist yet — fall back to a hardcoded shortlist
            if (rRes && rRes.ok) {
                setRoles((await rRes.json()).roles || []);
            } else {
                setRoles([
                    { id: 'role_event_director', name: 'Event Director' },
                    { id: 'role_lead_marshal', name: 'Lead Marshal' },
                    { id: 'role_field_marshal', name: 'Field Marshal' },
                    { id: 'role_check_in', name: 'Check-in Staff' },
                ]);
            }
        })();
    }, []);

    async function submit() {
        if (!form.personId || !form.roleId) {
            setErr('Person and role are required');
            return;
        }
        setSaving(true);
        setErr('');
        try {
            const body = {
                eventId,
                personId: form.personId,
                roleId: form.roleId,
                shiftStartAt: form.shiftStartAt ? new Date(form.shiftStartAt).getTime() : null,
                shiftEndAt: form.shiftEndAt ? new Date(form.shiftEndAt).getTime() : null,
                payKind: form.payKind || null,
                payRateCents: form.payRateCents ? Math.round(parseFloat(form.payRateCents) * 100) : null,
                notes: form.notes || null,
            };
            const res = await fetch('/api/admin/event-staffing', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setErr(data.error || 'Assignment failed');
                return;
            }
            onSaved();
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={modalBg} onClick={onClose}>
            <div style={modal} onClick={(e) => e.stopPropagation()}>
                <div style={modalHeader}>
                    <h3 style={modalTitle}>Assign staff</h3>
                    <button onClick={onClose} style={subtleBtn}>Close</button>
                </div>

                <label style={lbl}>
                    Person *
                    <select value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })} style={input}>
                        <option value="">— select —</option>
                        {persons.map((p) => (
                            <option key={p.id} value={p.id}>{p.fullName} ({p.email})</option>
                        ))}
                    </select>
                </label>
                <label style={lbl}>
                    Role *
                    <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} style={input}>
                        <option value="">— select —</option>
                        {roles.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                    </select>
                </label>
                <label style={lbl}>
                    Shift starts
                    <input type="datetime-local" value={form.shiftStartAt} onChange={(e) => setForm({ ...form, shiftStartAt: e.target.value })} style={input} />
                </label>
                <label style={lbl}>
                    Shift ends
                    <input type="datetime-local" value={form.shiftEndAt} onChange={(e) => setForm({ ...form, shiftEndAt: e.target.value })} style={input} />
                </label>
                <label style={lbl}>
                    Pay kind
                    <select value={form.payKind} onChange={(e) => setForm({ ...form, payKind: e.target.value })} style={input}>
                        <option value="volunteer">Volunteer</option>
                        <option value="comp">Comp (event ticket / rental credit)</option>
                        <option value="w2_hourly">W2 hourly</option>
                        <option value="1099_hourly">1099 hourly</option>
                        <option value="1099_per_event">1099 per event</option>
                    </select>
                </label>
                {(form.payKind === 'w2_hourly' || form.payKind === '1099_hourly' || form.payKind === '1099_per_event') && (
                    <label style={lbl}>
                        Pay rate (USD)
                        <input
                            type="number"
                            step="0.01"
                            value={form.payRateCents}
                            onChange={(e) => setForm({ ...form, payRateCents: e.target.value })}
                            placeholder={form.payKind === '1099_per_event' ? 'flat rate per event' : 'per hour'}
                            style={input}
                        />
                    </label>
                )}
                <label style={lbl}>
                    Notes
                    <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} style={input} />
                </label>

                {err && <div style={errorText}>{err}</div>}

                <div style={modalActions}>
                    <button onClick={submit} disabled={saving} style={primaryBtn}>
                        {saving ? 'Sending invite…' : 'Assign + send invite'}
                    </button>
                    <button onClick={onClose} disabled={saving} style={subtleBtn}>Cancel</button>
                </div>
            </div>
        </div>
    );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
const statsGrid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 'var(--space-12)',
    marginTop: 'var(--space-16)',
    marginBottom: 'var(--space-24)',
};
const statCard = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-12) var(--space-16)',
};
const statLabel = {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wider)',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
};
const statValue = {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 'var(--font-weight-extrabold)',
    marginTop: 'var(--space-4)',
};
const tableBox = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-24)',
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-base)' };
const th = {
    textAlign: 'left',
    padding: 'var(--space-8) var(--space-12)',
    borderBottom: '1px solid var(--color-border-strong)',
    color: 'var(--color-accent)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
};
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)', verticalAlign: 'top' };
const tdSmall = { ...td, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
const subRow = { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
const statusPill = {
    display: 'inline-block',
    padding: 'var(--space-4) var(--space-8)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    borderRadius: 'var(--radius-sm)',
};
const primaryBtn = {
    padding: 'var(--space-8) var(--space-16)',
    background: 'var(--color-accent)',
    color: 'var(--color-accent-on-accent)',
    border: 'none',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    cursor: 'pointer',
};
const subtleBtn = {
    padding: 'var(--space-4) var(--space-12)',
    background: 'transparent',
    border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
};
const modalBg = {
    position: 'fixed',
    inset: 0,
    background: 'var(--color-overlay-strong)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 'var(--space-16)',
};
const modal = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border-strong)',
    padding: 'var(--space-24)',
    width: '100%',
    maxWidth: 560,
    borderRadius: 'var(--radius-md)',
    maxHeight: '92vh',
    overflowY: 'auto',
};
const modalHeader = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-16)',
};
const modalTitle = {
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
};
const modalActions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-16)' };
const lbl = {
    display: 'block',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-muted)',
    fontWeight: 'var(--font-weight-bold)',
    marginBottom: 'var(--space-12)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wide)',
};
const input = {
    width: '100%',
    padding: 'var(--space-8) var(--space-12)',
    background: 'var(--color-bg-page)',
    border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    marginTop: 'var(--space-4)',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
};
const errorText = {
    color: 'var(--color-danger)',
    fontSize: 'var(--font-size-sm)',
    margin: 'var(--space-8) 0',
};
