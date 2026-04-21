import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminRoster() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [roster, setRoster] = useState(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | signed | unsigned | checked-in

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setEvents(data.events || []);
    if (data.events?.length && !eventId) setEventId(data.events[0].id);
  }, [eventId]);

  const loadRoster = useCallback(async () => {
    if (!eventId) return;
    setLoadingRoster(true);
    const res = await fetch(`/api/admin/events/${eventId}/roster`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) setRoster(await res.json());
    setLoadingRoster(false);
  }, [eventId]);

  useEffect(() => { if (isAuthenticated) loadEvents(); }, [isAuthenticated, loadEvents]);
  useEffect(() => { if (eventId) loadRoster(); }, [eventId, loadRoster]);

  const filtered = useMemo(() => {
    if (!roster?.attendees) return [];
    const q = search.trim().toLowerCase();
    return roster.attendees.filter((a) => {
      if (filter === 'signed' && !a.waiverSigned) return false;
      if (filter === 'unsigned' && a.waiverSigned) return false;
      if (filter === 'checked-in' && !a.checkedInAt) return false;
      if (q) {
        const hay = `${a.firstName} ${a.lastName || ''} ${a.email || ''} ${a.buyerName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [roster, search, filter]);

  const stats = useMemo(() => {
    if (!roster?.attendees) return null;
    const total = roster.attendees.length;
    const signed = roster.attendees.filter((a) => a.waiverSigned).length;
    const checked = roster.attendees.filter((a) => a.checkedInAt).length;
    const comp = roster.attendees.filter((a) => a.bookingStatus === 'comp').length;
    return { total, signed, checked, comp };
  }, [roster]);

  const downloadCsv = () => {
    if (!eventId) return;
    window.location.href = `/api/admin/events/${eventId}/roster.csv`;
  };

  const checkIn = async (attendeeId) => {
    const res = await fetch(`/api/admin/attendees/${attendeeId}/check-in`, {
      method: 'POST', credentials: 'include',
    });
    if (res.ok) loadRoster();
  };

  const checkOut = async (attendeeId) => {
    if (!window.confirm('Undo check-in for this player?')) return;
    const res = await fetch(`/api/admin/attendees/${attendeeId}/check-out`, {
      method: 'POST', credentials: 'include',
    });
    if (res.ok) loadRoster();
  };

  const sendWaiver = async (attendeeId) => {
    const res = await fetch(`/api/admin/attendees/${attendeeId}/send-waiver`, {
      method: 'POST', credentials: 'include',
    });
    if (res.ok) {
      const d = await res.json();
      alert(`Waiver email sent to ${d.sentTo}`);
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Send failed');
    }
  };

  if (loading || !isAuthenticated) return null;

  const customQuestions = roster?.event?.customQuestions || [];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <h1 style={h1}>Event Roster</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={input}>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.title} — {ev.displayDate} ({ev.attendeesCount || 0} players)
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search name, email, buyer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...input, flex: 1, minWidth: 200 }}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={input}>
          <option value="all">All players</option>
          <option value="signed">Waiver signed</option>
          <option value="unsigned">Waiver pending</option>
          <option value="checked-in">Checked in</option>
        </select>
        <button onClick={downloadCsv} style={csvBtn} disabled={!eventId}>
          ▼ CSV
        </button>
      </div>

      {stats && (
        <div style={statsGrid}>
          <Stat label="Players" value={stats.total} />
          <Stat label="Waiver signed" value={`${stats.signed} / ${stats.total}`} sub={stats.total === 0 ? '—' : `${Math.round(stats.signed / stats.total * 100)}%`} />
          <Stat label="Checked in" value={stats.checked} />
          <Stat label="Comp" value={stats.comp} />
        </div>
      )}

      <section style={tableBox}>
        {loadingRoster && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {!loadingRoster && filtered.length === 0 && (
          <p style={{ color: 'var(--olive-light)' }}>No players match the current filter.</p>
        )}
        {filtered.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Phone</th>
                <th style={th}>Ticket</th>
                <th style={th}>Waiver</th>
                <th style={th}>Check-in</th>
                <th style={th}>Booking</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => (
                <tr key={a.id} style={tr}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}>
                    <strong>{a.firstName} {a.lastName || ''}</strong>
                    {a.isMinor && <span style={{ marginLeft: 6, fontSize: 10, color: '#e67e22', fontWeight: 700 }}>MINOR</span>}
                    {customQuestions.length > 0 && a.customAnswers && Object.keys(a.customAnswers).length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 10, color: 'var(--olive-light)', lineHeight: 1.5 }}>
                        {customQuestions.map((q) => {
                          const v = a.customAnswers[q.key];
                          if (v === undefined || v === null || v === '') return null;
                          return (
                            <div key={q.key}>
                              <span style={{ color: 'var(--tan)' }}>{q.label}:</span> {String(v)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td style={td}>{a.email || '—'}</td>
                  <td style={td}>{a.phone || '—'}</td>
                  <td style={td}>{a.ticketType || '—'}</td>
                  <td style={td}>
                    {a.waiverSigned
                      ? <span style={{ color: '#2ecc71' }}>✓ Signed</span>
                      : (
                        <div>
                          <span style={{ color: 'var(--olive-light)' }}>Pending</span>
                          <button onClick={() => sendWaiver(a.id)} style={sendBtn}>✉ Send</button>
                        </div>
                      )}
                  </td>
                  <td style={td}>
                    {a.checkedInAt ? (
                      <div>
                        <span style={{ color: '#2ecc71', fontWeight: 700 }}>✓ {new Date(a.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <button onClick={() => checkOut(a.id)} style={undoBtn}>undo</button>
                      </div>
                    ) : (
                      <button onClick={() => checkIn(a.id)} style={checkInBtn}>Check In</button>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 11 }}>
                    <div style={{ color: 'var(--olive-light)' }}>{a.buyerName}</div>
                    <div style={{ color: 'var(--tan)', fontSize: 10, fontFamily: 'monospace' }}>{a.bookingId}</div>
                    {a.bookingStatus === 'comp' && <span style={{ display: 'inline-block', marginTop: 2, fontSize: 9, fontWeight: 800, color: '#9b59b6' }}>COMP</span>}
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

function Stat({ label, value, sub }) {
  return (
    <div style={statCard}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--cream)', margin: '6px 0 2px' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--olive-light)' }}>{sub}</div>}
    </div>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: '0 0 1.5rem' };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', minWidth: 200 };
const csvBtn = { padding: '10px 18px', background: 'var(--olive)', border: '1px solid var(--olive-light)', color: 'var(--cream)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 };
const statCard = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.25rem' };
const tableBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)' };
const checkInBtn = {
  padding: '6px 14px', background: 'var(--orange)', color: '#fff', border: 'none',
  fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
};
const undoBtn = {
  marginLeft: 8, padding: '2px 8px', background: 'transparent', border: '1px solid rgba(200,184,154,0.2)',
  color: 'var(--olive-light)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
};
const sendBtn = {
  marginLeft: 8, padding: '2px 8px', background: 'transparent', border: '1px solid rgba(212,84,26,0.4)',
  color: 'var(--orange)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
};
