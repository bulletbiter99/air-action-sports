import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open (out)' },
  { value: 'closed', label: 'Closed (returned)' },
  { value: 'all', label: 'All' },
];

export default function AdminRentalAssignments() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ status: 'open', event_id: '' });
  const [assignments, setAssignments] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events || []);
    }
  }, []);

  const load = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams();
    // Backend defaults to status='open' if absent. Pass explicitly when set so
    // the user-removed-chip case (status='') sends nothing, falling back to default.
    if (filters.status) params.set('status', filters.status);
    if (filters.event_id) params.set('event_id', filters.event_id);
    const res = await fetch(`/api/admin/rentals/assignments?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setAssignments(data.assignments || []);
    }
    setLoadingList(false);
  }, [filters.status, filters.event_id]);

  useEffect(() => { if (isAuthenticated) { loadEvents(); } }, [isAuthenticated, loadEvents]);
  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const markReturned = async (id) => {
    const cond = window.prompt('Condition on return? (good / fair / damaged / lost)', 'good');
    if (!cond) return;
    const c = cond.toLowerCase().trim();
    if (!['good', 'fair', 'damaged', 'lost'].includes(c)) { alert('Invalid condition'); return; }
    const notes = (c === 'damaged' || c === 'lost') ? window.prompt('Damage notes (optional)') || '' : '';
    const res = await fetch(`/api/admin/rentals/assignments/${id}/return`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionOnReturn: c, damageNotes: notes || undefined }),
    });
    if (res.ok) load();
    else alert('Failed to mark returned');
  };

  const filterSchema = useMemo(() => [
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      options: STATUS_OPTIONS,
    },
    {
      key: 'event_id',
      label: 'Event',
      type: 'enum',
      options: events.map((e) => ({ value: e.id, label: e.title })),
    },
  ], [events]);

  if (loading || !isAuthenticated) return null;

  const isFiltered = Boolean(
    (filters.status && filters.status !== 'open') ||
    filters.event_id
  );

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Rental Assignments"
        description="Equipment currently checked out, plus closed/returned history."
        breadcrumb={[
          { label: 'Rentals', to: '/admin/rentals' },
          { label: 'Assignments' },
        ]}
        secondaryActions={<Link to="/admin/rentals" style={navLinkBtn}>← Inventory</Link>}
      />

      <FilterBar
        schema={filterSchema}
        value={filters}
        onChange={setFilters}
        resultCount={assignments.length}
        savedViewsKey="adminRentalAssignments"
      />

      <section style={tableBox}>
        {loadingList && (
          <EmptyState variant="loading" title="Loading assignments…" />
        )}
        {!loadingList && assignments.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No assignments match these filters' : 'No assignments yet'}
            description={isFiltered
              ? 'Try clearing a filter or selecting "All" status.'
              : 'When equipment is assigned to attendees, those rows will appear here.'}
          />
        )}
        {!loadingList && assignments.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Item</th>
                <th style={th}>Player</th>
                <th style={th}>Event</th>
                <th style={th}>Out</th>
                <th style={th}>Returned</th>
                <th style={th}>Condition</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} style={tr}>
                  <td style={td}>
                    <strong>{a.itemName}</strong>
                    <div style={subRowMono}>{a.itemSku} · {a.itemCategory}</div>
                  </td>
                  <td style={td}>{a.attendeeName}</td>
                  <td style={tdSmall}>{a.eventTitle || '—'}</td>
                  <td style={tdSmall}>{new Date(a.checkedOutAt).toLocaleString()}</td>
                  <td style={tdSmall}>
                    {a.checkedInAt
                      ? new Date(a.checkedInAt).toLocaleString()
                      : <span style={stillOut}>— still out</span>}
                  </td>
                  <td style={td}>
                    {a.conditionOnReturn ? <ReturnPill c={a.conditionOnReturn} notes={a.damageNotes} /> : '—'}
                  </td>
                  <td style={td}>
                    {!a.checkedInAt && (
                      <button onClick={() => markReturned(a.id)} style={primaryBtn}>Mark returned</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

function ReturnPill({ c, notes }) {
  // Domain-specific condition colors. Fair/damaged/lost map to status
  // tokens; "good" stays as success.
  const colors = {
    good: 'var(--color-success)',
    fair: 'var(--color-warning)',
    damaged: 'var(--color-danger)',
    lost: 'var(--color-danger)',
  };
  return (
    <div>
      <span style={{ color: colors[c] || 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>{c}</span>
      {notes && <div style={notesText}>{notes}</div>}
    </div>
  );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
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
const td = {
  padding: 'var(--space-8) var(--space-12)',
  color: 'var(--color-text)',
  verticalAlign: 'top',
};
const tdSmall = { ...td, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
const subRowMono = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  fontFamily: 'monospace',
};
const stillOut = { color: 'var(--color-warning)' };
const notesText = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  marginTop: 'var(--space-4)',
};
const primaryBtn = {
  padding: 'var(--space-4) var(--space-12)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const navLinkBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};
