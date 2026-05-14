import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { BarChart, ProgressBar } from './charts';
import { formatMoney as $ } from '../utils/money.js';

const pct = (n) => `${Math.round((n || 0) * 100)}%`;

export default function AdminAnalytics() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const [overview, setOverview] = useState(null);
  const [series, setSeries] = useState([]);
  const [perEvent, setPerEvent] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [days, setDays] = useState(30);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingData(true);
    const base = '/api/admin/analytics';
    const eventQ = selectedEventId ? `?event_id=${selectedEventId}` : '';
    const seriesQ = `?days=${days}${selectedEventId ? `&event_id=${selectedEventId}` : ''}`;

    try {
      const [ov, sr, pe] = await Promise.all([
        fetch(`${base}/overview${eventQ}`, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()),
        fetch(`${base}/sales-series${seriesQ}`, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()),
        fetch(`${base}/per-event`, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()),
      ]);
      setOverview(ov.totals ? ov : null);
      setSeries(sr.series || []);
      setPerEvent(pe.events || []);
    } catch (e) {
      console.error('analytics load', e);
    }
    setLoadingData(false);
  }, [selectedEventId, days]);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const seriesPeak = useMemo(() => {
    if (!series.length) return { date: '—', gross: 0, bookings: 0 };
    const peak = series.reduce((a, b) => (b.grossCents > a.grossCents ? b : a), series[0]);
    return { date: peak.date, gross: peak.grossCents, bookings: peak.bookings };
  }, [series]);

  const totalsForRange = useMemo(() => ({
    bookings: series.reduce((s, d) => s + d.bookings, 0),
    players: series.reduce((s, d) => s + d.players, 0),
    gross: series.reduce((s, d) => s + d.grossCents, 0),
  }), [series]);

  if (loading || !isAuthenticated) return null;

  const t = overview?.totals || {};
  const upcoming = perEvent.filter((e) => !e.past);
  const past = perEvent.filter((e) => e.past);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={h1}>Analytics</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)} style={input}>
            <option value="">All events</option>
            {perEvent.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={input}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 365 days</option>
          </select>
        </div>
      </div>

      {loadingData && !overview && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}

      {overview && (
        <>
          <div style={statsGrid}>
            <StatCard label="Net revenue" value={$(t.netRevenueCents)} sub={`${$(t.grossRevenueCents)} gross · ${$(t.refundedCents)} refunded`} color="#2ecc71" />
            <StatCard label="Paid bookings" value={t.paidCount} sub={`avg ${$(t.avgOrderCents)}/order`} />
            <StatCard label="Players" value={t.attendees} sub={`${t.checkedIn} checked in · ${t.waiversSigned} waivers`} />
            <StatCard label="Refund rate" value={pct(t.refundRate)} sub={`${overview.byStatus?.refunded?.count || 0} refunded`} color={t.refundRate > 0.1 ? '#e74c3c' : undefined} />
          </div>

          <section style={sectionBox}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 style={h2}>Sales velocity</h2>
                <div style={{ fontSize: 12, color: 'var(--olive-light)' }}>
                  {totalsForRange.bookings} bookings · {totalsForRange.players} players · {$(totalsForRange.gross)} in {days} days
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--olive-light)', textAlign: 'right' }}>
                <div>Peak day: <strong style={{ color: 'var(--tan)' }}>{seriesPeak.date}</strong></div>
                <div>{seriesPeak.bookings} bookings · {$(seriesPeak.gross)}</div>
              </div>
            </div>
            <BarChart
              data={series}
              valueKey="grossCents"
              labelKey="date"
              height={180}
              formatValue={(v) => v >= 100 ? `$${Math.round(v / 100)}` : ''}
              formatLabel={(d) => d?.slice(5) || ''}
            />
          </section>

          <section style={sectionBox}>
            <h2 style={h2}>Per-event breakdown</h2>
            <EventTable events={upcoming} label="Upcoming & active" />
            {past.length > 0 && <EventTable events={past} label="Past events" />}
            {perEvent.length === 0 && <p style={{ color: 'var(--olive-light)' }}>No events yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function EventTable({ events, label }) {
  if (!events.length) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--olive-light)', textTransform: 'uppercase', marginBottom: 10 }}>
        {label} ({events.length})
      </div>
      <div className="admin-table-wrap"><table style={table}>
        <thead>
          <tr>
            <th style={th}>Event</th>
            <th style={th}>Date</th>
            <th style={th}>Fill</th>
            <th style={th}>Net</th>
            <th style={th}>Players</th>
            <th style={th}>Waivers</th>
            <th style={th}>Check-in</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} style={tr}>
              <td style={td}>
                <strong>{e.title}</strong>
                {!e.published && <span style={{ marginLeft: 8, fontSize: 9, color: '#f39c12' }}>DRAFT</span>}
              </td>
              <td style={{ ...td, fontSize: 12 }}>{e.displayDate || e.dateIso?.slice(0, 10)}</td>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, maxWidth: 120 }}>
                    <ProgressBar value={e.seatsSold} max={e.capacity} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--tan-light)', whiteSpace: 'nowrap' }}>
                    {e.seatsSold}/{e.capacity || '∞'}
                  </span>
                </div>
              </td>
              <td style={td}>
                <strong>{$(e.netCents)}</strong>
                {e.refundedCents > 0 && (
                  <div style={{ fontSize: 10, color: '#e74c3c' }}>
                    {$(e.refundedCents)} refunded
                  </div>
                )}
              </td>
              <td style={td}>{e.attendees}</td>
              <td style={td}>
                <span style={{ color: e.waiverRate >= 0.9 ? '#2ecc71' : e.waiverRate >= 0.5 ? '#f39c12' : 'var(--olive-light)' }}>
                  {pct(e.waiverRate)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--olive-light)', marginLeft: 4 }}>
                  {e.waiversSigned}/{e.attendees}
                </span>
              </td>
              <td style={td}>
                <span style={{ color: e.checkInRate >= 0.8 ? '#2ecc71' : e.checkInRate > 0 ? '#f39c12' : 'var(--olive-light)' }}>
                  {pct(e.checkInRate)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--olive-light)', marginLeft: 4 }}>
                  {e.checkedIn}/{e.attendees}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={statCard}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: color || 'var(--cream)', margin: '6px 0 2px' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--olive-light)' }}>{sub}</div>}
    </div>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const h2 = { fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--orange)', margin: '0 0 8px' };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit' };
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 };
const statCard = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.25rem' };
const sectionBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem', marginBottom: 24 };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
