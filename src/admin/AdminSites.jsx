// M5.5 Batch 6.5 — Sites list page. Backed by GET /api/admin/sites.
//
// Renders a table of sites with stats (active field count, upcoming
// events, upcoming rentals). "+ New site" opens a modal to create.
// Click a row → navigates to /admin/sites/:id.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const containerStyle = { padding: 'var(--space-24)' };
const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-16)',
};
const titleStyle = { fontSize: 24, fontWeight: 700, margin: 0 };
const primaryBtn = {
    background: 'var(--orange-strong, #d4541a)',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 600,
};
const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'var(--surface-card, white)',
    borderRadius: 4,
    overflow: 'hidden',
};
const thStyle = {
    textAlign: 'left',
    padding: '10px 12px',
    background: 'var(--surface-elevated, #f5f5f5)',
    fontWeight: 600,
    fontSize: 13,
    color: 'var(--text-secondary, #666)',
    borderBottom: '1px solid var(--border-soft, #e0e0e0)',
};
const tdStyle = {
    padding: '12px',
    borderBottom: '1px solid var(--border-soft, #f0f0f0)',
};
const rowStyle = { cursor: 'pointer' };
const archivedRowStyle = { opacity: 0.5 };
const errorStyle = {
    background: '#fef0f0',
    border: '1px solid #d4541a',
    padding: 'var(--space-12)',
    borderRadius: 4,
    marginBottom: 'var(--space-12)',
};
const modalBg = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '5vh',
    zIndex: 1000,
};
const modalBox = {
    background: 'var(--surface-card, white)',
    padding: 'var(--space-24)',
    borderRadius: 4,
    minWidth: 480,
    maxWidth: 640,
};
const fieldRow = { marginBottom: 'var(--space-12)' };
const labelStyle = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 4,
    color: 'var(--text-secondary, #666)',
};
const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--border-soft, #d0d0d0)',
    borderRadius: 4,
    fontSize: 14,
};

export default function AdminSites() {
    const [sites, setSites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [includeArchived, setIncludeArchived] = useState(false);

    const load = async () => {
        setLoading(true);
        setErr('');
        try {
            const url = includeArchived ? '/api/admin/sites?archived=true' : '/api/admin/sites';
            const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setSites(data.sites || []);
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [includeArchived]);

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <h2 style={titleStyle}>Sites</h2>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <input
                            type="checkbox"
                            checked={includeArchived}
                            onChange={(e) => setIncludeArchived(e.target.checked)}
                        />
                        Include archived
                    </label>
                    <button type="button" onClick={() => setShowCreate(true)} style={primaryBtn}>
                        + New site
                    </button>
                </div>
            </div>

            {err && <div style={errorStyle}>{err}</div>}

            {loading ? (
                <p style={{ color: 'var(--text-secondary, #666)' }}>Loading…</p>
            ) : sites.length === 0 ? (
                <p style={{ color: 'var(--text-secondary, #666)' }}>No sites yet. Create one to get started.</p>
            ) : (
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            <th style={thStyle}>Name</th>
                            <th style={thStyle}>City</th>
                            <th style={thStyle}>State</th>
                            <th style={thStyle}>Fields</th>
                            <th style={thStyle}>Upcoming events</th>
                            <th style={thStyle}>Upcoming rentals</th>
                            <th style={thStyle}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sites.map((s) => (
                            <tr
                                key={s.id}
                                style={{ ...rowStyle, ...(s.archivedAt ? archivedRowStyle : {}) }}
                            >
                                <td style={tdStyle}>
                                    <Link
                                        to={`/admin/sites/${s.id}`}
                                        style={{ color: 'var(--text-primary, #222)', textDecoration: 'none', fontWeight: 600 }}
                                    >
                                        {s.name}
                                    </Link>
                                </td>
                                <td style={tdStyle}>{s.city || '—'}</td>
                                <td style={tdStyle}>{s.state || '—'}</td>
                                <td style={tdStyle}>{s.activeFieldCount}</td>
                                <td style={tdStyle}>{s.upcomingEventCount}</td>
                                <td style={tdStyle}>{s.upcomingRentalCount}</td>
                                <td style={tdStyle}>
                                    {s.archivedAt ? (
                                        <span style={{ color: 'var(--text-secondary, #999)' }}>Archived</span>
                                    ) : (
                                        <span style={{ color: 'var(--status-active, #2a9d2a)' }}>Active</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {showCreate && (
                <CreateSiteModal
                    onClose={() => setShowCreate(false)}
                    onCreated={() => {
                        setShowCreate(false);
                        load();
                    }}
                />
            )}
        </div>
    );
}

function CreateSiteModal({ onClose, onCreated }) {
    const [form, setForm] = useState({
        name: '',
        slug: '',
        address: '',
        city: '',
        state: '',
        postalCode: '',
    });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');

    const handleChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setErr('');
        try {
            // Only send non-empty optional fields
            const body = { name: form.name };
            if (form.slug.trim()) body.slug = form.slug.trim();
            if (form.address.trim()) body.address = form.address.trim();
            if (form.city.trim()) body.city = form.city.trim();
            if (form.state.trim()) body.state = form.state.trim();
            if (form.postalCode.trim()) body.postalCode = form.postalCode.trim();

            const res = await fetch('/api/admin/sites', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            onCreated();
        } catch (e) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <div style={modalBox} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ marginTop: 0 }}>New site</h3>
                <form onSubmit={submit}>
                    <div style={fieldRow}>
                        <label style={labelStyle}>Name *</label>
                        <input
                            required
                            value={form.name}
                            onChange={handleChange('name')}
                            style={inputStyle}
                            placeholder="Ghost Town"
                        />
                    </div>
                    <div style={fieldRow}>
                        <label style={labelStyle}>Slug (auto-generated from name if empty)</label>
                        <input
                            value={form.slug}
                            onChange={handleChange('slug')}
                            style={inputStyle}
                            placeholder="ghost-town"
                        />
                    </div>
                    <div style={fieldRow}>
                        <label style={labelStyle}>Address</label>
                        <input value={form.address} onChange={handleChange('address')} style={inputStyle} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                        <div style={fieldRow}>
                            <label style={labelStyle}>City</label>
                            <input value={form.city} onChange={handleChange('city')} style={inputStyle} />
                        </div>
                        <div style={fieldRow}>
                            <label style={labelStyle}>State</label>
                            <input value={form.state} onChange={handleChange('state')} style={inputStyle} maxLength={2} />
                        </div>
                        <div style={fieldRow}>
                            <label style={labelStyle}>Postal code</label>
                            <input value={form.postalCode} onChange={handleChange('postalCode')} style={inputStyle} />
                        </div>
                    </div>

                    {err && <div style={errorStyle}>{err}</div>}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 'var(--space-16)' }}>
                        <button type="button" onClick={onClose} disabled={saving}>
                            Cancel
                        </button>
                        <button type="submit" disabled={saving || !form.name.trim()} style={primaryBtn}>
                            {saving ? 'Creating…' : 'Create site'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
