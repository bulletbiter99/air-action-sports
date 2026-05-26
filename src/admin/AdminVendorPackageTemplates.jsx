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

export default function AdminVendorPackageTemplates() {
    const { id } = useParams();
    // B1 ships list view only. Detail/edit lands in B2; the route is
    // pre-registered in App.jsx so the "+ New Template" CTA's navigate
    // target doesn't 404 at the routing layer (the placeholder below
    // surfaces a "Composer coming in B2" message until B2 ships).
    return id ? <DetailPlaceholder id={id} /> : <ListView />;
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

// B1 placeholder for /admin/vendor-package-templates/:id — B2 ships the
// real composer. The route is registered in App.jsx so the "+ New Template"
// navigate doesn't 404 at the router level.
function DetailPlaceholder({ id }) {
    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Template Composer"
                breadcrumb={[
                    { label: 'Settings', to: '/admin/settings' },
                    { label: 'Vendor Templates', to: '/admin/vendor-package-templates' },
                    { label: 'Composer' },
                ]}
            />
            <EmptyState
                title="Composer ships in M6 Batch 2."
                description={`Template ${id} was created; sections + edit UI lands next. Until then, the template is empty and won't appear cleanly in the per-event vendor composer.`}
            />
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
