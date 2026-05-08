import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

// Vendor directory: list, create, edit, soft-delete vendors; manage their
// contacts inline via an expandable row. Clicking "Packages" jumps to the
// package composer filtered to that vendor.

const FILTER_SCHEMA = [
    {
        key: 'includeDeleted',
        label: 'Show deleted',
        type: 'enum',
        options: [{ value: '1', label: 'Yes' }],
    },
];

export default function AdminVendors() {
    const { isAuthenticated, loading, hasRole } = useAdmin();
    const navigate = useNavigate();

    const [rows, setRows] = useState([]);
    const [filters, setFilters] = useState({ includeDeleted: '', q: '' });
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
        if (filters.q.trim()) params.set('q', filters.q.trim());
        if (filters.includeDeleted) params.set('includeDeleted', '1');
        const res = await fetch(`/api/admin/vendors?${params}`, { credentials: 'include', cache: 'no-store' });
        if (res.ok) setRows((await res.json()).vendors || []);
        setLoadingList(false);
    }, [filters.q, filters.includeDeleted]);

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

    const isFiltered = Boolean(filters.q || filters.includeDeleted);

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Vendors"
                description="Vendor directory. Manage contacts, COI expirations, and tags. Use Packages to compose vendor offerings or Contracts to manage signed agreements."
                breadcrumb={[{ label: 'Vendors' }]}
                secondaryActions={
                    <>
                        <Link to="/admin/vendor-contracts" style={subtleBtn}>Contracts</Link>
                        <Link to="/admin/vendor-packages" style={subtleBtn}>Packages →</Link>
                    </>
                }
                primaryAction={hasRole('manager') && (
                    <button onClick={() => setEditing({ id: 'new' })} style={primaryBtn}>+ New Vendor</button>
                )}
            />

            <FilterBar
                schema={FILTER_SCHEMA}
                value={filters}
                onChange={setFilters}
                searchValue={filters.q}
                onSearchChange={(q) => setFilters((f) => ({ ...f, q }))}
                searchPlaceholder="Search company or tags…"
                resultCount={rows.length}
                savedViewsKey="adminVendors"
            />

            <div style={tableBox}>
                {loadingList && <EmptyState variant="loading" title="Loading vendors…" compact />}
                {!loadingList && rows.length === 0 && (
                    <EmptyState
                        isFiltered={isFiltered}
                        title={isFiltered ? 'No vendors match these filters' : 'No vendors yet'}
                        description={isFiltered
                            ? 'Try clearing a filter or expanding the search.'
                            : 'Add one to build your first package.'}
                        action={hasRole('manager') && !isFiltered && (
                            <button onClick={() => setEditing({ id: 'new' })} style={primaryBtn}>+ New Vendor</button>
                        )}
                    />
                )}
                {!loadingList && rows.length > 0 && (
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
                    {vendor.deletedAt && <span style={deletedTag}>(deleted)</span>}
                </td>
                <td style={td}><span style={tagText}>{vendor.tags || '—'}</span></td>
                <td style={td}>
                    {vendor.coiExpiresOn ? (
                        <span style={{ ...coiChipBase, ...coiStatus.style }}>{coiStatus.label} · {vendor.coiExpiresOn}</span>
                    ) : <span style={dashCell}>—</span>}
                </td>
                <td style={td}><span style={tagText}>{vendor.contacts?.length || 0}</span></td>
                <td style={tdActions}>
                    {hasRole('manager') && <button onClick={onEdit} style={subtleBtn}>Edit</button>}
                    {hasRole('owner') && !vendor.deletedAt && (
                        <button onClick={onDelete} style={{ ...subtleBtn, marginLeft: 'var(--space-4)', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>Delete</button>
                    )}
                </td>
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={5} style={drawerCell}>
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
        <div style={drawerWrap}>
            {loading && <EmptyState variant="loading" title="Loading contacts…" compact />}
            {contacts && contacts.length === 0 && (
                <p style={drawerEmpty}>No contacts yet. Add at least one before sending a package.</p>
            )}
            {contacts && contacts.map((c) => (
                <div key={c.id} style={contactRow}>
                    <span style={contactInfo}>
                        {c.isPrimary && <span style={primaryChip}>PRIMARY</span>} <strong>{c.name}</strong>{' '}
                        <span style={{ color: 'var(--color-text-muted)' }}>&lt;{c.email}&gt;</span>
                        {c.phone && <span style={contactSub}>{c.phone}</span>}
                        {c.role && <span style={contactSub}>· {c.role}</span>}
                    </span>
                    <span style={{ flex: 1 }} />
                    {hasRole('manager') && !c.isPrimary && <button onClick={() => setPrimary(c)} style={subtleBtn}>Make primary</button>}
                    {hasRole('manager') && <button onClick={() => delContact(c)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Delete</button>}
                </div>
            ))}
            {hasRole('manager') && !adding && <button onClick={() => setAdding(true)} style={{ ...subtleBtn, marginTop: 'var(--space-8)' }}>+ Add contact</button>}
            {adding && (
                <form onSubmit={submit} style={addForm}>
                    <input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={input} />
                    <input type="email" placeholder="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required style={input} />
                    <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={input} />
                    <input placeholder="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={input} />
                    <label style={primaryCheckbox}>
                        <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> Set as primary
                    </label>
                    {err && <div style={{ ...errorText, gridColumn: '1 / span 4' }}>{err}</div>}
                    <div style={{ gridColumn: '1 / span 4', display: 'flex', gap: 'var(--space-8)' }}>
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
                <h2 style={modalTitle}>{isNew ? 'New Vendor' : 'Edit Vendor'}</h2>
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
                {err && <div style={errorText}>{err}</div>}
                <div style={modalActions}>
                    <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
                    <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
                </div>
            </form>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <label style={fieldLabel}>
            <div style={fieldLabelText}>{label}</div>
            {children}
        </label>
    );
}

function coiChipStatus(isoDate) {
    if (!isoDate) return { label: '', style: {} };
    const exp = new Date(isoDate + 'T23:59:59');
    if (isNaN(exp.getTime())) return { label: 'invalid', style: { background: 'var(--color-text-subtle)' } };
    const now = new Date();
    const days = Math.floor((exp - now) / (24 * 60 * 60 * 1000));
    // Domain-specific COI status colors stay raw — the gradient
    // (red expired / orange near / green ok) is information density.
    if (days < 0) return { label: 'EXPIRED', style: { background: 'var(--color-danger)', color: '#fff' } };
    if (days < 30) return { label: `${days}D LEFT`, style: { background: 'var(--color-warning)', color: '#fff' } };
    return { label: 'OK', style: { background: 'var(--color-success)', color: '#fff' } };
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
const input = {
    padding: 'var(--space-8) var(--space-12)',
    background: 'var(--color-bg-page)',
    border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
};
const tableBox = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-24)',
    marginTop: 'var(--space-16)',
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
const tdActions = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const drawerCell = {
    padding: 0,
    background: 'var(--color-bg-page)',
    borderBottom: '1px solid var(--color-border)',
};
const drawerWrap = { padding: 'var(--space-12) var(--space-16)' };
const drawerEmpty = {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    marginBottom: 'var(--space-8)',
};
const contactRow = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    padding: 'var(--space-4) 0',
    borderBottom: '1px solid var(--color-border-subtle)',
};
const contactInfo = {
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
};
const contactSub = {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    marginLeft: 'var(--space-8)',
};
const tagText = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
const dashCell = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
const deletedTag = {
    marginLeft: 'var(--space-8)',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-danger)',
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
const linkBtn = {
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
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
const modalTitle = {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    color: 'var(--color-text)',
    margin: '0 0 var(--space-12)',
};
const modalActions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-16)' };
const errorText = {
    color: 'var(--color-danger)',
    fontSize: 'var(--font-size-sm)',
    margin: 'var(--space-8) 0',
};
const coiChipBase = {
    display: 'inline-block',
    padding: 'var(--space-4) var(--space-8)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    borderRadius: 'var(--radius-sm)',
};
const primaryChip = {
    display: 'inline-block',
    padding: 'var(--space-4) var(--space-8)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    color: 'var(--color-accent)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-sm)',
    marginRight: 'var(--space-4)',
};
const addForm = {
    marginTop: 'var(--space-12)',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: 'var(--space-8)',
};
const primaryCheckbox = {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    gridColumn: '1 / span 4',
};
const fieldLabel = { display: 'block', marginBottom: 'var(--space-12)' };
const fieldLabelText = {
    fontSize: 'var(--font-size-sm)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    color: 'var(--color-accent)',
    fontWeight: 'var(--font-weight-bold)',
    marginBottom: 'var(--space-4)',
};
