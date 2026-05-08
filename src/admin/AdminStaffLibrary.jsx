// M5 Batch 5 — Staff document library page (Surface 4a part 3).
//
// List of versioned JD/SOP/Checklist/Policy/Training docs. Filter by
// kind. Click into a doc opens AdminStaffDocumentEditor (preview +
// new-version flow).

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const KINDS = [
    { value: '',          label: 'All' },
    { value: 'jd',        label: 'Job Descriptions' },
    { value: 'sop',       label: 'SOPs' },
    { value: 'checklist', label: 'Checklists' },
    { value: 'policy',    label: 'Policies' },
    { value: 'training',  label: 'Training' },
];

export default function AdminStaffLibrary() {
    const { isAuthenticated, hasRole } = useAdmin();
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [kindFilter, setKindFilter] = useState('');
    const [includeRetired, setIncludeRetired] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (kindFilter) params.set('kind', kindFilter);
            if (includeRetired) params.set('include_retired', '1');
            const res = await fetch(`/api/admin/staff-documents?${params}`, { credentials: 'include', cache: 'no-store' });
            if (res.ok) setDocs((await res.json()).documents || []);
        } finally {
            setLoading(false);
        }
    }, [kindFilter, includeRetired]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    if (!isAuthenticated) return null;

    return (
        <div style={page}>
            <header style={header}>
                <h1 style={h1}>Staff Document Library</h1>
                {hasRole?.('manager') && (
                    <Link to="/admin/staff/library/new" style={cta}>+ New Document</Link>
                )}
            </header>

            <div style={filterRow}>
                <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={select}>
                    {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <label style={checkLabel}>
                    <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
                    Include retired
                </label>
            </div>

            <div style={tableBox}>
                <table style={table}>
                    <thead>
                        <tr>
                            <th style={th}>Kind</th>
                            <th style={th}>Title</th>
                            <th style={th}>Version</th>
                            <th style={th}>Slug</th>
                            <th style={th}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && <tr><td colSpan={5} style={loadingCell}>Loading…</td></tr>}
                        {!loading && docs.length === 0 && <tr><td colSpan={5} style={emptyCell}>No documents in library yet.</td></tr>}
                        {!loading && docs.map((d) => (
                            <tr key={d.id} style={tr}>
                                <td style={td}><span style={kindPill}>{d.kind.toUpperCase()}</span></td>
                                <td style={td}><Link to={`/admin/staff/library/${d.id}`} style={titleLink}>{d.title}</Link></td>
                                <td style={td}>{d.version}</td>
                                <td style={td}><code style={codeText}>{d.slug}</code></td>
                                <td style={td}>{d.retiredAt ? <span style={retiredPill}>Retired</span> : <span style={livePill}>Live</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const page = { maxWidth: 1200, margin: '0 auto', padding: '2rem' };
const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 };
const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const cta = { padding: '10px 20px', background: 'var(--orange)', color: 'white', textDecoration: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', borderRadius: 4 };
const filterRow = { display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 };
const select = { padding: '8px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13 };
const checkLabel = { display: 'flex', gap: 6, alignItems: 'center', color: 'var(--tan-light)', fontSize: 12 };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: '10px 12px', fontSize: 13, color: 'var(--cream)', verticalAlign: 'middle' };
const loadingCell = { padding: 20, textAlign: 'center', color: 'var(--olive-light)', fontStyle: 'italic' };
const emptyCell = { padding: 20, textAlign: 'center', color: 'var(--olive-light)' };
const kindPill = { padding: '2px 8px', background: 'var(--color-accent-soft)', color: 'var(--orange)', fontSize: 9, fontWeight: 800, letterSpacing: 1, borderRadius: 3 };
const titleLink = { color: 'var(--cream)', textDecoration: 'none', fontWeight: 600 };
const codeText = { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--tan-light)' };
const livePill = { padding: '2px 8px', background: 'var(--color-success-soft)', color: 'var(--color-success)', fontSize: 9, fontWeight: 700, borderRadius: 3 };
const retiredPill = { padding: '2px 8px', background: 'var(--color-bg-sunken)', color: 'var(--color-text-subtle)', fontSize: 9, fontWeight: 700, borderRadius: 3 };
