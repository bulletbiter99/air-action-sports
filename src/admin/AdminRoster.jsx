import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

const WAIVER_FILTER_OPTIONS = [
  { value: 'signed', label: 'Waiver signed' },
  { value: 'unsigned', label: 'Waiver pending' },
  { value: 'checked-in', label: 'Checked in' },
];

export default function AdminRoster() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ event_id: '', waiver_filter: '', q: '' });
  const [roster, setRoster] = useState(null);
  const [loadingRoster, setLoadingRoster] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const list = data.events || [];
    setEvents(list);
    // Auto-select the next upcoming event (earliest by date, not past).
    // Falls back to the most recent event if there are no upcoming ones.
    setFilters((prev) => {
      if (prev.event_id || !list.length) return prev;
      const upcoming = list
        .filter((e) => !e.past)
        .sort((a, b) => (a.dateIso || '').localeCompare(b.dateIso || ''));
      const pick = upcoming.length ? upcoming[0].id : list[0].id;
      return { ...prev, event_id: pick };
    });
  }, []);

  const loadRoster = useCallback(async () => {
    if (!filters.event_id) return;
    setLoadingRoster(true);
    const res = await fetch(`/api/admin/events/${filters.event_id}/roster`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) setRoster(await res.json());
    setLoadingRoster(false);
  }, [filters.event_id]);

  useEffect(() => { if (isAuthenticated) loadEvents(); }, [isAuthenticated, loadEvents]);
  useEffect(() => { if (filters.event_id) loadRoster(); }, [filters.event_id, loadRoster]);

  const filtered = useMemo(() => {
    if (!roster?.attendees) return [];
    const q = filters.q.trim().toLowerCase();
    return roster.attendees.filter((a) => {
      if (filters.waiver_filter === 'signed' && !a.waiverSigned) return false;
      if (filters.waiver_filter === 'unsigned' && a.waiverSigned) return false;
      if (filters.waiver_filter === 'checked-in' && !a.checkedInAt) return false;
      if (q) {
        const hay = `${a.firstName} ${a.lastName || ''} ${a.email || ''} ${a.buyerName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [roster, filters.q, filters.waiver_filter]);

  const stats = useMemo(() => {
    if (!roster?.attendees) return null;
    const total = roster.attendees.length;
    const signed = roster.attendees.filter((a) => a.waiverSigned).length;
    const checked = roster.attendees.filter((a) => a.checkedInAt).length;
    const comp = roster.attendees.filter((a) => a.bookingStatus === 'comp').length;
    return { total, signed, checked, comp };
  }, [roster]);

  const downloadCsv = () => {
    if (!filters.event_id) return;
    window.location.href = `/api/admin/events/${filters.event_id}/roster.csv`;
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

  const filterSchema = useMemo(() => [
    {
      key: 'event_id',
      label: 'Event',
      type: 'enum',
      options: events.map((ev) => ({
        value: ev.id,
        label: `${ev.title} — ${ev.displayDate} (${ev.attendeesCount || 0})`,
      })),
    },
    {
      key: 'waiver_filter',
      label: 'Show only',
      type: 'enum',
      options: WAIVER_FILTER_OPTIONS,
    },
  ], [events]);

  if (loading || !isAuthenticated) return null;

  const customQuestions = roster?.event?.customQuestions || [];
  const isFiltered = Boolean(filters.q || filters.waiver_filter);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Event Roster"
        description="Players signed up for the selected event. Check players in, send waiver reminders, or export a CSV."
        primaryAction={
          <button onClick={downloadCsv} style={csvBtn} disabled={!filters.event_id}>
            ▼ Export CSV
          </button>
        }
      />

      <FilterBar
        schema={filterSchema}
        value={filters}
        onChange={setFilters}
        searchValue={filters.q}
        onSearchChange={(q) => setFilters((f) => ({ ...f, q }))}
        searchPlaceholder="Search name, email, buyer…"
        resultCount={filtered.length}
        savedViewsKey="adminRoster"
      />

      {stats && (
        <div style={statsGrid}>
          <Stat label="Players" value={stats.total} />
          <Stat
            label="Waiver signed"
            value={`${stats.signed} / ${stats.total}`}
            sub={stats.total === 0 ? '—' : `${Math.round(stats.signed / stats.total * 100)}%`}
          />
          <Stat label="Checked in" value={stats.checked} />
          <Stat label="Comp" value={stats.comp} />
        </div>
      )}

      <section style={tableBox}>
        {loadingRoster && <EmptyState variant="loading" title="Loading roster…" compact />}
        {!loadingRoster && !roster && (
          <EmptyState
            title="Pick an event to load its roster"
            description="Use the Event filter above to load attendees for the selected event."
          />
        )}
        {!loadingRoster && roster && filtered.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No players match these filters' : 'No players signed up yet'}
            description={isFiltered
              ? 'Try clearing a filter or expanding the search.'
              : 'When customers book, attendees will appear here.'}
          />
        )}
        {!loadingRoster && filtered.length > 0 && (
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
                    {a.isMinor && <span style={minorBadge}>MINOR</span>}
                    {customQuestions.length > 0 && a.customAnswers && Object.keys(a.customAnswers).length > 0 && (
                      <div style={customAnswersBlock}>
                        {customQuestions.map((q) => {
                          const v = a.customAnswers[q.key];
                          if (v === undefined || v === null || v === '') return null;
                          return (
                            <div key={q.key}>
                              <span style={{ color: 'var(--color-text-subtle)' }}>{q.label}:</span> {String(v)}
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
                      ? <span style={waiverSigned}>✓ Signed</span>
                      : (
                        <div>
                          <span style={{ color: 'var(--color-text-muted)' }}>Pending</span>
                          <button onClick={() => sendWaiver(a.id)} style={sendBtn}>✉ Send</button>
                        </div>
                      )}
                  </td>
                  <td style={td}>
                    {a.checkedInAt ? (
                      <div>
                        <span style={checkedInTime}>
                          ✓ {new Date(a.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button onClick={() => checkOut(a.id)} style={undoBtn}>undo</button>
                      </div>
                    ) : (
                      <button onClick={() => checkIn(a.id)} style={checkInBtn}>Check In</button>
                    )}
                  </td>
                  <td style={tdSmall}>
                    <div style={{ color: 'var(--color-text-muted)' }}>{a.buyerName}</div>
                    <div style={bookingIdMono}>{a.bookingId}</div>
                    {a.bookingStatus === 'comp' && <span style={compBadge}>COMP</span>}
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
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
      {sub && <div style={statSub}>{sub}</div>}
    </div>
  );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
const csvBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-bg-sunken)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const statsGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 'var(--space-16)',
  marginTop: 'var(--space-16)',
  marginBottom: 'var(--space-24)',
};
const statCard = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-16)',
};
const statLabel = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
};
const statValue = {
  fontSize: 'var(--font-size-2xl)',
  fontWeight: 'var(--font-weight-extrabold)',
  color: 'var(--color-text)',
  margin: 'var(--space-4) 0 var(--space-4)',
};
const statSub = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
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
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)' };
const tdSmall = { ...td, fontSize: 'var(--font-size-sm)' };
const minorBadge = {
  marginLeft: 'var(--space-4)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-warning)',
  fontWeight: 'var(--font-weight-bold)',
};
const customAnswersBlock = {
  marginTop: 'var(--space-4)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  lineHeight: 'var(--line-height-relaxed)',
};
const waiverSigned = { color: 'var(--color-success)' };
const checkedInTime = {
  color: 'var(--color-success)',
  fontWeight: 'var(--font-weight-bold)',
};
const compBadge = {
  display: 'inline-block',
  marginTop: 'var(--space-4)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  color: '#9b59b6',
  letterSpacing: 'var(--letter-spacing-wide)',
};
const bookingIdMono = {
  color: 'var(--color-text-subtle)',
  fontSize: 'var(--font-size-xs)',
  fontFamily: 'monospace',
};
const checkInBtn = {
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
const undoBtn = {
  marginLeft: 'var(--space-4)',
  padding: 'var(--space-4) var(--space-8)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-xs)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const sendBtn = {
  marginLeft: 'var(--space-4)',
  padding: 'var(--space-4) var(--space-8)',
  background: 'transparent',
  border: '1px solid var(--color-accent)',
  color: 'var(--color-accent)',
  fontSize: 'var(--font-size-xs)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
