// M5.5 Batch 6.5 — Site detail page. Backed by GET /api/admin/sites/:id.
//
// Layout: single page with three sections — Site metadata (inline edit),
// Fields (CRUD), Blackouts (CRUD). No tabs.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';

const containerStyle = { padding: 'var(--space-24)' };
const backLinkStyle = { color: 'var(--text-secondary, #666)', textDecoration: 'none', fontSize: 13 };
const sectionHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'var(--space-24)',
    marginBottom: 'var(--space-12)',
};
const sectionTitleStyle = { fontSize: 18, fontWeight: 700, margin: 0 };
const cardStyle = {
    background: 'var(--surface-card, white)',
    padding: 'var(--space-16)',
    borderRadius: 4,
    border: '1px solid var(--border-soft, #e0e0e0)',
};
const fieldRow = { marginBottom: 'var(--space-12)' };
const fieldLabel = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary, #666)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
};
const fieldValue = { fontSize: 14, color: 'var(--text-primary, #222)' };
const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--border-soft, #d0d0d0)',
    borderRadius: 4,
    fontSize: 14,
};
const primaryBtn = {
    background: 'var(--orange-strong, #d4541a)',
    color: 'white',
    border: 'none',
    padding: '6px 14px',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 600,
};
const dangerBtn = {
    background: 'var(--danger-soft, #d4541a)',
    color: 'white',
    border: 'none',
    padding: '6px 14px',
    borderRadius: 4,
    cursor: 'pointer',
};
const secondaryBtn = {
    background: 'transparent',
    color: 'var(--text-primary, #222)',
    border: '1px solid var(--border-soft, #d0d0d0)',
    padding: '6px 14px',
    borderRadius: 4,
    cursor: 'pointer',
};
const tableStyle = { width: '100%', borderCollapse: 'collapse' };
const thStyle = {
    textAlign: 'left',
    padding: '8px 12px',
    background: 'var(--surface-elevated, #f5f5f5)',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary, #666)',
};
const tdStyle = { padding: '10px 12px', borderBottom: '1px solid var(--border-soft, #f0f0f0)', fontSize: 14 };
const errorStyle = {
    background: '#fef0f0',
    border: '1px solid #d4541a',
    padding: '10px 14px',
    borderRadius: 4,
    marginBottom: 'var(--space-12)',
    fontSize: 13,
};

export default function AdminSiteDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');

    const load = async () => {
        setLoading(true);
        setErr('');
        try {
            const res = await fetch(`/api/admin/sites/${id}`, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            setData(await res.json());
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    if (loading && !data) {
        return <div style={containerStyle}><p>Loading…</p></div>;
    }
    if (err && !data) {
        return (
            <div style={containerStyle}>
                <Link to="/admin/sites" style={backLinkStyle}>← Back to sites</Link>
                <div style={errorStyle}>{err}</div>
            </div>
        );
    }
    if (!data) return null;

    const { site } = data;

    return (
        <div style={containerStyle}>
            <Link to="/admin/sites" style={backLinkStyle}>← Back to sites</Link>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 0' }}>
                {site.name}
                {site.archivedAt && (
                    <span style={{ marginLeft: 12, fontSize: 14, color: 'var(--text-secondary, #999)', fontWeight: 400 }}>(Archived)</span>
                )}
            </h2>

            {err && <div style={errorStyle}>{err}</div>}

            <MetadataSection site={site} stats={data.stats} onChange={load} setErr={setErr} />
            <FieldsSection siteId={site.id} fields={data.fields} archived={!!site.archivedAt} onChange={load} setErr={setErr} />
            <BlackoutsSection siteId={site.id} blackouts={data.blackouts} archived={!!site.archivedAt} onChange={load} setErr={setErr} />
        </div>
    );

    // Note: this never runs — navigate is used inside the archive handler below.
    // eslint-disable-next-line no-unreachable
    function _unused() { navigate('/admin/sites'); }
}

// ────────────────────────────────────────────────────────────────────
// MetadataSection — site fields with edit + archive
// ────────────────────────────────────────────────────────────────────

function MetadataSection({ site, stats, onChange, setErr }) {
    const navigate = useNavigate();
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(siteToForm(site));
    const [saving, setSaving] = useState(false);

    useEffect(() => { setForm(siteToForm(site)); }, [site]);

    const handleChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setErr('');
        try {
            const body = formToBody(form, site);
            if (Object.keys(body).length === 0) {
                setEditing(false);
                return;
            }
            const res = await fetch(`/api/admin/sites/${site.id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            setEditing(false);
            onChange();
        } catch (e) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    const archive = async () => {
        if (!confirm(`Archive site "${site.name}"? This refuses if there are upcoming events or rentals.`)) return;
        setErr('');
        try {
            const res = await fetch(`/api/admin/sites/${site.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            navigate('/admin/sites');
        } catch (e) {
            setErr(e.message);
        }
    };

    return (
        <>
            <div style={sectionHeaderStyle}>
                <h3 style={sectionTitleStyle}>Site metadata</h3>
                {!editing && !site.archivedAt && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={() => setEditing(true)} style={secondaryBtn}>Edit</button>
                        <button type="button" onClick={archive} style={dangerBtn}>Archive site</button>
                    </div>
                )}
            </div>

            <div style={cardStyle}>
                {editing ? (
                    <form onSubmit={submit}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>Name *</label>
                                <input required value={form.name} onChange={handleChange('name')} style={inputStyle} />
                            </div>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>Slug</label>
                                <input value={form.slug} onChange={handleChange('slug')} style={inputStyle} />
                            </div>
                            <div style={{ ...fieldRow, gridColumn: '1 / -1' }}>
                                <label style={fieldLabel}>Address</label>
                                <input value={form.address} onChange={handleChange('address')} style={inputStyle} />
                            </div>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>City</label>
                                <input value={form.city} onChange={handleChange('city')} style={inputStyle} />
                            </div>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>State</label>
                                <input value={form.state} onChange={handleChange('state')} style={inputStyle} maxLength={2} />
                            </div>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>Postal code</label>
                                <input value={form.postalCode} onChange={handleChange('postalCode')} style={inputStyle} />
                            </div>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>Total acreage</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={form.totalAcreage}
                                    onChange={handleChange('totalAcreage')}
                                    style={inputStyle}
                                />
                            </div>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>Arrival buffer (min)</label>
                                <input
                                    type="number"
                                    value={form.defaultArrivalBufferMinutes}
                                    onChange={handleChange('defaultArrivalBufferMinutes')}
                                    style={inputStyle}
                                />
                            </div>
                            <div style={fieldRow}>
                                <label style={fieldLabel}>Cleanup buffer (min)</label>
                                <input
                                    type="number"
                                    value={form.defaultCleanupBufferMinutes}
                                    onChange={handleChange('defaultCleanupBufferMinutes')}
                                    style={inputStyle}
                                />
                            </div>
                            <div style={{ ...fieldRow, gridColumn: '1 / -1' }}>
                                <label style={fieldLabel}>Default blackout window</label>
                                <input
                                    value={form.defaultBlackoutWindow}
                                    onChange={handleChange('defaultBlackoutWindow')}
                                    style={inputStyle}
                                    placeholder="e.g. no operations 22:00-07:00 local"
                                />
                            </div>
                            <div style={{ ...fieldRow, gridColumn: '1 / -1' }}>
                                <label style={fieldLabel}>Notes</label>
                                <textarea
                                    value={form.notes}
                                    onChange={handleChange('notes')}
                                    style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 'var(--space-12)' }}>
                            <button type="button" onClick={() => { setEditing(false); setForm(siteToForm(site)); }} disabled={saving} style={secondaryBtn}>
                                Cancel
                            </button>
                            <button type="submit" disabled={saving || !form.name.trim()} style={primaryBtn}>
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                        <KV label="Slug" value={site.slug} />
                        <KV label="City" value={site.city} />
                        <KV label="State" value={site.state} />
                        <KV label="Postal code" value={site.postalCode} />
                        <KV label="Total acreage" value={site.totalAcreage} />
                        <KV label="Address" value={site.address} />
                        <KV label="Arrival buffer" value={site.defaultArrivalBufferMinutes ? `${site.defaultArrivalBufferMinutes} min` : null} />
                        <KV label="Cleanup buffer" value={site.defaultCleanupBufferMinutes ? `${site.defaultCleanupBufferMinutes} min` : null} />
                        <KV label="Blackout window" value={site.defaultBlackoutWindow} />
                        <KV label="Upcoming events" value={stats?.upcomingEventCount} />
                        <KV label="Upcoming rentals" value={stats?.upcomingRentalCount} />
                        {site.notes && (
                            <div style={{ gridColumn: '1 / -1' }}>
                                <KV label="Notes" value={site.notes} />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

function KV({ label, value }) {
    return (
        <div>
            <div style={fieldLabel}>{label}</div>
            <div style={fieldValue}>{value || value === 0 ? value : <span style={{ color: '#999' }}>—</span>}</div>
        </div>
    );
}

function siteToForm(s) {
    return {
        name: s.name || '',
        slug: s.slug || '',
        address: s.address || '',
        city: s.city || '',
        state: s.state || '',
        postalCode: s.postalCode || '',
        totalAcreage: s.totalAcreage ?? '',
        notes: s.notes || '',
        defaultArrivalBufferMinutes: s.defaultArrivalBufferMinutes ?? 30,
        defaultCleanupBufferMinutes: s.defaultCleanupBufferMinutes ?? 30,
        defaultBlackoutWindow: s.defaultBlackoutWindow || '',
    };
}

function formToBody(form, original) {
    const body = {};
    const cmp = (k, formKey) => {
        const formVal = form[formKey];
        const origVal = original[formKey];
        if ((formVal ?? '') !== (origVal ?? '')) body[k] = formVal === '' ? null : formVal;
    };
    cmp('name', 'name');
    cmp('slug', 'slug');
    cmp('address', 'address');
    cmp('city', 'city');
    cmp('state', 'state');
    cmp('postalCode', 'postalCode');
    cmp('notes', 'notes');
    cmp('defaultBlackoutWindow', 'defaultBlackoutWindow');
    if ((form.totalAcreage ?? '') !== (original.totalAcreage ?? '')) {
        body.totalAcreage = form.totalAcreage === '' ? null : Number(form.totalAcreage);
    }
    if (Number(form.defaultArrivalBufferMinutes) !== (original.defaultArrivalBufferMinutes ?? 30)) {
        body.defaultArrivalBufferMinutes = Number(form.defaultArrivalBufferMinutes);
    }
    if (Number(form.defaultCleanupBufferMinutes) !== (original.defaultCleanupBufferMinutes ?? 30)) {
        body.defaultCleanupBufferMinutes = Number(form.defaultCleanupBufferMinutes);
    }
    return body;
}

// ────────────────────────────────────────────────────────────────────
// FieldsSection — fields list + add/edit/archive
// ────────────────────────────────────────────────────────────────────

function FieldsSection({ siteId, fields, archived, onChange, setErr }) {
    const [showAdd, setShowAdd] = useState(false);

    return (
        <>
            <div style={sectionHeaderStyle}>
                <h3 style={sectionTitleStyle}>Fields ({fields.length})</h3>
                {!archived && !showAdd && (
                    <button type="button" onClick={() => setShowAdd(true)} style={primaryBtn}>+ Add field</button>
                )}
            </div>

            {showAdd && (
                <div style={cardStyle}>
                    <AddFieldForm
                        siteId={siteId}
                        onClose={() => setShowAdd(false)}
                        onCreated={() => { setShowAdd(false); onChange(); }}
                        setErr={setErr}
                    />
                </div>
            )}

            {fields.length === 0 ? (
                <p style={{ color: 'var(--text-secondary, #666)' }}>No fields yet.</p>
            ) : (
                <div style={cardStyle}>
                    <table style={tableStyle}>
                        <thead>
                            <tr>
                                <th style={thStyle}>Name</th>
                                <th style={thStyle}>Slug</th>
                                <th style={thStyle}>Acreage</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {fields.map((f) => (
                                <FieldRow key={f.id} siteId={siteId} field={f} onChange={onChange} setErr={setErr} disabled={archived} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function AddFieldForm({ siteId, onClose, onCreated, setErr }) {
    const [form, setForm] = useState({ name: '', slug: '', approximateAcreage: '', notes: '' });
    const [saving, setSaving] = useState(false);
    const handleChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setErr('');
        try {
            const body = { name: form.name };
            if (form.slug.trim()) body.slug = form.slug.trim();
            if (form.approximateAcreage !== '') body.approximateAcreage = Number(form.approximateAcreage);
            if (form.notes.trim()) body.notes = form.notes;

            const res = await fetch(`/api/admin/sites/${siteId}/fields`, {
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
        <form onSubmit={submit}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 12 }}>
                <div style={fieldRow}>
                    <label style={fieldLabel}>Name *</label>
                    <input required value={form.name} onChange={handleChange('name')} style={inputStyle} />
                </div>
                <div style={fieldRow}>
                    <label style={fieldLabel}>Slug</label>
                    <input value={form.slug} onChange={handleChange('slug')} style={inputStyle} />
                </div>
                <div style={fieldRow}>
                    <label style={fieldLabel}>Acreage</label>
                    <input
                        type="number"
                        step="0.01"
                        value={form.approximateAcreage}
                        onChange={handleChange('approximateAcreage')}
                        style={inputStyle}
                    />
                </div>
            </div>
            <div style={fieldRow}>
                <label style={fieldLabel}>Notes</label>
                <input value={form.notes} onChange={handleChange('notes')} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" onClick={onClose} disabled={saving} style={secondaryBtn}>Cancel</button>
                <button type="submit" disabled={saving || !form.name.trim()} style={primaryBtn}>
                    {saving ? 'Adding…' : 'Add field'}
                </button>
            </div>
        </form>
    );
}

function FieldRow({ siteId, field, onChange, setErr, disabled }) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({
        name: field.name,
        slug: field.slug,
        approximateAcreage: field.approximateAcreage ?? '',
        notes: field.notes || '',
    });
    const [saving, setSaving] = useState(false);

    const handleChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const save = async () => {
        if (saving) return;
        setSaving(true);
        setErr('');
        try {
            const body = {};
            if (form.name !== field.name) body.name = form.name;
            if (form.slug !== field.slug) body.slug = form.slug;
            const approxNum = form.approximateAcreage === '' ? null : Number(form.approximateAcreage);
            if (approxNum !== (field.approximateAcreage ?? null)) body.approximateAcreage = approxNum;
            if ((form.notes || '') !== (field.notes || '')) body.notes = form.notes || null;

            if (Object.keys(body).length === 0) { setEditing(false); return; }

            const res = await fetch(`/api/admin/sites/${siteId}/fields/${field.id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            setEditing(false);
            onChange();
        } catch (e) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    const archive = async () => {
        if (!confirm(`Archive field "${field.name}"?`)) return;
        setErr('');
        try {
            const res = await fetch(`/api/admin/sites/${siteId}/fields/${field.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            onChange();
        } catch (e) {
            setErr(e.message);
        }
    };

    if (editing) {
        return (
            <tr style={field.archivedAt ? { opacity: 0.5 } : {}}>
                <td style={tdStyle}>
                    <input value={form.name} onChange={handleChange('name')} style={inputStyle} />
                </td>
                <td style={tdStyle}>
                    <input value={form.slug} onChange={handleChange('slug')} style={inputStyle} />
                </td>
                <td style={tdStyle}>
                    <input
                        type="number"
                        step="0.01"
                        value={form.approximateAcreage}
                        onChange={handleChange('approximateAcreage')}
                        style={inputStyle}
                    />
                </td>
                <td style={tdStyle}>{field.archivedAt ? 'Archived' : 'Active'}</td>
                <td style={tdStyle}>
                    <button type="button" onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
                    <button
                        type="button"
                        onClick={() => { setEditing(false); setForm({ name: field.name, slug: field.slug, approximateAcreage: field.approximateAcreage ?? '', notes: field.notes || '' }); }}
                        style={{ ...secondaryBtn, marginLeft: 6 }}
                    >
                        Cancel
                    </button>
                </td>
            </tr>
        );
    }

    return (
        <tr style={field.archivedAt ? { opacity: 0.5 } : {}}>
            <td style={tdStyle}>{field.name}</td>
            <td style={tdStyle}>{field.slug}</td>
            <td style={tdStyle}>{field.approximateAcreage ?? '—'}</td>
            <td style={tdStyle}>{field.archivedAt ? 'Archived' : 'Active'}</td>
            <td style={tdStyle}>
                {!field.archivedAt && !disabled && (
                    <>
                        <button type="button" onClick={() => setEditing(true)} style={secondaryBtn}>Edit</button>
                        <button type="button" onClick={archive} style={{ ...dangerBtn, marginLeft: 6 }}>Archive</button>
                    </>
                )}
            </td>
        </tr>
    );
}

// ────────────────────────────────────────────────────────────────────
// BlackoutsSection — create + delete (no edit)
// ────────────────────────────────────────────────────────────────────

function BlackoutsSection({ siteId, blackouts, archived, onChange, setErr }) {
    const [showAdd, setShowAdd] = useState(false);

    return (
        <>
            <div style={sectionHeaderStyle}>
                <h3 style={sectionTitleStyle}>Blackouts ({blackouts.length})</h3>
                {!archived && !showAdd && (
                    <button type="button" onClick={() => setShowAdd(true)} style={primaryBtn}>+ Add blackout</button>
                )}
            </div>

            {showAdd && (
                <div style={cardStyle}>
                    <AddBlackoutForm
                        siteId={siteId}
                        onClose={() => setShowAdd(false)}
                        onCreated={() => { setShowAdd(false); onChange(); }}
                        setErr={setErr}
                    />
                </div>
            )}

            {blackouts.length === 0 ? (
                <p style={{ color: 'var(--text-secondary, #666)' }}>No blackouts.</p>
            ) : (
                <div style={cardStyle}>
                    <table style={tableStyle}>
                        <thead>
                            <tr>
                                <th style={thStyle}>Starts</th>
                                <th style={thStyle}>Ends</th>
                                <th style={thStyle}>Reason</th>
                                <th style={thStyle}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {blackouts.map((b) => (
                                <BlackoutRow key={b.id} siteId={siteId} blackout={b} onChange={onChange} setErr={setErr} disabled={archived} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function AddBlackoutForm({ siteId, onClose, onCreated, setErr }) {
    const [form, setForm] = useState({ startsAt: '', endsAt: '', reason: '' });
    const [saving, setSaving] = useState(false);
    const handleChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setErr('');
        try {
            const startsAt = new Date(form.startsAt).getTime();
            const endsAt = new Date(form.endsAt).getTime();
            if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
                throw new Error('Invalid date/time');
            }
            const body = { startsAt, endsAt };
            if (form.reason.trim()) body.reason = form.reason.trim();
            const res = await fetch(`/api/admin/sites/${siteId}/blackouts`, {
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
        <form onSubmit={submit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
                <div style={fieldRow}>
                    <label style={fieldLabel}>Starts *</label>
                    <input
                        type="datetime-local"
                        required
                        value={form.startsAt}
                        onChange={handleChange('startsAt')}
                        style={inputStyle}
                    />
                </div>
                <div style={fieldRow}>
                    <label style={fieldLabel}>Ends *</label>
                    <input
                        type="datetime-local"
                        required
                        value={form.endsAt}
                        onChange={handleChange('endsAt')}
                        style={inputStyle}
                    />
                </div>
                <div style={fieldRow}>
                    <label style={fieldLabel}>Reason</label>
                    <input value={form.reason} onChange={handleChange('reason')} style={inputStyle} placeholder="Maintenance" />
                </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" onClick={onClose} disabled={saving} style={secondaryBtn}>Cancel</button>
                <button type="submit" disabled={saving} style={primaryBtn}>
                    {saving ? 'Adding…' : 'Add blackout'}
                </button>
            </div>
        </form>
    );
}

function BlackoutRow({ siteId, blackout, onChange, setErr, disabled }) {
    const remove = async () => {
        if (!confirm('Delete this blackout?')) return;
        setErr('');
        try {
            const res = await fetch(`/api/admin/sites/${siteId}/blackouts/${blackout.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            onChange();
        } catch (e) {
            setErr(e.message);
        }
    };

    return (
        <tr>
            <td style={tdStyle}>{new Date(blackout.startsAt).toLocaleString()}</td>
            <td style={tdStyle}>{new Date(blackout.endsAt).toLocaleString()}</td>
            <td style={tdStyle}>{blackout.reason || <span style={{ color: '#999' }}>—</span>}</td>
            <td style={tdStyle}>
                {!disabled && (
                    <button type="button" onClick={remove} style={dangerBtn}>Delete</button>
                )}
            </td>
        </tr>
    );
}
