import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminRentalAssignments() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [status, setStatus] = useState('open');
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
    params.set('status', status);
    if (eventId) params.set('event_id', eventId);
    const res = await fetch(`/api/admin/rentals/assignments?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setAssignments(data.assignments || []);
    }
    setLoadingList(false);
  }, [status, eventId]);

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

  if (loading || !isAuthenticated) return null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={h1}>Rental Assignments</h1>
        <Link to="/admin/rentals" style={navLinkBtn}>← Inventory</Link>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={input}>
          <option value="open">Open (out)</option>
          <option value="closed">Closed (returned)</option>
          <option value="all">All</option>
        </select>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ ...input, minWidth: 260 }}>
          <option value="">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      </div>

      <section style={tableBox}>
        {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {!loadingList && assignments.length === 0 && (
          <p style={{ color: 'var(--olive-light)' }}>No assignments match.</p>
        )}
        {assignments.length > 0 && (
          <table style={table}>
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
                    <div style={{ fontSize: 10, color: 'var(--olive-light)', fontFamily: 'monospace' }}>{a.itemSku} · {a.itemCategory}</div>
                  </td>
                  <td style={td}>{a.attendeeName}</td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--tan-light)' }}>{a.eventTitle || '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{new Date(a.checkedOutAt).toLocaleString()}</td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {a.checkedInAt ? new Date(a.checkedInAt).toLocaleString() : <span style={{ color: '#e67e22' }}>— still out</span>}
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
          </table>
        )}
      </section>
    </div>
  );
}

function ReturnPill({ c, notes }) {
  const colors = { good: '#2ecc71', fair: '#f39c12', damaged: '#e74c3c', lost: '#c0392b' };
  return (
    <div>
      <span style={{ color: colors[c] || 'var(--cream)', fontSize: 12 }}>{c}</span>
      {notes && <div style={{ fontSize: 11, color: 'var(--olive-light)', marginTop: 2 }}>{notes}</div>}
    </div>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit' };
const tableBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const primaryBtn = { padding: '6px 14px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const navLinkBtn = { padding: '10px 18px', background: 'transparent', border: '1px solid var(--olive-light)', color: 'var(--tan-light)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' };
