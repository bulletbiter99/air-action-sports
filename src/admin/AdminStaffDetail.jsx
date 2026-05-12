// M5 Batch 4 — Staff detail page (Surface 4a part 2). Eight tabs:
//
//   Profile        — view + edit name/contact/status (Batch 4)
//   Roles          — primary role + history; assign action (Batch 4)
//   Documents      — assigned docs + acknowledgments (placeholder; Batch 5
//                    library + 6 portal flow ship the full UX)
//   Notes          — internal notes + sensitive notes (Batch 4)
//   Access         — portal session log (placeholder; Batch 6)
//   Issues         — incidents involving this person (placeholder; Batch 14)
//   Certifications — cert add/edit/renew (placeholder; Batch 8)
//   Schedule       — labor entries + pay history (placeholder; Batch 10)

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminStaffCertEditor from './AdminStaffCertEditor.jsx';
import AdminStaffProfileEdit from './AdminStaffProfileEdit.jsx';

const TABS = [
    { key: 'profile',        label: 'Profile' },
    { key: 'roles',          label: 'Roles' },
    { key: 'documents',      label: 'Documents' },
    { key: 'notes',          label: 'Notes' },
    { key: 'access',         label: 'Access' },
    { key: 'issues',         label: 'Issues' },
    { key: 'certifications', label: 'Certifications' },
    { key: 'schedule',       label: 'Schedule' },
];

export default function AdminStaffDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { isAuthenticated, hasRole } = useAdmin();

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('profile');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/staff/${id}`, { credentials: 'include', cache: 'no-store' });
            if (res.ok) {
                setData(await res.json());
            } else if (res.status === 404) {
                navigate('/admin/staff');
            }
        } finally {
            setLoading(false);
        }
    }, [id, navigate]);

    useEffect(() => { if (isAuthenticated && id) load(); }, [isAuthenticated, id, load]);

    if (!isAuthenticated) return null;
    if (loading) return <div style={page}><p style={{ color: 'var(--olive-light)' }}>Loading…</p></div>;
    if (!data) return null;

    const p = data.person;

    return (
        <div style={page}>
            <header style={header}>
                <div>
                    <Link to="/admin/staff" style={breadcrumb}>← Staff</Link>
                    <h1 style={h1}>{p.fullName || p.preferredName || '—'}</h1>
                    <div style={metaRow}>
                        <span style={statusBase}>{p.archivedAt ? 'archived' : p.status}</span>
                        {data.roles?.find((r) => r.isPrimary) && (
                            <span style={metaText}>· {data.roles.find((r) => r.isPrimary).name} (Tier {data.roles.find((r) => r.isPrimary).tier})</span>
                        )}
                    </div>
                </div>
            </header>

            <nav style={tabs}>
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => setActiveTab(t.key)}
                        style={activeTab === t.key ? { ...tabBtn, ...tabBtnActive } : tabBtn}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            <div style={tabBody}>
                {activeTab === 'profile' && <ProfileTab person={p} canEdit={hasRole?.('manager')} onSaved={load} />}
                {activeTab === 'roles' && <RolesTab personId={p.id} roles={data.roles} canAssign={hasRole?.('manager')} onChanged={load} />}
                {activeTab === 'notes' && <NotesTab personId={p.id} person={p} canEdit={hasRole?.('manager')} onSaved={load} />}
                {activeTab === 'documents' && <TabPlaceholder batch="Batch 5" feature="Document acknowledgments" />}
                {activeTab === 'access' && <AccessTab personId={p.id} hasEmail={Boolean(p.email)} canInvite={hasRole?.('manager')} />}
                {activeTab === 'issues' && <TabPlaceholder batch="Batch 14" feature="Incident log" />}
                {activeTab === 'certifications' && <CertificationsTab personId={p.id} canEdit={hasRole?.('manager')} />}
                {activeTab === 'schedule' && <ScheduleTab personId={p.id} canEdit={hasRole?.('manager')} canMarkPaid={hasRole?.('owner')} />}
            </div>
        </div>
    );
}

function ProfileTab({ person, canEdit, onSaved }) {
    const [showEdit, setShowEdit] = useState(false);

    return (
        <div style={section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={h2}>Profile</h2>
                {canEdit && (
                    <button type="button" onClick={() => setShowEdit(true)} style={primaryBtn}>Edit profile</button>
                )}
            </div>
            <div style={fieldGrid}>
                <Field label="Full name" value={person.fullName} />
                <Field label="Preferred name" value={person.preferredName} />
                <Field label="Pronouns" value={person.pronouns} />
                <Field label="Email" value={person.email} hint={!person.viewerCanSeePii && person.email ? '(masked)' : null} />
                <Field label="Phone" value={person.phone} hint={!person.viewerCanSeePii && person.phone ? '(masked)' : null} />
                <Field label="Status" value={person.archivedAt ? `archived (${person.archivedReason || 'no reason'})` : person.status} />
                <Field label="Hired at" value={person.hiredAt ? new Date(person.hiredAt).toLocaleDateString() : null} />
                <Field label="Separated at" value={person.separatedAt ? new Date(person.separatedAt).toLocaleDateString() : null} />
                <Field label="Created at" value={person.createdAt ? new Date(person.createdAt).toLocaleString() : null} />
                {person.viewerCanSeePii && (
                    <Field label="Mailing address" value={person.mailingAddress} />
                )}
                {person.viewerCanSeeCompensation && (
                    <>
                        <Field label="Compensation kind" value={person.compensationKind || '—'} />
                        <Field label="Compensation rate (cents)" value={person.compensationRateCents != null ? String(person.compensationRateCents) : '—'} />
                    </>
                )}
            </div>

            {showEdit && (
                <AdminStaffProfileEdit
                    person={person}
                    onClose={() => setShowEdit(false)}
                    onSaved={() => { setShowEdit(false); onSaved?.(); }}
                />
            )}
        </div>
    );
}

function RolesTab({ personId, roles, canAssign, onChanged }) {
    const [showAssign, setShowAssign] = useState(false);
    const [allRoles, setAllRoles] = useState([]);
    const [pickedRoleId, setPickedRoleId] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!showAssign) return;
        // Fetch the role catalog the first time the modal opens.
        (async () => {
            const res = await fetch('/api/admin/staff/roles-catalog', { credentials: 'include' }).catch(() => null);
            if (res?.ok) {
                const data = await res.json();
                setAllRoles(data.roles || []);
            } else {
                // Endpoint not yet implemented; fall back to a minimal seeded list
                // so Owner can still pick something for testing.
                setAllRoles([
                    { id: 'role_event_director',    name: 'Event Director',         tier: 1 },
                    { id: 'role_booking_coordinator', name: 'Booking Coordinator',  tier: 1 },
                    { id: 'role_check_in_staff',    name: 'Check-In Staff',         tier: 3 },
                ]);
            }
        })();
    }, [showAssign]);

    async function submit() {
        if (!pickedRoleId) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/admin/staff/${personId}/role-assign`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roleId: pickedRoleId, notes }),
            });
            if (res.ok) {
                setShowAssign(false);
                setPickedRoleId('');
                setNotes('');
                onChanged?.();
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={h2}>Roles</h2>
                {canAssign && (
                    <button type="button" onClick={() => setShowAssign(true)} style={primaryBtn}>+ Assign Role</button>
                )}
            </div>
            <div style={{ marginTop: 16 }}>
                {(roles || []).length === 0 && <p style={{ color: 'var(--olive-light)', fontStyle: 'italic' }}>No roles assigned yet.</p>}
                {(roles || []).map((r) => (
                    <div key={r.id} style={roleRow}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <strong style={{ color: 'var(--cream)' }}>
                                {r.name} {r.isPrimary && <span style={pill}>Primary</span>}
                            </strong>
                            <span style={{ color: 'var(--olive-light)', fontSize: 12 }}>
                                Tier {r.tier} · effective {new Date(r.effectiveFrom).toLocaleDateString()}
                                {r.effectiveTo ? ` – ${new Date(r.effectiveTo).toLocaleDateString()}` : ''}
                            </span>
                            {r.notes && <span style={{ color: 'var(--tan-light)', fontSize: 12 }}>{r.notes}</span>}
                        </div>
                    </div>
                ))}
            </div>

            {showAssign && (
                <div style={modalBack} onClick={() => setShowAssign(false)}>
                    <div style={modalCard} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ ...h2, marginBottom: 16 }}>Assign primary role</h3>
                        <label style={{ ...lbl, display: 'block' }}>
                            Role
                            <select value={pickedRoleId} onChange={(e) => setPickedRoleId(e.target.value)} style={input}>
                                <option value="">— choose —</option>
                                {allRoles.map((r) => (
                                    <option key={r.id} value={r.id}>{r.name} (Tier {r.tier})</option>
                                ))}
                            </select>
                        </label>
                        <label style={{ ...lbl, display: 'block' }}>
                            Notes (optional)
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={input} />
                        </label>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                            <button type="button" onClick={() => setShowAssign(false)} style={cancelBtn}>Cancel</button>
                            <button type="button" disabled={!pickedRoleId || submitting} onClick={submit} style={primaryBtn}>
                                {submitting ? 'Assigning…' : 'Assign'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function NotesTab({ personId, person, canEdit, onSaved }) {
    const [notes, setNotes] = useState(person.notes || '');
    const [notesSensitive, setNotesSensitive] = useState(person.notesSensitive || '');
    const [saving, setSaving] = useState(false);

    // Show the sensitive-notes textarea whenever the viewer has read_sensitive,
    // even if the current value is null — they may want to author the first note.
    // The Write side of the PUT requires write_sensitive (server-enforced) and
    // we gate the field as disabled when only read is granted.
    const canSeeSensitive = Boolean(person.viewerCanSeeSensitiveNotes);
    const canWriteSensitive = Boolean(person.viewerCanWriteSensitiveNotes);

    async function save() {
        setSaving(true);
        try {
            const body = { notes };
            if (canWriteSensitive) body.notesSensitive = notesSensitive;
            const res = await fetch(`/api/admin/staff/${personId}/notes`, {
                method: 'PUT', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) onSaved?.();
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={section}>
            <h2 style={h2}>Notes</h2>
            <label style={{ ...lbl, display: 'block' }}>
                Notes (visible to all who can read this person)
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} style={input} disabled={!canEdit} />
            </label>
            {canSeeSensitive && (
                <label style={{ ...lbl, display: 'block' }}>
                    Sensitive notes (HR-only — gated by staff.notes.read_sensitive)
                    {!canWriteSensitive && <span style={maskHint}> · read-only</span>}
                    <textarea value={notesSensitive} onChange={(e) => setNotesSensitive(e.target.value)} rows={4} style={input} disabled={!canEdit || !canWriteSensitive} />
                </label>
            )}
            {canEdit && (
                <button type="button" onClick={save} disabled={saving} style={primaryBtn}>
                    {saving ? 'Saving…' : 'Save'}
                </button>
            )}
        </div>
    );
}

function AccessTab({ personId, hasEmail, canInvite }) {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [revokeTarget, setRevokeTarget] = useState(null);
    const [revokeReason, setRevokeReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [inviteResult, setInviteResult] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/staff/${personId}/portal-sessions`, { credentials: 'include', cache: 'no-store' });
            if (res.ok) {
                setSessions((await res.json()).sessions || []);
            }
        } finally { setLoading(false); }
    }, [personId]);

    useEffect(() => { load(); }, [load]);

    async function sendInvite() {
        setError(null);
        setInviteResult(null);
        setSubmitting(true);
        try {
            const res = await fetch(`/api/admin/staff/${personId}/invite`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setInviteResult(data.debugLink ? `Invite minted (no email sent — debug link: ${data.debugLink})` : 'Invite emailed to person.');
                await load();
            } else {
                setError(data?.error || `Invite failed (${res.status})`);
            }
        } finally { setSubmitting(false); }
    }

    async function submitRevoke() {
        if (!revokeTarget) return;
        setError(null);
        setSubmitting(true);
        try {
            const res = await fetch(`/api/admin/staff/${personId}/portal-sessions/${revokeTarget}/revoke`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: revokeReason.trim() || 'admin_revoked' }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setRevokeTarget(null);
                setRevokeReason('');
                await load();
            } else {
                setError(data?.error || `Revoke failed (${res.status})`);
            }
        } finally { setSubmitting(false); }
    }

    return (
        <div style={section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={h2}>Access</h2>
                {canInvite && (
                    <button type="button" disabled={!hasEmail || submitting} onClick={sendInvite} style={primaryBtn} title={!hasEmail ? 'Person has no email on file — add one in Profile first' : ''}>
                        {submitting ? 'Sending…' : '+ Send portal invite'}
                    </button>
                )}
            </div>
            {error && <div style={{ marginTop: 12, padding: 10, background: 'var(--color-danger-soft)', color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}
            {inviteResult && <div style={{ marginTop: 12, padding: 10, background: 'var(--color-success-soft)', color: 'var(--color-success)', fontSize: 13 }}>{inviteResult}</div>}

            <div style={{ marginTop: 16 }}>
                {loading && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
                {!loading && sessions.length === 0 && <p style={{ color: 'var(--olive-light)', fontStyle: 'italic' }}>No portal sessions on file.</p>}
                {!loading && sessions.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
                        <thead>
                            <tr>
                                <th style={accessTh}>Status</th>
                                <th style={accessTh}>Invited</th>
                                <th style={accessTh}>Consumed</th>
                                <th style={accessTh}>Expires</th>
                                <th style={accessTh}>IP</th>
                                <th style={accessTh}>User agent</th>
                                <th style={accessTh}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {sessions.map((s) => (
                                <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                    <td style={accessTd}>
                                        <span style={{ ...statusBase, ...accessStatus[s.status] }}>{s.status}</span>
                                        {s.revokedReason && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>({s.revokedReason})</span>}
                                    </td>
                                    <td style={accessTd}>{new Date(s.createdAt).toLocaleString()}</td>
                                    <td style={accessTd}>{s.consumedAt ? new Date(s.consumedAt).toLocaleString() : '—'}</td>
                                    <td style={accessTd}>{new Date(s.cookieExpiresAt || s.expiresAt).toLocaleString()}</td>
                                    <td style={accessTd}>{s.ipAddress || '—'}</td>
                                    <td style={{ ...accessTd, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.userAgent || ''}>{s.userAgent || '—'}</td>
                                    <td style={{ ...accessTd, textAlign: 'right' }}>
                                        {canInvite && (s.status === 'pending' || s.status === 'active') && (
                                            <button type="button" onClick={() => { setRevokeTarget(s.id); setRevokeReason(''); }} style={{ padding: '4px 10px', fontSize: 11, background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--color-warning)', cursor: 'pointer' }}>Revoke</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {revokeTarget && (
                <div style={modalBack} onClick={() => setRevokeTarget(null)}>
                    <div style={modalCard} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ ...h2, marginBottom: 16 }}>Revoke portal session</h3>
                        <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 12 }}>
                            Revoking will immediately invalidate the magic-link token (if unconsumed) or the live cookie session (if consumed). The person will be signed out of the portal.
                        </p>
                        <label style={{ ...lbl, display: 'block' }}>
                            Reason (optional)
                            <input type="text" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} style={input} maxLength={200} placeholder="e.g. lost device" />
                        </label>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                            <button type="button" onClick={() => setRevokeTarget(null)} style={cancelBtn}>Cancel</button>
                            <button type="button" disabled={submitting} onClick={submitRevoke} style={primaryBtn}>
                                {submitting ? 'Revoking…' : 'Revoke'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const accessTh = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 11, textTransform: 'uppercase' };
const accessTd = { padding: '6px 8px', fontSize: 12, color: 'var(--cream)' };
const accessStatus = {
    pending:  { background: 'var(--color-info-soft)',    color: 'var(--color-info)' },
    active:   { background: 'var(--color-success-soft)', color: 'var(--color-success)' },
    expired:  { background: 'var(--color-bg-sunken)',    color: 'var(--color-text-subtle)' },
    revoked:  { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' },
};

function CertificationsTab({ personId, canEdit }) {
    const [certs, setCerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/certifications?person_id=${personId}`, { credentials: 'include' });
            if (res.ok) setCerts((await res.json()).certifications || []);
        } finally { setLoading(false); }
    }, [personId]);

    useEffect(() => { load(); }, [load]);

    return (
        <div style={section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={h2}>Certifications</h2>
                {canEdit && (
                    <button type="button" onClick={() => setShowAdd((v) => !v)} style={primaryBtn}>
                        {showAdd ? 'Cancel' : '+ Add Certification'}
                    </button>
                )}
            </div>

            {showAdd && (
                <AdminStaffCertEditor
                    personId={personId}
                    mode="add"
                    onSaved={() => { setShowAdd(false); load(); }}
                    onCancel={() => setShowAdd(false)}
                />
            )}

            <div style={{ marginTop: 16 }}>
                {loading && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
                {!loading && certs.length === 0 && <p style={{ color: 'var(--olive-light)', fontStyle: 'italic' }}>No certifications on file.</p>}
                {!loading && certs.map((cert) => {
                    const isExpired = cert.expiresAt && cert.expiresAt < Date.now();
                    const expiresSoon = cert.expiresAt && (cert.expiresAt - Date.now()) < 60 * 86400000;
                    return (
                        <div key={cert.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <strong style={{ color: 'var(--cream)' }}>{cert.displayName}</strong>
                                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--olive-light)' }}>({cert.kind})</span>
                                    {cert.status !== 'active' && <span style={{ ...statusBase, marginLeft: 8, background: 'var(--color-bg-sunken)', color: 'var(--color-text-subtle)' }}>{cert.status}</span>}
                                    {cert.status === 'active' && isExpired && <span style={{ ...statusBase, marginLeft: 8, background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}>Expired</span>}
                                    {cert.status === 'active' && !isExpired && expiresSoon && <span style={{ ...statusBase, marginLeft: 8, background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>Expires soon</span>}
                                </div>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--tan-light)', marginTop: 4 }}>
                                {cert.issuingAuthority || '—'}
                                {cert.expiresAt && ` · expires ${new Date(cert.expiresAt).toLocaleDateString()}`}
                                {cert.certificateNumber && ` · #${cert.certificateNumber}`}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ScheduleTab({ personId, canEdit, canMarkPaid }) {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        workedAt: '', source: 'manual_entry', payKind: 'w2_hourly',
        amountDollars: '', hours: '', notes: '',
    });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/labor-entries?person_id=${personId}`, { credentials: 'include' });
            if (res.ok) setEntries((await res.json()).entries || []);
        } finally { setLoading(false); }
    }, [personId]);

    useEffect(() => { load(); }, [load]);

    async function submitEntry() {
        if (!form.workedAt || !form.payKind || !form.amountDollars) return;
        setSubmitting(true);
        try {
            const amountCents = Math.round(parseFloat(form.amountDollars) * 100);
            const body = {
                personId,
                workedAt: new Date(form.workedAt).getTime(),
                source: form.source,
                payKind: form.payKind,
                amountCents,
                hours: form.hours ? parseFloat(form.hours) : null,
                notes: form.notes || null,
            };
            const res = await fetch('/api/admin/labor-entries', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                setShowAdd(false);
                setForm({ workedAt: '', source: 'manual_entry', payKind: 'w2_hourly', amountDollars: '', hours: '', notes: '' });
                load();
            } else {
                const d = await res.json().catch(() => ({}));
                alert(d.error || 'Save failed');
            }
        } finally { setSubmitting(false); }
    }

    async function approve(id) {
        const res = await fetch(`/api/admin/labor-entries/${id}/approve`, { method: 'POST', credentials: 'include' });
        if (res.ok) load();
    }
    async function markPaid(id) {
        const ref = window.prompt('Payment reference (venmo, check #, etc.)?');
        if (ref == null) return;
        const res = await fetch(`/api/admin/labor-entries/${id}/mark-paid`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentReference: ref }),
        });
        if (res.ok) load();
    }
    async function dispute(id) {
        const note = window.prompt('Dispute note (optional):') || '';
        const res = await fetch(`/api/admin/labor-entries/${id}/dispute`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note }),
        });
        if (res.ok) load();
    }
    async function resolve(id) {
        const note = window.prompt('Resolution note:') || '';
        const res = await fetch(`/api/admin/labor-entries/${id}/resolve`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note }),
        });
        if (res.ok) load();
    }

    const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString() : '—';
    const fmtMoney = (cents) => cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;

    function statusOf(e) {
        if (e.rejected_at) return { key: 'rejected', label: 'Rejected', color: 'var(--color-danger)' };
        if (e.disputed_at && !e.resolved_at) return { key: 'disputed', label: 'Disputed', color: 'var(--color-warning)' };
        if (e.paid_at) return { key: 'paid', label: 'Paid', color: 'var(--color-success)' };
        if (e.approved_at) return { key: 'approved', label: 'Approved', color: 'var(--color-info)' };
        if (e.approval_required && !e.approved_at) return { key: 'pending', label: 'Pending approval', color: 'var(--color-warning)' };
        return { key: 'recorded', label: 'Recorded', color: 'var(--color-text-muted)' };
    }

    return (
        <div style={section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={h2}>Schedule &amp; Pay</h2>
                {canEdit && (
                    <button type="button" onClick={() => setShowAdd((v) => !v)} style={primaryBtn}>
                        {showAdd ? 'Cancel' : '+ Manual entry'}
                    </button>
                )}
            </div>

            {showAdd && (
                <div style={{ marginTop: 16, padding: 16, background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)' }}>
                    <label style={lbl}>Worked at <input type="date" value={form.workedAt} onChange={(e) => setForm({ ...form, workedAt: e.target.value })} style={input} /></label>
                    <label style={lbl}>Source <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={input}>
                        <option value="manual_entry">Manual entry</option>
                        <option value="event_completion">Event completion</option>
                        <option value="adjustment">Adjustment</option>
                    </select></label>
                    <label style={lbl}>Pay kind <select value={form.payKind} onChange={(e) => setForm({ ...form, payKind: e.target.value })} style={input}>
                        <option value="w2_hourly">W2 hourly</option>
                        <option value="1099_hourly">1099 hourly</option>
                        <option value="1099_per_event">1099 per event</option>
                        <option value="volunteer">Volunteer</option>
                        <option value="comp">Comp</option>
                    </select></label>
                    <label style={lbl}>Hours (optional) <input type="number" step="0.25" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} style={input} /></label>
                    <label style={lbl}>Amount (USD) <input type="number" step="0.01" value={form.amountDollars} onChange={(e) => setForm({ ...form, amountDollars: e.target.value })} style={input} /></label>
                    <label style={lbl}>Notes <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} style={input} /></label>
                    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '4px 0 8px' }}>
                        Manual entries above $200 require approval before they can be marked paid (HR self-approval cap).
                    </p>
                    <button type="button" onClick={submitEntry} disabled={!form.workedAt || !form.payKind || !form.amountDollars || submitting} style={primaryBtn}>
                        {submitting ? 'Saving…' : 'Save entry'}
                    </button>
                </div>
            )}

            <div style={{ marginTop: 16 }}>
                {loading && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
                {!loading && entries.length === 0 && <p style={{ color: 'var(--olive-light)', fontStyle: 'italic' }}>No labor entries on file.</p>}
                {!loading && entries.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 11, textTransform: 'uppercase' }}>Worked</th>
                                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 11, textTransform: 'uppercase' }}>Source</th>
                                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 11, textTransform: 'uppercase' }}>Pay kind</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                                <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border-strong)' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((e) => {
                                const s = statusOf(e);
                                return (
                                    <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                        <td style={{ padding: '6px 8px' }}>{fmtDate(e.worked_at)}</td>
                                        <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--color-text-muted)' }}>{e.source}</td>
                                        <td style={{ padding: '6px 8px', fontSize: 11 }}>{e.pay_kind}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoney(e.amount_cents)}</td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <span style={{ ...statusBase, background: 'transparent', color: s.color, border: `1px solid ${s.color}` }}>{s.label}</span>
                                        </td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {canEdit && s.key === 'pending' && <button onClick={() => approve(e.id)} style={{ ...primaryBtn, padding: '4px 10px', fontSize: 11 }}>Approve</button>}
                                            {canMarkPaid && (s.key === 'approved' || s.key === 'recorded') && <button onClick={() => markPaid(e.id)} style={{ ...primaryBtn, padding: '4px 10px', fontSize: 11, marginLeft: 4 }}>Mark paid</button>}
                                            {s.key !== 'disputed' && s.key !== 'rejected' && <button onClick={() => dispute(e.id)} style={{ padding: '4px 10px', fontSize: 11, marginLeft: 4, background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-muted)', cursor: 'pointer' }}>Dispute</button>}
                                            {canEdit && s.key === 'disputed' && <button onClick={() => resolve(e.id)} style={{ ...primaryBtn, padding: '4px 10px', fontSize: 11, marginLeft: 4 }}>Resolve</button>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function TabPlaceholder({ batch, feature }) {
    return (
        <div style={section}>
            <p style={{ color: 'var(--olive-light)', fontStyle: 'italic' }}>
                <strong style={{ color: 'var(--cream)' }}>{feature}</strong> — coming in {batch}.
            </p>
        </div>
    );
}

function Field({ label, value, hint }) {
    return (
        <div>
            <div style={fieldLabel}>{label}</div>
            <div style={fieldValue}>{value || '—'} {hint && <span style={maskHint}>{hint}</span>}</div>
        </div>
    );
}

const page = { maxWidth: 1100, margin: '0 auto', padding: '2rem' };
const header = { marginBottom: 24 };
const breadcrumb = { color: 'var(--orange)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 32, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: '8px 0 4px' };
const h2 = { fontSize: 18, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--cream)', margin: 0 };
const metaRow = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const metaText = { color: 'var(--tan-light)', fontSize: 13 };
const tabs = { display: 'flex', gap: 2, borderBottom: '1px solid var(--color-border-strong)', marginBottom: 24, overflowX: 'auto' };
const tabBtn = { padding: '10px 16px', background: 'transparent', border: 0, borderBottom: '3px solid transparent', color: 'var(--tan-light)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap' };
const tabBtnActive = { color: 'var(--orange)', borderBottomColor: 'var(--orange)' };
const tabBody = {};
const section = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', marginBottom: 16 };
const fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginTop: 16 };
const fieldLabel = { fontSize: 10, color: 'var(--olive-light)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 };
const fieldValue = { fontSize: 13, color: 'var(--cream)' };
const maskHint = { color: 'var(--olive-light)', fontSize: 10, fontStyle: 'italic' };
const lbl = { fontSize: 12, color: 'var(--tan-light)', fontWeight: 700, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 };
const input = { width: '100%', padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, marginTop: 6, fontFamily: 'inherit', boxSizing: 'border-box' };
const primaryBtn = { padding: '10px 20px', background: 'var(--orange)', color: 'white', border: 0, fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const cancelBtn = { padding: '10px 20px', background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const roleRow = { padding: '12px 0', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' };
const pill = { padding: '2px 8px', background: 'var(--color-accent-soft)', color: 'var(--orange)', fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderRadius: 3 };
const statusBase = { display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', background: 'var(--color-success-soft)', color: 'var(--color-success)' };
const modalBack = { position: 'fixed', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modalCard = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '2rem', maxWidth: 480, width: '100%' };
