import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const TARGET_TYPES = ['', 'booking', 'attendee', 'user', 'event', 'ticket_type', 'promo_code', 'invitation', 'rental_item', 'rental_assignment'];

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

  const updateFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setOffset(0); };

  const toggleExpand = (id) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  if (loading || !isAuthenticated) return null;

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <h1 style={h1}>Audit Log</h1>
      <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 16 }}>
        Every admin action that mutates state is recorded here. Use filters to narrow down.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filters.action} onChange={(e) => updateFilter('action', e.target.value)} style={input}>
          <option value="">All actions ({actions.length})</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filters.target_type} onChange={(e) => updateFilter('target_type', e.target.value)} style={input}>
          {TARGET_TYPES.map((t) => <option key={t} value={t}>{t || 'All targets'}</option>)}
        </select>
        <input
          type="search" placeholder="Search target ID or metadata…"
          value={filters.q} onChange={(e) => updateFilter('q', e.target.value)}
          style={{ ...input, flex: 1, minWidth: 200 }}
        />
      </div>

      <section style={tableBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: 'var(--olive-light)', fontSize: 12 }}>
            {total} {total === 1 ? 'entry' : 'entries'} · page {page} of {totalPages}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} style={subtleBtn}>← Prev</button>
            <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total} style={subtleBtn}>Next →</button>
          </div>
        </div>

        {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {!loadingList && entries.length === 0 && (
          <p style={{ color: 'var(--olive-light)' }}>No entries match the current filter.</p>
        )}
        {entries.length > 0 && (
          <table style={table}>
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
          </table>
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
        <td style={{ ...td, fontSize: 11, color: 'var(--olive-light)', whiteSpace: 'nowrap' }}>
          {new Date(e.createdAt).toLocaleString()}
        </td>
        <td style={td}>
          {e.userName
            ? <><strong>{e.userName}</strong><div style={{ fontSize: 10, color: 'var(--olive-light)' }}>{e.userEmail}</div></>
            : <span style={{ color: 'var(--olive-light)' }}>system</span>}
        </td>
        <td style={td}>
          <ActionBadge action={e.action} />
        </td>
        <td style={{ ...td, fontSize: 11, fontFamily: 'monospace' }}>
          {e.targetType && <span style={{ color: 'var(--olive-light)', textTransform: 'uppercase', fontSize: 9, letterSpacing: 1, marginRight: 6 }}>{e.targetType}</span>}
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
          <td colSpan={5} style={{ padding: 0, background: 'rgba(0,0,0,0.2)' }}>
            <pre style={{
              margin: 0, padding: '10px 14px', fontSize: 11,
              color: 'var(--tan-light)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{JSON.stringify(e.meta, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function ActionBadge({ action }) {
  const [category] = action.split('.');
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
  const fg = colors[category] || 'var(--tan-light)';
  return (
    <span style={{ color: fg, fontSize: 12, fontFamily: 'monospace' }}>{action}</span>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: '0 0 0.5rem' };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit' };
const tableBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
