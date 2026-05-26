// M6 Batch 1 — Vendor package templates library (list view).
//
// Manages the reusable starter templates in vendor_package_templates
// (schema from migration 0012). The composer (clone-a-template into a
// per-event-vendor package) lives at /admin/vendor-packages — this page
// is the library admin, replacing the "edit via SQL" workaround flagged
// in docs/audit/07-admin-surface-map.md line 38 + line 55.
//
// B1 ships: list + search + filter + soft-delete + minimal "+ New Template"
// modal that creates an empty draft and routes to /:id (B2's detail view).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

const FILTER_SCHEMA = [
    {
        key: 'includeDeleted',
        label: 'Show archived',
        type: 'enum',
        options: [{ value: '1', label: 'Yes' }],
    },
];

// Section kinds align with the CHECK constraint on
// vendor_package_sections.kind (migration 0010). The template editor
// constrains kind to this set so a template is always cloneable into
// per-event-vendor sections without a CHECK violation.
const SECTION_KINDS = [
    { value: 'overview', label: 'Overview' },
    { value: 'schedule', label: 'Schedule' },
    { value: 'map', label: 'Map' },
    { value: 'contact', label: 'Contact' },
    { value: 'custom', label: 'Custom' },
];

export default function AdminVendorPackageTemplates() {
    const { id } = useParams();
    return id ? <Detail id={id} /> : <ListView />;
}

function ListView() {
    const { isAuthenticated, loading, hasRole } = useAdmin();
    const navigate = useNavigate();

    const [rows, setRows] = useState([]);
    const [filters, setFilters] = useState({ q: '', includeDeleted: '' });
    const [loadingList, setLoadingList] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createForm, setCreateForm] = useState({ name: '', description: '' });
    const [submitting, setSubmitting] = useState(false);
    const [createError, setCreateError] = useState(null);

    // Browser-tab title (M6 B0 labeling pattern).
    useEffect(() => {
        const prev = document.title;
        document.title = 'Vendor Templates — Air Action Sports';
        return () => { document.title = prev; };
    }, []);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const load = useCallback(async () => {
        setLoadingList(true);
        const params = new URLSearchParams();
        if (filters.q.trim()) params.set('q', filters.q.trim());
        if (filters.includeDeleted) params.set('include_deleted', '1');
        const res = await fetch(`/api/admin/vendor-package-templates?${params}`, {
            credentials: 'include',
            cache: 'no-store',
        });
        if (res.ok) setRows((await res.json()).templates || []);
        setLoadingList(false);
    }, [filters.q, filters.includeDeleted]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    const createTemplate = async (e) => {
        e?.preventDefault?.();
        setCreateError(null);
        const name = createForm.name.trim();
        if (!name) { setCreateError('Name is required.'); return; }

        setSubmitting(true);
        try {
            const res = await fetch('/api/admin/vendor-package-templates', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    description: createForm.description.trim() || null,
                    sections: [],
                    requiresSignature: false,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setCreateError(data.error || `Request failed (${res.status})`);
                return;
            }
            // Close modal, refresh list, then jump to detail (B2 will render
            // the composer; for now /:id shows a placeholder).
            setCreating(false);
            setCreateForm({ name: '', description: '' });
            await load();
            navigate(`/admin/vendor-package-templates/${data.template.id}`);
        } finally {
            setSubmitting(false);
        }
    };

    const archive = async (t) => {
        if (!hasRole('manager')) { alert('Manager role or above required to archive templates.'); return; }
        if (!window.confirm(`Archive "${t.name}"? Past per-event-vendor packages that were cloned from this template stay intact; only new clones are blocked.`)) return;
        const res = await fetch(`/api/admin/vendor-package-templates/${t.id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (res.ok) load();
        else {
            const d = await res.json().catch(() => ({}));
            alert(d.error || `Archive failed (${res.status})`);
        }
    };

    if (loading || !isAuthenticated) return null;

    const isFiltered = Boolean(filters.q || filters.includeDeleted);

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Vendor Templates"
                description="Reusable starter packages cloned into per-event-vendor packages from /admin/vendor-packages. Edit a template here and existing event-vendor packages keep their original snapshot — only new clones inherit the changes."
                breadcrumb={[{ label: 'Settings', to: '/admin/settings' }, { label: 'Vendor Templates' }]}
                secondaryActions={
                    <Link to="/admin/vendor-packages" style={subtleBtn}>Per-event packages →</Link>
                }
                primaryAction={hasRole('manager') && (
                    <button onClick={() => setCreating(true)} style={primaryBtn}>+ New Template</button>
                )}
            />

            <FilterBar
                schema={FILTER_SCHEMA}
                value={filters}
                onChange={setFilters}
                searchValue={filters.q}
                onSearchChange={(q) => setFilters((f) => ({ ...f, q }))}
                searchPlaceholder="Search by name or description…"
                resultCount={rows.length}
                savedViewsKey="adminVendorPackageTemplates"
            />

            {loadingList ? (
                <EmptyState variant="loading" title="Loading templates…" />
            ) : rows.length === 0 ? (
                <EmptyState
                    variant={isFiltered ? 'filter' : 'empty'}
                    title={isFiltered ? 'No templates match your filters.' : 'No templates yet.'}
                    description={
                        isFiltered
                            ? 'Try clearing search or showing archived templates.'
                            : 'Create a starter template — e.g. "Food Truck Package" or "Medic Package" — to speed up per-event vendor onboarding.'
                    }
                />
            ) : (
                <div style={tableWrap}>
                    <table style={table}>
                        <thead>
                            <tr style={tableHead}>
                                <th style={th}>Name</th>
                                <th style={th}>Description</th>
                                <th style={th}>Sections</th>
                                <th style={th}>Signature?</th>
                                <th style={th}>Status</th>
                                <th style={thRight}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((t) => (
                                <tr key={t.id} style={tableRow}>
                                    <td style={td}>
                                        <Link to={`/admin/vendor-package-templates/${t.id}`} style={rowLink}>
                                            <strong>{t.name}</strong>
                                        </Link>
                                    </td>
                                    <td style={tdMuted}>{t.description || <em style={emMuted}>(none)</em>}</td>
                                    <td style={td}>{t.sectionsCount}</td>
                                    <td style={td}>{t.requiresSignature ? 'Yes' : 'No'}</td>
                                    <td style={td}>
                                        {t.deletedAt
                                            ? <span style={archivedPill}>Archived</span>
                                            : <span style={activePill}>Active</span>}
                                    </td>
                                    <td style={tdRight}>
                                        {!t.deletedAt && hasRole('manager') && (
                                            <button onClick={() => archive(t)} style={dangerBtnSmall}>Archive</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {creating && (
                <div style={modalBackdrop} onClick={() => setCreating(false)}>
                    <form onClick={(e) => e.stopPropagation()} onSubmit={createTemplate} style={modal}>
                        <h2 style={modalTitle}>New Vendor Template</h2>
                        <p style={modalHint}>You'll be able to edit sections after creating the template (composer ships in M6 Batch 2).</p>

                        {createError && <div style={errorBox}>{createError}</div>}

                        <label style={lblBlock}>
                            Name <span style={req}>*</span>
                            <input
                                type="text"
                                value={createForm.name}
                                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                                style={input}
                                autoFocus
                                required
                                maxLength={200}
                                placeholder="e.g. Food Truck Package"
                            />
                        </label>

                        <label style={lblBlock}>
                            Description
                            <textarea
                                value={createForm.description}
                                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                                rows={3}
                                style={input}
                                maxLength={2000}
                                placeholder="What this template is for, what sections it'll typically include."
                            />
                        </label>

                        <div style={modalActions}>
                            <button type="button" onClick={() => setCreating(false)} style={cancelBtn}>Cancel</button>
                            <button type="submit" disabled={submitting || !createForm.name.trim()} style={primaryBtn}>
                                {submitting ? 'Creating…' : 'Create template'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

// M6 Batch 2 — Template detail/edit composer with sections editor +
// clone-to-event flow.
function Detail({ id }) {
    const { isAuthenticated, loading, hasRole } = useAdmin();
    const navigate = useNavigate();
    const [template, setTemplate] = useState(null);
    const [loadingDetail, setLoadingDetail] = useState(true);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(false);
    const [cloning, setCloning] = useState(false);

    useEffect(() => {
        const prev = document.title;
        document.title = 'Vendor Template — Air Action Sports';
        return () => { document.title = prev; };
    }, []);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const load = useCallback(async () => {
        setLoadingDetail(true);
        setError(null);
        const res = await fetch(`/api/admin/vendor-package-templates/${id}`, {
            credentials: 'include',
            cache: 'no-store',
        });
        if (res.ok) {
            const data = await res.json();
            setTemplate(data.template);
        } else if (res.status === 404) {
            setError('Template not found.');
        } else {
            const d = await res.json().catch(() => ({}));
            setError(d.error || `Failed to load (${res.status})`);
        }
        setLoadingDetail(false);
    }, [id]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    if (loading || !isAuthenticated || loadingDetail) {
        return <div style={pageWrap}><EmptyState variant="loading" title="Loading template…" /></div>;
    }

    if (error) {
        return (
            <div style={pageWrap}>
                <AdminPageHeader
                    title="Template Not Found"
                    breadcrumb={[
                        { label: 'Settings', to: '/admin/settings' },
                        { label: 'Vendor Templates', to: '/admin/vendor-package-templates' },
                    ]}
                />
                <EmptyState title={error} />
            </div>
        );
    }

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title={template?.name || 'Template'}
                breadcrumb={[
                    { label: 'Settings', to: '/admin/settings' },
                    { label: 'Vendor Templates', to: '/admin/vendor-package-templates' },
                    { label: template?.name || 'Template' },
                ]}
                secondaryActions={
                    template?.deletedAt ? <span style={archivedPill}>Archived</span> : null
                }
                primaryAction={hasRole('manager') && !template?.deletedAt && !editing && (
                    <>
                        <button onClick={() => setCloning(true)} style={subtleBtn}>Use for event…</button>
                        <button onClick={() => setEditing(true)} style={primaryBtn}>Edit</button>
                    </>
                )}
            />

            {editing ? (
                <EditForm
                    template={template}
                    onCancel={() => setEditing(false)}
                    onSaved={(updated) => { setTemplate(updated); setEditing(false); }}
                />
            ) : (
                <ViewMode template={template} />
            )}

            {cloning && (
                <CloneModal
                    template={template}
                    onClose={() => setCloning(false)}
                    onCloned={(eventVendorId) => {
                        setCloning(false);
                        navigate(`/admin/vendor-packages/${eventVendorId}`);
                    }}
                />
            )}
        </div>
    );
}

function ViewMode({ template }) {
    return (
        <div>
            <section style={detailSection}>
                <div style={detailRow}>
                    <span style={detailLabel}>Description</span>
                    <span style={detailValue}>
                        {template?.description || <em style={emMuted}>(none)</em>}
                    </span>
                </div>
                <div style={detailRow}>
                    <span style={detailLabel}>Requires signature</span>
                    <span style={detailValue}>{template?.requiresSignature ? 'Yes' : 'No'}</span>
                </div>
                <div style={detailRow}>
                    <span style={detailLabel}>Sections</span>
                    <span style={detailValue}>{template?.sections?.length || 0}</span>
                </div>
            </section>

            <h3 style={sectionsHeading}>Sections</h3>
            {(!template?.sections || template.sections.length === 0) ? (
                <EmptyState title="No sections yet." description="Click Edit to add sections to this template." />
            ) : (
                <div style={sectionsList}>
                    {template.sections.map((s, idx) => (
                        <div key={idx} style={sectionCard}>
                            <div style={sectionCardHeader}>
                                <span style={kindPill}>{s.kind}</span>
                                <strong>{s.title}</strong>
                            </div>
                            {s.body_html && (
                                <div style={sectionPreview} dangerouslySetInnerHTML={{ __html: s.body_html }} />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function EditForm({ template, onCancel, onSaved }) {
    const [name, setName] = useState(template?.name || '');
    const [description, setDescription] = useState(template?.description || '');
    const [requiresSignature, setRequiresSignature] = useState(!!template?.requiresSignature);
    const [sections, setSections] = useState(() => (template?.sections || []).map((s) => ({ ...s })));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const updateSection = (idx, patch) => {
        setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    };
    const addSection = () => {
        setSections((prev) => [
            ...prev,
            { kind: 'custom', title: '', body_html: '', sort_order: prev.length },
        ]);
    };
    const removeSection = (idx) => {
        setSections((prev) => prev.filter((_, i) => i !== idx));
    };
    const moveSection = (idx, direction) => {
        setSections((prev) => {
            const next = [...prev];
            const target = idx + direction;
            if (target < 0 || target >= next.length) return next;
            [next[idx], next[target]] = [next[target], next[idx]];
            // Re-normalize sort_order to match new array position.
            return next.map((s, i) => ({ ...s, sort_order: i }));
        });
    };

    const save = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/vendor-package-templates/${template.id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim() || null,
                    requiresSignature,
                    sections,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || `Save failed (${res.status})`);
                return;
            }
            onSaved(data.template);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            {error && <div style={errorBox}>{error}</div>}

            <section style={detailSection}>
                <label style={lblBlock}>
                    Name <span style={req}>*</span>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={input}
                        required
                        maxLength={200}
                    />
                </label>

                <label style={lblBlock}>
                    Description
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        style={input}
                        maxLength={2000}
                    />
                </label>

                <label style={inlineCheckbox}>
                    <input
                        type="checkbox"
                        checked={requiresSignature}
                        onChange={(e) => setRequiresSignature(e.target.checked)}
                    />
                    Requires signature
                </label>
            </section>

            <h3 style={sectionsHeading}>Sections ({sections.length})</h3>
            {sections.map((s, idx) => (
                <div key={idx} style={sectionEditCard}>
                    <div style={sectionEditHeader}>
                        <select
                            value={s.kind}
                            onChange={(e) => updateSection(idx, { kind: e.target.value })}
                            style={kindSelect}
                        >
                            {SECTION_KINDS.map((k) => (
                                <option key={k.value} value={k.value}>{k.label}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            value={s.title}
                            onChange={(e) => updateSection(idx, { title: e.target.value })}
                            placeholder="Section title"
                            style={{ ...input, marginTop: 0, flex: 1 }}
                            maxLength={200}
                        />
                        <button type="button" onClick={() => moveSection(idx, -1)} style={ghostBtn} disabled={idx === 0}>↑</button>
                        <button type="button" onClick={() => moveSection(idx, 1)} style={ghostBtn} disabled={idx === sections.length - 1}>↓</button>
                        <button type="button" onClick={() => removeSection(idx)} style={dangerBtnSmall}>Remove</button>
                    </div>
                    <textarea
                        value={s.body_html || ''}
                        onChange={(e) => updateSection(idx, { body_html: e.target.value })}
                        rows={4}
                        style={input}
                        placeholder="Body HTML (will be sanitized at clone time on the per-event side)"
                    />
                </div>
            ))}
            <button type="button" onClick={addSection} style={subtleBtn}>+ Add section</button>

            <div style={actions}>
                <button type="button" onClick={onCancel} style={cancelBtn}>Cancel</button>
                <button type="button" onClick={save} disabled={submitting || !name.trim()} style={primaryBtn}>
                    {submitting ? 'Saving…' : 'Save changes'}
                </button>
            </div>
        </div>
    );
}

function CloneModal({ template, onClose, onCloned }) {
    const [events, setEvents] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [eventId, setEventId] = useState('');
    const [vendorId, setVendorId] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [duplicateLink, setDuplicateLink] = useState(null);

    useEffect(() => {
        (async () => {
            const [e, v] = await Promise.all([
                fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).catch(() => ({ events: [] })),
                fetch('/api/admin/vendors', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).catch(() => ({ vendors: [] })),
            ]);
            setEvents(e.events || []);
            setVendors((v.vendors || []).filter((vendor) => !vendor.deletedAt));
        })();
    }, []);

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        setDuplicateLink(null);
        try {
            const res = await fetch(`/api/admin/vendor-package-templates/${template.id}/clone-to-event`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId, vendorId }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 409 && data.eventVendorId) {
                setDuplicateLink(data.eventVendorId);
                setError(data.error || 'Already attached');
                return;
            }
            if (!res.ok) {
                setError(data.error || `Clone failed (${res.status})`);
                return;
            }
            onCloned(data.eventVendorId);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={modalBackdrop} onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} style={modal}>
                <h2 style={modalTitle}>Use this template for an event</h2>
                <p style={modalHint}>
                    Clones <strong>{template?.name}</strong> ({template?.sections?.length || 0} sections) into a new per-event-vendor package. You'll be redirected to the composer to finish setup.
                </p>

                {error && (
                    <div style={errorBox}>
                        {error}
                        {duplicateLink && (
                            <>
                                {' '}
                                <Link to={`/admin/vendor-packages/${duplicateLink}`} style={{ color: '#ff8a7e', textDecoration: 'underline' }}>
                                    Open existing →
                                </Link>
                            </>
                        )}
                    </div>
                )}

                <label style={lblBlock}>
                    Event <span style={req}>*</span>
                    <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={input}>
                        <option value="">— pick an event —</option>
                        {events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                                {ev.title} {ev.dateIso ? `· ${ev.dateIso.slice(0, 10)}` : ''}
                            </option>
                        ))}
                    </select>
                </label>

                <label style={lblBlock}>
                    Vendor <span style={req}>*</span>
                    <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={input}>
                        <option value="">— pick a vendor —</option>
                        {vendors.map((v) => (
                            <option key={v.id} value={v.id}>{v.companyName}</option>
                        ))}
                    </select>
                </label>

                <div style={modalActions}>
                    <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
                    <button type="button" onClick={submit} disabled={submitting || !eventId || !vendorId} style={primaryBtn}>
                        {submitting ? 'Cloning…' : 'Clone & open composer'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Styling — minimal, mirrors AdminVendors patterns.
const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: '2rem' };
const primaryBtn = { background: 'var(--orange)', color: '#fff', border: 0, padding: '10px 20px', fontSize: 13, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', padding: '8px 16px', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const dangerBtnSmall = { background: 'transparent', border: '1px solid rgba(231,76,60,0.4)', color: '#ff8a7e', padding: '4px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const tableWrap = { overflowX: 'auto', background: 'var(--mid)', border: '1px solid var(--color-border)', marginTop: 'var(--space-16)' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const tableHead = { background: 'rgba(200,184,154,0.05)' };
const th = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--tan-light)', borderBottom: '1px solid var(--color-border)' };
const thRight = { ...th, textAlign: 'right' };
const tableRow = { borderBottom: '1px solid rgba(200,184,154,0.08)' };
const td = { padding: '12px 16px', color: 'var(--cream)', verticalAlign: 'middle' };
const tdMuted = { ...td, color: 'var(--color-text-muted)' };
const tdRight = { ...td, textAlign: 'right' };
const rowLink = { color: 'var(--cream)', textDecoration: 'none' };
const emMuted = { color: 'var(--color-text-muted)' };
const activePill = { display: 'inline-block', background: 'rgba(46,204,113,0.15)', color: '#2ecc71', padding: '2px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' };
const archivedPill = { display: 'inline-block', background: 'rgba(200,184,154,0.1)', color: 'var(--color-text-muted)', padding: '2px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' };
const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '2rem' };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '2rem', maxWidth: 520, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 };
const modalTitle = { fontSize: 20, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.5px', color: 'var(--cream)', margin: 0 };
const modalHint = { fontSize: 13, color: 'var(--color-text-muted)', margin: 0 };
const modalActions = { display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 };
const cancelBtn = { background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', padding: '10px 20px', fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const lblBlock = { display: 'block', fontSize: 12, color: 'var(--tan-light)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 };
const input = { width: '100%', padding: '10px 12px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginTop: 4, resize: 'vertical' };
const req = { color: 'var(--orange)' };
const errorBox = { background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#ff8a7e', padding: 12, fontSize: 13 };

// Detail / Edit-mode styles (M6 B2)
const detailSection = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 14, marginTop: 'var(--space-16)' };
const detailRow = { display: 'flex', gap: 16, alignItems: 'flex-start' };
const detailLabel = { minWidth: 160, fontSize: 12, color: 'var(--tan-light)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 };
const detailValue = { color: 'var(--cream)', fontSize: 14, flex: 1 };
const sectionsHeading = { fontSize: 14, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--tan-light)', marginTop: 'var(--space-24)' };
const sectionsList = { display: 'flex', flexDirection: 'column', gap: 12 };
const sectionCard = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1rem 1.25rem' };
const sectionCardHeader = { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 };
const kindPill = { display: 'inline-block', background: 'rgba(212,84,26,0.15)', color: 'var(--orange)', padding: '2px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' };
const sectionPreview = { color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.5, marginTop: 4 };
const sectionEditCard = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1rem 1.25rem', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 };
const sectionEditHeader = { display: 'flex', gap: 8, alignItems: 'center' };
const kindSelect = { padding: '8px 10px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, minWidth: 120 };
const inlineCheckbox = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--cream)', cursor: 'pointer' };
const ghostBtn = { background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', minWidth: 32 };
const actions = { display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 'var(--space-24)' };
