// M5 Batch 4 — Staff directory list page (Surface 4a part 1).
//
// Mirrors the AdminCustomers list pattern from M3 — search, status filter,
// pagination. PII (email, phone) renders masked unless the viewer has
// staff.read.pii (gated server-side; the response indicates viewerCanSeePii).

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import FilterBar from '../components/admin/FilterBar.jsx';

const STATUS_OPTIONS = [
    { value: 'active',      label: 'Active' },
    { value: 'onboarding',  label: 'Onboarding' },
    { value: 'on_leave',    label: 'On leave' },
    { value: 'offboarding', label: 'Offboarding' },
    { value: 'inactive',    label: 'Inactive' },
    { value: 'archived',    label: 'Archived' },
    { value: 'all',         label: 'All' },
];

const TIER_OPTIONS = [
    { value: '1', label: 'Tier 1 — Primary admin' },
    { value: '2', label: 'Tier 2 — Operational specialist' },
    { value: '3', label: 'Tier 3 — Event-day field' },
    { value: '4', label: 'Tier 4 — Occasional' },
];

const FILTER_SCHEMA = [
    { key: 'status', label: 'Status', type: 'enum', options: STATUS_OPTIONS },
    { key: 'tier',   label: 'Tier',   type: 'enum', options: TIER_OPTIONS },
];

const PAGE_SIZE = 50;

export default function AdminStaff() {
    const { isAuthenticated, hasRole } = useAdmin();

    const [filters, setFilters] = useState({});
    const [search, setSearch] = useState('');
    const [persons, setPersons] = useState([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [viewerCanSeePii, setViewerCanSeePii] = useState(false);

    useEffect(() => { setOffset(0); }, [filters, search]);

    const queryParams = useMemo(() => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(filters)) {
            if (v) params.set(k, String(v));
        }
        if (search) params.set('q', search);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));
        return params;
    }, [filters, search, offset]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/staff?${queryParams}`, { credentials: 'include', cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                setPersons(data.persons || []);
                setTotal(data.total || 0);
                setViewerCanSeePii(Boolean(data.viewerCanSeePii));
            } else if (res.status === 403) {
                setPersons([]);
                setTotal(0);
            }
        } finally {
            setLoading(false);
        }
    }, [queryParams]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    if (!isAuthenticated) return null;

    return (
        <div style={page}>
            <header style={header}>
                <h1 style={h1}>Staff</h1>
                {hasRole?.('manager') && (
                    <Link to="/admin/staff/new" style={cta}>+ New Person</Link>
                )}
            </header>

            <FilterBar
                schema={FILTER_SCHEMA}
                value={filters}
                onChange={setFilters}
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search name or email…"
                resultCount={total}
                savedViewsKey="adminStaff"
            />

            <div style={tableBox}>
                <table style={table}>
                    <thead>
                        <tr>
                            <th style={th}>Name</th>
                            <th style={th}>Email</th>
                            <th style={th}>Phone</th>
                            <th style={th}>Status</th>
                            <th style={th}>Created</th>
                            <th style={th}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={6} style={loadingCell}>Loading…</td></tr>
                        )}
                        {!loading && persons.length === 0 && (
                            <tr><td colSpan={6} style={emptyCell}>No staff match the current filter.</td></tr>
                        )}
                        {!loading && persons.map((p) => (
                            <tr key={p.id} style={tr}>
                                <td style={td}><strong>{p.fullName || p.preferredName || '—'}</strong></td>
                                <td style={td}>{p.email || '—'}{!viewerCanSeePii && p.email ? <span style={maskHint}> (masked)</span> : null}</td>
                                <td style={td}>{p.phone || '—'}</td>
                                <td style={td}>
                                    <span style={{ ...statusBase, ...(STATUS_STYLES[p.archivedAt ? 'archived' : p.status] || STATUS_STYLES.active) }}>
                                        {p.archivedAt ? 'archived' : p.status}
                                    </span>
                                </td>
                                <td style={td}>{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</td>
                                <td style={td}>
                                    <Link to={`/admin/staff/${p.id}`} style={viewBtn}>View</Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {total > PAGE_SIZE && (
                <div style={pagination}>
                    <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} style={pagBtn}>← Prev</button>
                    <span style={pageInfo}>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
                    <button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} style={pagBtn}>Next →</button>
                </div>
            )}
        </div>
    );
}

const page = { maxWidth: 1200, margin: '0 auto', padding: '2rem' };
const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 };
const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const cta = { padding: '10px 20px', background: 'var(--orange)', color: 'white', textDecoration: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', borderRadius: 4 };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', marginTop: 16 };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', fontSize: 13, color: 'var(--cream)', verticalAlign: 'middle' };
const loadingCell = { padding: 20, textAlign: 'center', color: 'var(--olive-light)', fontStyle: 'italic' };
const emptyCell = { padding: 20, textAlign: 'center', color: 'var(--olive-light)' };
const viewBtn = { padding: '4px 10px', background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--tan)', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none' };
const statusBase = { display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' };
const STATUS_STYLES = {
    active:      { background: 'var(--color-success-soft)', color: 'var(--color-success)' },
    onboarding:  { background: 'var(--color-info-soft)',    color: 'var(--color-info)' },
    on_leave:    { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' },
    offboarding: { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' },
    inactive:    { background: 'var(--color-bg-sunken)',    color: 'var(--color-text-subtle)' },
    archived:    { background: 'var(--color-bg-sunken)',    color: 'var(--color-text-subtle)' },
};
const maskHint = { color: 'var(--color-text-subtle)', fontSize: 10, fontStyle: 'italic' };
const pagination = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 };
const pagBtn = { padding: '6px 16px', background: 'transparent', color: 'var(--tan-light)', border: '1px solid var(--color-border-strong)', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const pageInfo = { color: 'var(--olive-light)', fontSize: 12 };
