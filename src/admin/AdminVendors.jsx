import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

// Vendor directory: list, create, edit, soft-delete vendors; manage their
// contacts inline via an expandable row. Clicking "Packages" jumps to the
// package composer filtered to that vendor.

export default function AdminVendors() {
    const { isAuthenticated, loading, hasRole } = useAdmin();
    const navigate = useNavigate();

    const [rows, setRows] = useState([]);
    const [q, setQ] = useState('');
    const [includeDeleted, setIncludeDeleted] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [editing, setEditing] = useState(null);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const load = useCallback(async () => {
        setLoadingList(true);
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        if (includeDeleted) params.set('includeDeleted', '1');
        const res = await fetch(`/api/admin/vendors?${params}`, { credentials: 'include', cache: 'no-store' });
        if (res.ok) setRows((await res.json()).vendors || []);
        setLoadingList(false);
    }, [q, includeDeleted]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    const del = async (v) => {
        if (!hasRole('owner')) { alert('Owner role required to delete vendors'); return; }
        if (!window.confirm(`Soft-delete "${v.companyName}"? Any active packages must be revoked (pass through ?force=1 if prompted).`)) return;
        let res = await fetch(`/api/admin/vendors/${v.id}`, { method: 'DELETE', credentials: 'include' });
        if (res.status === 409) {
            const d = await res.json();
            if (!window.confirm(`${d.error}\n\nProceed and revoke them all?`)) return;
            res = await fetch(`/api/admin/vendors/${v.id}?force=1`, { method: 'DELETE', credentials: 'include' });
        }
        if (res.ok) load();
    };

    if (loading || !isAuthenticated) return null;

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <h1 style={h1}>Vendors</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Link to="/admin/vendor-contracts" style={subtleBtn}>Contracts</Link>
                    <Link to="/admin/vendor-packages" style={subtleBtn}>Packages →</Link>
                    {hasRole('manager') && <button onClick={() => setEditing({ id: 'new' })} style={primaryBtn}>+ New Vendor</button>}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <input type="search" placeholder="Search company or tags…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: 1, minWidth: 200 }} />
                <label style={{ color: 'var(--tan-light)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} /> Show deleted
                </label>
            </div>

            <div style={tableBox}>
                {loadingList && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>Loading…</p>}
                {!loadingList && rows.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>No vendors yet. Add one to build your first package.</p>}
                {rows.length > 0 && (
                    <table style={table}>
                        <thead>
                            <tr>
                                <th style={th}>Company</th>
                                <th style={th}>Tags</th>
                                <th style={th}>COI expires</th>
                                <th style={th}>Contacts</th>
                                <th style={th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((v) => (
                                <VendorRow
                                    key={v.id}
                                    vendor={v}
                                    expanded={expanded === v.id}
                                    onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
                                    onEdit={() => setEditing(v)}
                                    onDelete={() => del(v)}
                                    hasRole={hasRole}
                                    onReload={load}
                                />
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {editing && (
                <VendorModal
                    vendor={editing.id === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); }}
                />
            )}
        </div>
    );
}

function VendorRow({ vendor, expanded, onToggle, onEdit, onDelete, hasRole, onReload }) {
    const coiStatus = useMemo(() => coiChipStatus(vendor.coiExpiresOn), [vendor.coiExpiresOn]);
    const [contacts, setContacts] = useState(null);
    const [contactLoading, setContactLoading] = useState(false);

    const loadDetail = useCallback(async () => {
        setContactLoading(true);
        const res = await fetch(`/api/admin/vendors/${vendor.id}`, { credentials: 'include', cache: 'no-store' });
        if (res.ok) {
            const d = await res.json();
            setContacts(d.vendor?.contacts || []);
        }
        setContactLoading(false);
    }, [vendor.id]);

    useEffect(() => { if (expanded && contacts === null) loadDetail(); }, [expanded, contacts, loadDetail]);

    return (
        <>
            <tr style={{ ...tr, opacity: vendor.deletedAt ? 0.5 : 1 }}>
                <td style={td}>
                    <button onClick={onToggle} style={linkBtn}>{expanded ? '▼' : '▶'} {vendor.companyName}</button>
                    {vendor.deletedAt && <span style={{ marginLeft: 8, fontSize: 10, color: '#e74c3c' }}>(deleted)</span>}
                </td>
                <td style={td}><span style={{ color: 'var(--tan-light)', fontSize: 12 }}>{vendor.tags || '—'}</span></td>
                <td style={td}>
                    {vendor.coiExpiresOn ? (
                        <span style={{ ...coiChipBase, ...coiStatus.style }}>{coiStatus.label} · {vendor.coiExpiresOn}</span>
                    ) : <span style={{ color: 'var(--olive-light)', fontSize: 11 }}>—</span>}
                </td>
                <td style={td}><span style={{ color: 'var(--tan-light)', fontSize: 12 }}>{vendor.contacts?.length || 0}</span></td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {hasRole('manager') && <button onClick={onEdit} style={subtleBtn}>Edit</button>}
                    {hasRole('owner') && !vendor.deletedAt && <button onClick={onDelete} style={{ ...subtleBtn, marginLeft: 6, color: '#e74c3c', borderColor: 'rgba(231,76,60,0.4)' }}>Delete</button>}
                </td>
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={5} style={{ padding: 0, background: 'var(--dark)', borderBottom: '1px solid rgba(200,184,154,0.1)' }}>
                        <ContactsDrawer
                            vendor={vendor}
                            contacts={contacts}
                            loading={contactLoading}
                            hasRole={hasRole}
                            onChanged={() => { loadDetail(); onReload(); }}
                        />
                    </td>
                </tr>
            )}
        </>
    );
}

function ContactsDrawer({ vendor, contacts, loading, hasRole, onChanged }) {
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ name: '', email: '', phone: '', role: '', isPrimary: false });
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setSaving(true);
        const res = await fetch(`/api/admin/vendors/${vendor.id}/contacts`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        });
        setSaving(false);
        if (!res.ok) { setErr((await res.json()).error || 'Failed'); return; }
        setForm({ name: '', email: '', phone: '', role: '', isPrimary: false });
        setAdding(false);
        onChanged();
    };

    const delContact = async (c) => {
        if (!window.confirm(`Delete contact ${c.name}?`)) return;
        const res = await fetch(`/api/admin/vendors/contacts/${c.id}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok) { alert((await res.json()).error || 'Failed'); return; }
        onChanged();
    };

    const setPrimary = async (c) => {
        const res = await fetch(`/api/admin/vendors/contacts/${c.id}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPrimary: true }),
        });
        if (res.ok) onChanged();
    };

    return (
        <div style={{ padding: '14px 20px' }}>
            {loading && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>Loading contacts…</p>}
            {contacts && contacts.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12, marginBottom: 10 }}>No contacts yet. Add at least one before sending a package.</p>}
            {contacts && contacts.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(200,184,154,0.05)' }}>
                    <span style={{ color: 'var(--cream)', fontSize: 13 }}>
                        {c.isPrimary && <span style={primaryChip}>PRIMARY</span>} <strong>{c.name}</strong> <span style={{ color: 'var(--tan-light)' }}>&lt;{c.email}&gt;</span>
                        {c.phone && <span style={{ color: 'var(--olive-light)', fontSize: 11, marginLeft: 8 }}>{c.phone}</span>}
                        {c.role && <span style={{ color: 'var(--olive-light)', fontSize: 11, marginLeft: 8 }}>· {c.role}</span>}
                    </span>
                    <span style={{ flex: 1 }} />
                    {hasRole('manager') && !c.isPrimary && <button onClick={() => setPrimary(c)} style={subtleBtn}>Make primary</button>}
                    {hasRole('manager') && <button onClick={() => delContact(c)} style={{ ...subtleBtn, marginLeft: 6 }}>Delete</button>}
                </div>
            ))}
            {hasRole('manager') && !adding && <button onClick={() => setAdding(true)} style={{ ...subtleBtn, marginTop: 10 }}>+ Add contact</button>}
            {adding && (
                <form onSubmit={submit} style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                    <input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={input} />
                    <input type="email" placeholder="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required style={input} />
                    <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={input} />
                    <input placeholder="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={input} />
                    <label style={{ color: 'var(--tan-light)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, gridColumn: '1 / span 4' }}>
                        <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> Set as primary
                    </label>
                    {err && <div style={{ color: '#e74c3c', fontSize: 12, gridColumn: '1 / span 4' }}>{err}</div>}
                    <div style={{ gridColumn: '1 / span 4', display: 'flex', gap: 8 }}>
                        <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Add'}</button>
                        <button type="button" onClick={() => { setAdding(false); setErr(''); }} style={subtleBtn}>Cancel</button>
                    </div>
                </form>
            )}
        </div>
    );
}

function VendorModal({ vendor, onClose, onSaved }) {
    const isNew = !vendor;
    const [form, setForm] = useState({
        companyName: vendor?.companyName || '',
        tags: vendor?.tags || '',
        website: vendor?.website || '',
        notes: vendor?.notes || '',
        coiExpiresOn: vendor?.coiExpiresOn || '',
    });
    const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setSaving(true);
        const url = isNew ? '/api/admin/vendors' : `/api/admin/vendors/${vendor.id}`;
        const res = await fetch(url, {
            method: isNew ? 'POST' : 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        });
        setSaving(false);
        if (!res.ok) { setErr((await res.json()).error || 'Failed'); return; }
        onSaved();
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={modal}>
                <h2 style={{ ...h1, fontSize: 20, marginBottom: 14 }}>{isNew ? 'New Vendor' : 'Edit Vendor'}</h2>
                <Field label="Company name *">
                    <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required style={input} />
                </Field>
                <Field label="Tags (comma separated)">
                    <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="food, medic, photo, safety…" style={input} />
                </Field>
                <Field label="Website">
                    <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} style={input} />
                </Field>
                <Field label="COI expires on (ISO date, e.g. 2026-12-31)">
                    <input value={form.coiExpiresOn} onChange={(e) => setForm({ ...form, coiExpiresOn: e.target.value })} placeholder="YYYY-MM-DD" style={input} />
                </Field>
                <Field label="Internal notes">
                    <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...input, minHeight: 70, resize: 'vertical' }} />
                </Field>
                {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
                    <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
                </div>
            </form>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <label style={{ display: 'block', marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
            {children}
        </label>
    );
}

function coiChipStatus(isoDate) {
    if (!isoDate) return { label: '', style: {} };
    const exp = new Date(isoDate + 'T23:59:59');
    if (isNaN(exp.getTime())) return { label: 'invalid', style: { background: '#555' } };
    const now = new Date();
    const days = Math.floor((exp - now) / (24 * 60 * 60 * 1000));
    if (days < 0) return { label: 'EXPIRED', style: { background: '#e74c3c', color: '#fff' } };
    if (days < 30) return { label: `${days}D LEFT`, style: { background: '#d9822b', color: '#fff' } };
    return { label: 'OK', style: { background: '#2e7d4a', color: '#fff' } };
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const tableBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const linkBtn = { padding: 0, background: 'transparent', border: 'none', color: 'var(--cream)', fontSize: 13, fontWeight: 700, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '1.5rem', width: '100%', maxWidth: 560, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto' };
const coiChipBase = { display: 'inline-block', padding: '3px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', borderRadius: 2 };
const primaryChip = { display: 'inline-block', padding: '2px 6px', fontSize: 9, fontWeight: 800, letterSpacing: 1, color: 'var(--orange)', border: '1px solid var(--orange)', borderRadius: 2, marginRight: 6 };
