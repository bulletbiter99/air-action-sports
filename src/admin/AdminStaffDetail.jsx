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
                {activeTab === 'documents' && <ComingSoon batch="Batch 5" feature="Document acknowledgments" />}
                {activeTab === 'access' && <ComingSoon batch="Batch 6" feature="Portal session log" />}
                {activeTab === 'issues' && <ComingSoon batch="Batch 14" feature="Incident log" />}
                {activeTab === 'certifications' && <CertificationsTab personId={p.id} canEdit={hasRole?.('manager')} />}
                {activeTab === 'schedule' && <ComingSoon batch="Batch 10" feature="Schedule & Pay" />}
            </div>
        </div>
    );
}

function ProfileTab({ person, canEdit, onSaved }) {
    return (
        <div style={section}>
            <h2 style={h2}>Profile</h2>
            <div style={fieldGrid}>
                <Field label="Full name" value={person.fullName} />
                <Field label="Preferred name" value={person.preferredName} />
                <Field label="Pronouns" value={person.pronouns} />
                <Field label="Email" value={person.email} hint={!person.viewerCanSeePii && person.email ? '(masked)' : null} />
                <Field label="Phone" value={person.phone} hint={!person.viewerCanSeePii && person.phone ? '(masked)' : null} />
                <Field label="Status" value={person.archivedAt ? `archived (${person.archivedReason || 'no reason'})` : person.status} />
                <Field label="Hired at" value={person.hiredAt ? new Date(person.hiredAt).toLocaleDateString() : null} />
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
            {canEdit && (
                <p style={{ color: 'var(--olive-light)', fontSize: 12, marginTop: 16, fontStyle: 'italic' }}>
                    Inline edit form coming in a follow-up batch. PUT /api/admin/staff/:id is wired today; admin curl works.
                </p>
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

    async function save() {
        setSaving(true);
        try {
            const body = { notes };
            if (person.viewerCanSeePii) body.notesSensitive = notesSensitive;
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
            {(person.notesSensitive !== null) && (
                <label style={{ ...lbl, display: 'block' }}>
                    Sensitive notes (HR-only — gated by staff.notes.read_sensitive)
                    <textarea value={notesSensitive} onChange={(e) => setNotesSensitive(e.target.value)} rows={4} style={input} disabled={!canEdit} />
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

function ComingSoon({ batch, feature }) {
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
