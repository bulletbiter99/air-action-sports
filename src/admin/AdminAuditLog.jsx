import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

const TARGET_TYPE_OPTIONS = [
  { value: 'booking', label: 'Booking' },
  { value: 'attendee', label: 'Attendee' },
  { value: 'user', label: 'User' },
  { value: 'event', label: 'Event' },
  { value: 'ticket_type', label: 'Ticket type' },
  { value: 'promo_code', label: 'Promo code' },
  { value: 'invitation', label: 'Invitation' },
  { value: 'rental_item', label: 'Rental item' },
  { value: 'rental_assignment', label: 'Rental assignment' },
];

export default function AdminAuditLog() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [actions, setActions] = useState([]);
  const [filters, setFilters] = useState({ action: '', target_type: '', q: '' });
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(new Set());
  const limit = 50;

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const loadActions = useCallback(async () => {
    const res = await fetch('/api/admin/audit-log/actions', { credentials: 'include', cache: 'no-store' });
    if (res.ok) setActions((await res.json()).actions || []);
  }, []);

  const load = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams();
    if (filters.action) params.set('action', filters.action);
    if (filters.target_type) params.set('target_type', filters.target_type);
    if (filters.q) params.set('q', filters.q);
    params.set('limit', limit);
    params.set('offset', offset);
    const res = await fetch(`/api/admin/audit-log?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setEntries(d.entries || []);
      setTotal(d.total || 0);
    }
    setLoadingList(false);
  }, [filters, offset]);

  useEffect(() => { if (isAuthenticated) loadActions(); }, [isAuthenticated, loadActions]);
  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const handleFilterChange = (next) => {
    setFilters((prev) => ({ ...prev, ...next }));
    setOffset(0);
  };

  const handleSearchChange = (q) => {
    setFilters((f) => ({ ...f, q }));
    setOffset(0);
  };

  const toggleExpand = (id) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const filterSchema = useMemo(() => [
    {
      key: 'action',
      label: 'Action',
      type: 'enum',
      options: actions.map((a) => ({ value: a, label: a })),
    },
    {
      key: 'target_type',
      label: 'Target',
      type: 'enum',
      options: TARGET_TYPE_OPTIONS,
    },
  ], [actions]);

  if (loading || !isAuthenticated) return null;

  const isFiltered = Boolean(filters.action || filters.target_type || filters.q);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Audit Log"
        description="Every admin action that mutates state is recorded here. Use filters to narrow down."
        breadcrumb={[{ label: 'Settings', to: '/admin/settings' }, { label: 'Audit Log' }]}
      />

      <FilterBar
        schema={filterSchema}
        value={filters}
        onChange={handleFilterChange}
        searchValue={filters.q}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search target ID or metadata…"
        resultCount={total}
        savedViewsKey="adminAuditLog"
      />

      <section style={tableBox}>
        <div style={tableHeader}>
          <div style={paginationLabel}>
            page {page} of {totalPages}
          </div>
          <div style={paginationControls}>
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} style={subtleBtn}>← Prev</button>
            <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total} style={subtleBtn}>Next →</button>
          </div>
        </div>

        {loadingList && (
          <EmptyState variant="loading" title="Loading audit log…" />
        )}
        {!loadingList && entries.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No entries match these filters' : 'No audit entries yet'}
            description={isFiltered
              ? 'Try clearing a filter or expanding the date range.'
              : 'As admins perform actions, they will appear here.'}
          />
        )}
        {!loadingList && entries.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Who</th>
                <th style={th}>Action</th>
                <th style={th}>Target</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <AuditRow
                  key={e.id}
                  entry={e}
                  expanded={expanded.has(e.id)}
                  onToggle={() => toggleExpand(e.id)}
                />
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

function AuditRow({ entry: e, expanded, onToggle }) {
  const hasMeta = e.meta && Object.keys(e.meta).length > 0;
  return (
    <>
      <tr style={tr}>
        <td style={tdTimestamp}>
          {new Date(e.createdAt).toLocaleString()}
        </td>
        <td style={td}>
          {e.userName
            ? <><strong>{e.userName}</strong><div style={subRow}>{e.userEmail}</div></>
            : <span style={mutedText}>system</span>}
        </td>
        <td style={td}>
          <ActionBadge action={e.action} />
        </td>
        <td style={tdTarget}>
          {e.targetType && <span style={targetTypeLabel}>{e.targetType}</span>}
          {e.targetId}
        </td>
        <td style={td}>
          {hasMeta && (
            <button onClick={onToggle} style={subtleBtn}>{expanded ? '▲' : '▼'}</button>
          )}
        </td>
      </tr>
      {expanded && hasMeta && (
        <tr>
          <td colSpan={5} style={metaRow}>
            <pre style={metaPre}>{JSON.stringify(e.meta, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function ActionBadge({ action }) {
  const [category] = action.split('.');
  // Domain-specific badge colors stay raw — the per-category coloring
  // is intentional information density, not a design-token target.
  const colors = {
    booking: '#2ecc71',
    attendee: '#3498db',
    waiver: '#9b59b6',
    rental: '#e67e22',
    rental_item: '#e67e22',
    user: '#d4541a',
    event: '#f39c12',
    ticket_type: '#f39c12',
    promo_code: '#c39bda',
    password_reset: '#95a5a6',
    reminder: '#16a085',
    reminder_1hr: '#16a085',
  };
  const fg = colors[category] || 'var(--color-text-muted)';
  return (
    <span style={{ color: fg, fontSize: 'var(--font-size-sm)', fontFamily: 'monospace' }}>{action}</span>
  );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
const tableBox = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-24)',
  marginTop: 'var(--space-16)',
};
const tableHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 'var(--space-12)',
};
const paginationLabel = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
const paginationControls = { display: 'flex', gap: 'var(--space-8)' };
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
const tdTimestamp = {
  ...td,
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap',
};
const tdTarget = {
  ...td,
  fontSize: 'var(--font-size-xs)',
  fontFamily: 'monospace',
};
const targetTypeLabel = {
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  fontSize: 'var(--font-size-xs)',
  letterSpacing: 'var(--letter-spacing-wide)',
  marginRight: 'var(--space-4)',
};
const subRow = { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
const mutedText = { color: 'var(--color-text-muted)' };
const metaRow = { padding: 0, background: 'var(--color-bg-sunken)' };
const metaPre = {
  margin: 0,
  padding: 'var(--space-8) var(--space-12)',
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
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
};
