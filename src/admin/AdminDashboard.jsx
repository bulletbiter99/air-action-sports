import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
const dateFmt = (ms) => ms ? new Date(ms).toLocaleString() : '—';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'comp', label: 'Comp' },
];

export default function AdminDashboard() {
  const { user, isAuthenticated, loading, setupNeeded, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ status: '', q: '', event_id: '' });
  const [events, setEvents] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [cronStatus, setCronStatus] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (setupNeeded) navigate('/admin/setup', { replace: true });
    else if (!isAuthenticated) navigate('/admin/login', { replace: true });
  }, [loading, isAuthenticated, setupNeeded, navigate]);

  const loadStats = useCallback(async () => {
    const res = await fetch('/api/admin/bookings/stats/summary', { credentials: 'include', cache: 'no-store' });
    if (res.ok) setStats(await res.json());
  }, []);

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/events', { cache: 'no-store' });
    if (res.ok) {
      const { events } = await res.json();
      setEvents(events || []);
    }
  }, []);

  const loadCronStatus = useCallback(async () => {
    const res = await fetch('/api/admin/analytics/cron-status', {
      credentials: 'include', cache: 'no-store',
    });
    if (res.ok) setCronStatus(await res.json());
  }, []);

  const loadBookings = useCallback(async () => {
    setListLoading(true);
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.q) params.set('q', filter.q);
    if (filter.event_id) params.set('event_id', filter.event_id);
    const res = await fetch(`/api/admin/bookings?${params.toString()}`, {
      credentials: 'include', cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      setBookings(data.bookings || []);
      setTotal(data.total || 0);
    }
    setListLoading(false);
  }, [filter]);

  useEffect(() => {
    if (isAuthenticated) {
      loadStats();
      loadEvents();
      loadCronStatus();
    }
  }, [isAuthenticated, loadStats, loadEvents, loadCronStatus]);

  useEffect(() => {
    if (isAuthenticated) loadBookings();
  }, [isAuthenticated, loadBookings]);

  const quickStats = useMemo(() => {
    if (!stats) return null;
    const paid = stats.byStatus?.find((s) => s.status === 'paid');
    const pending = stats.byStatus?.find((s) => s.status === 'pending');
    return {
      paidCount: paid?.n || 0,
      paidGross: paid?.gross_cents || 0,
      pendingCount: pending?.n || 0,
      todayCount: stats.today?.count || 0,
      todayGross: stats.today?.grossCents || 0,
    };
  }, [stats]);

  if (loading || !isAuthenticated) return null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      {/* Header */}
      <div style={headerRow}>
        <div>
          <h1 style={h1}>Dashboard</h1>
          <div style={{ color: 'var(--olive-light)', fontSize: 13, marginTop: 4 }}>
            Signed in as <strong style={{ color: 'var(--tan)' }}>{user.displayName}</strong>
            {' · '}<span style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: 1 }}>{user.role}</span>
          </div>
        </div>
        {hasRole('manager') && (
          <Link to="/admin/new-booking" style={newBookingBtn}>
            + New Booking
          </Link>
        )}
      </div>

      {/* Quick stats */}
      {quickStats && (
        <div style={statsGrid}>
          <StatCard label="Today paid" value={quickStats.todayCount} sub={fmt(quickStats.todayGross)} />
          <StatCard label="All paid" value={quickStats.paidCount} sub={fmt(quickStats.paidGross)} />
          <StatCard label="Pending" value={quickStats.pendingCount} sub="awaiting payment" />
          <StatCard label="Total events" value={events.length} sub="active" />
        </div>
      )}

      {/* Reminder cron health — narrow strip, dim styling so it doesn't shout
          when everything's fine. Goes red if last sweep is >60 min old. */}
      {cronStatus && <CronHealth status={cronStatus} />}

      {/* Filters */}
      <div style={filterBar}>
        <input
          type="search"
          placeholder="Search name or email…"
          value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          style={{ ...filterInput, flex: 2 }}
        />
        <select
          value={filter.event_id}
          onChange={(e) => setFilter({ ...filter, event_id: e.target.value })}
          style={{ ...filterInput, flex: 1 }}
        >
          <option value="">All events</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </select>
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          style={{ ...filterInput, flex: 1 }}
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Bookings */}
      <section style={sectionBox}>
        <h2 style={h2}>Bookings {total > 0 && <span style={{ color: 'var(--olive-light)', fontSize: 13, fontWeight: 400, letterSpacing: 0 }}>({total})</span>}</h2>
        {listLoading && <p style={{ color: 'var(--olive-light)', fontSize: 13 }}>Loading…</p>}
        {!listLoading && bookings.length === 0 && (
          <p style={{ color: 'var(--olive-light)', fontSize: 13 }}>No bookings match the current filter.</p>
        )}
        {bookings.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Players</th>
                <th style={th}>Total</th>
                <th style={th}>Method</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} style={tr}>
                  <td style={td}>{dateFmt(b.createdAt)}</td>
                  <td style={td}><strong>{b.fullName}</strong></td>
                  <td style={td}>{b.email}</td>
                  <td style={td}>{b.playerCount}</td>
                  <td style={td}>{fmt(b.totalCents)}</td>
                  <td style={td}><MethodBadge method={b.paymentMethod} /></td>
                  <td style={td}><StatusBadge status={b.status} /></td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button style={viewBtn} onClick={() => setSelected(b.id)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {selected && (
        <BookingDetailModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { loadBookings(); loadStats(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={statCard}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--cream)', margin: '6px 0 2px' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--olive-light)' }}>{sub}</div>
    </div>
  );
}

function CronHealth({ status }) {
  const ageMs = status.lastSweepAt ? Date.now() - status.lastSweepAt : null;
  const stale = ageMs == null || ageMs > 60 * 60 * 1000; // >60 min = warn
  const ageLabel = (() => {
    if (ageMs == null) return 'never';
    if (ageMs < 60_000) return 'just now';
    if (ageMs < 3600_000) return `${Math.round(ageMs / 60_000)} min ago`;
    if (ageMs < 86400_000) return `${Math.round(ageMs / 3600_000)} hr ago`;
    return `${Math.round(ageMs / 86400_000)} d ago`;
  })();

  const accent = stale ? '#e74c3c' : '#2ecc71';
  const accentBg = stale ? 'rgba(231,76,60,0.06)' : 'rgba(46,204,113,0.04)';

  return (
    <div style={{
      margin: '12px 0 28px',
      padding: '10px 14px',
      background: accentBg,
      border: `1px solid ${accent}33`,
      borderLeft: `3px solid ${accent}`,
      display: 'flex',
      gap: 24,
      flexWrap: 'wrap',
      alignItems: 'center',
      fontSize: 12,
      color: 'var(--olive-light)',
    }}>
      <div>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: accent, textTransform: 'uppercase' }}>
          Reminder cron
        </span>
        {' · '}
        <span style={{ color: stale ? accent : 'var(--tan-light)' }}>
          last sweep {ageLabel}
        </span>
        {stale && status.lastSweepAt && <span style={{ color: accent, marginLeft: 8 }}>STALE</span>}
      </div>
      <div>
        24hr reminders sent today: <strong style={{ color: 'var(--cream)' }}>{status.reminders24h?.sent24hr ?? 0}</strong>
      </div>
      <div>
        1hr: <strong style={{ color: 'var(--cream)' }}>{status.reminders24h?.sent1hr ?? 0}</strong>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const palette = {
    paid: { bg: 'rgba(39,174,96,0.15)', fg: '#2ecc71' },
    pending: { bg: 'rgba(212,84,26,0.15)', fg: 'var(--orange)' },
    cancelled: { bg: 'rgba(149,165,166,0.15)', fg: '#95a5a6' },
    refunded: { bg: 'rgba(230,126,34,0.15)', fg: '#e67e22' },
    comp: { bg: 'rgba(155,89,182,0.15)', fg: '#9b59b6' },
  };
  const c = palette[status] || palette.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 800,
      letterSpacing: 1.5, textTransform: 'uppercase', background: c.bg, color: c.fg,
      border: `1px solid ${c.fg}40`,
    }}>{status}</span>
  );
}

function MethodBadge({ method }) {
  if (!method) return <span style={{ color: 'var(--olive-light)', fontSize: 10 }}>—</span>;
  const palette = {
    stripe: { bg: 'rgba(99,91,255,0.15)', fg: '#7e72ff', label: 'card' },
    card:   { bg: 'rgba(99,91,255,0.15)', fg: '#7e72ff', label: 'card' },
    cash:   { bg: 'rgba(46,204,113,0.15)', fg: '#2ecc71', label: 'cash' },
    venmo:  { bg: 'rgba(0,142,194,0.15)',  fg: '#3da5d9', label: 'venmo' },
    paypal: { bg: 'rgba(0,48,135,0.20)',   fg: '#5a8dee', label: 'paypal' },
    comp:   { bg: 'rgba(155,89,182,0.15)', fg: '#9b59b6', label: 'comp' },
  };
  const c = palette[method] || { bg: 'rgba(149,165,166,0.15)', fg: '#95a5a6', label: method };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 800,
      letterSpacing: 1.5, textTransform: 'uppercase', background: c.bg, color: c.fg,
      border: `1px solid ${c.fg}40`,
    }}>{c.label}</span>
  );
}

function BookingDetailModal({ id, onClose, onChanged }) {
  const { hasRole } = useAdmin();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState(null);
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [actionMsg, setActionMsg] = useState(null); // { kind, text }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, { credentials: 'include', cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setData(d);
    } catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const flashMsg = (kind, text) => {
    setActionMsg({ kind, text });
    setTimeout(() => setActionMsg(null), 3500);
  };

  const resendConfirmation = async () => {
    setResending(true);
    const res = await fetch(`/api/admin/bookings/${id}/resend-confirmation`, {
      method: 'POST', credentials: 'include',
    });
    setResending(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) flashMsg('ok', `Confirmation re-sent to ${d.sentTo}`);
    else flashMsg('err', d.error || 'Resend failed');
  };

  const doRefund = async () => {
    setRefunding(true);
    setRefundError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${id}/refund`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'requested_by_customer' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Refund failed');
      setShowRefundConfirm(false);
      await load();
      onChanged?.();
    } catch (e) {
      setRefundError(e.message);
    } finally {
      setRefunding(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <h2 style={{ ...h2, margin: 0 }}>Booking Detail</h2>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>
        {error && <div style={{ color: '#ff8a7e' }}>{error}</div>}
        {!data && !error && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {data && (
          <>
            <Row label="Booking ID" value={<code style={{ color: 'var(--tan)' }}>{data.booking.id}</code>} />
            <Row label="Event" value={data.event?.title} />
            <Row label="Date" value={data.event?.displayDate} />
            <Row label="Buyer" value={`${data.booking.fullName} · ${data.booking.email} · ${data.booking.phone}`} />
            <Row label="Status" value={<StatusBadge status={data.booking.status} />} />
            <Row label="Payment" value={<MethodBadge method={data.booking.paymentMethod} />} />
            <Row label="Created" value={dateFmt(data.booking.createdAt)} />
            {data.booking.paidAt && <Row label="Paid at" value={dateFmt(data.booking.paidAt)} />}
            <Row label="Total" value={<strong>{fmt(data.booking.totalCents)}</strong>} />

            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(200,184,154,0.15)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {hasRole('manager') && ['paid', 'comp'].includes(data.booking.status) && (
                <button
                  onClick={resendConfirmation}
                  disabled={resending}
                  style={{
                    padding: '10px 20px', background: 'transparent',
                    border: '1px solid rgba(200,184,154,0.3)', color: 'var(--tan)',
                    fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase',
                    cursor: resending ? 'wait' : 'pointer',
                  }}
                >{resending ? 'Sending…' : '✉ Resend Confirmation'}</button>
              )}
              {data.booking.status === 'paid' && data.booking.stripePaymentIntent && !String(data.booking.stripePaymentIntent).startsWith('cash_') && (
                <button
                  onClick={() => setShowRefundConfirm(true)}
                  style={{
                    padding: '10px 20px', background: 'transparent',
                    border: '1px solid rgba(231,76,60,0.5)', color: '#ff8a7e',
                    fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >Issue Full Refund</button>
              )}
              {actionMsg && (
                <span style={{
                  fontSize: 12, padding: '6px 12px',
                  background: actionMsg.kind === 'ok' ? 'rgba(39,174,96,0.15)' : 'rgba(231,76,60,0.15)',
                  color: actionMsg.kind === 'ok' ? '#2ecc71' : '#ff8a7e',
                }}>{actionMsg.text}</span>
              )}
            </div>

            {showRefundConfirm && (
              <RefundConfirmModal
                booking={data.booking}
                error={refundError}
                submitting={refunding}
                onCancel={() => { setShowRefundConfirm(false); setRefundError(null); }}
                onConfirm={doRefund}
              />
            )}

            <div style={{ margin: '20px 0 10px', fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)' }}>
              Line items
            </div>
            <div className="admin-table-wrap"><table style={table}>
              <thead><tr><th style={th}>Item</th><th style={th}>Qty</th><th style={th}>Total</th></tr></thead>
              <tbody>
                {data.booking.lineItems.filter((li) => li.type === 'ticket' || li.type === 'addon').map((li, i) => (
                  <tr key={i} style={tr}>
                    <td style={td}>{li.name}{li.addon_type === 'rental' ? ' (rental)' : ''}</td>
                    <td style={td}>{li.qty}</td>
                    <td style={td}>{fmt(li.line_total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>

            {data.booking.lineItems.some((li) => li.type === 'tax' || li.type === 'fee') && (
              <>
                <div style={{ margin: '20px 0 10px', fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)' }}>
                  Taxes &amp; Fees (admin-only breakdown)
                </div>
                <div className="admin-table-wrap"><table style={table}>
                  <thead><tr><th style={th}>Line</th><th style={th}>Rate</th><th style={th}>Amount</th></tr></thead>
                  <tbody>
                    {data.booking.lineItems.filter((li) => li.type === 'tax' || li.type === 'fee').map((li, i) => {
                      const parts = [];
                      if (li.percent_bps) parts.push(`${(li.percent_bps / 100).toFixed(2)}%`);
                      if (li.fixed_cents) parts.push(`+ $${(li.fixed_cents / 100).toFixed(2)}`);
                      return (
                        <tr key={`tf-${i}`} style={tr}>
                          <td style={td}>
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: li.type === 'tax' ? '#e67e22' : '#9b59b6', textTransform: 'uppercase', marginRight: 8 }}>{li.type}</span>
                            {li.name}
                          </td>
                          <td style={{ ...td, color: 'var(--olive-light)', fontSize: 12 }}>{parts.join(' ') || '—'}</td>
                          <td style={td}>{fmt(li.line_total_cents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                <p style={{ fontSize: 11, color: 'var(--olive-light)', marginTop: 8 }}>
                  Customer sees a single <strong>Taxes &amp; Fees</strong> line of <strong>{fmt((data.booking.taxCents || 0) + (data.booking.feeCents || 0))}</strong>.
                </p>
              </>
            )}

            {data.attendees.length > 0 && (
              <>
                <div style={{ margin: '20px 0 10px', fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)' }}>
                  Players ({data.attendees.length})
                </div>
                <div className="admin-table-wrap"><table style={table}>
                  <thead><tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Phone</th><th style={th}>Waiver</th><th style={th}>Check-in</th><th style={th}></th></tr></thead>
                  <tbody>
                    {data.attendees.map((a) => (
                      <AttendeeRow key={a.id} attendee={a} onChanged={load} />
                    ))}
                  </tbody>
                </table></div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AttendeeRow({ attendee: a, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    firstName: a.firstName || '', lastName: a.lastName || '',
    email: a.email || '', phone: a.phone || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [waiverSending, setWaiverSending] = useState(false);

  const save = async () => {
    setSaving(true); setErr(null);
    const res = await fetch(`/api/admin/attendees/${a.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) { setEditing(false); onChanged?.(); }
    else { const d = await res.json().catch(() => ({})); setErr(d.error || 'Save failed'); }
  };

  const resendWaiver = async () => {
    setWaiverSending(true);
    const res = await fetch(`/api/admin/attendees/${a.id}/send-waiver`, {
      method: 'POST', credentials: 'include',
    });
    setWaiverSending(false);
    if (res.ok) alert('Waiver email sent');
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'Send failed'); }
  };

  if (editing) {
    return (
      <tr style={tr}>
        <td style={td} colSpan={6}>
          <div className="admin-row-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr 1fr auto', gap: 6, alignItems: 'center' }}>
            <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} style={editInput} />
            <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} style={editInput} />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={editInput} />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={editInput} />
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={save} disabled={saving} style={smallPrimary}>{saving ? '…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setErr(null); }} style={smallSubtle}>×</button>
            </div>
          </div>
          {a.waiverSigned && (
            <div style={{ fontSize: 10, color: '#f39c12', marginTop: 4 }}>
              ⚠ Waiver already signed — stored signature won't be altered
            </div>
          )}
          {err && <div style={{ fontSize: 11, color: '#ff8a7e', marginTop: 4 }}>{err}</div>}
        </td>
      </tr>
    );
  }

  return (
    <tr style={tr}>
      <td style={td}>{a.firstName} {a.lastName}</td>
      <td style={td}>{a.email || '—'}</td>
      <td style={td}>{a.phone || '—'}</td>
      <td style={td}>{a.waiverSigned ? <span style={{ color: '#2ecc71' }}>✓ Signed</span> : <span style={{ color: 'var(--olive-light)' }}>Pending</span>}</td>
      <td style={td}>{a.checkedIn ? <span style={{ color: '#2ecc71' }}>✓</span> : '—'}</td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button onClick={() => setEditing(true)} style={smallSubtle}>Edit</button>
        {!a.waiverSigned && (
          <button onClick={resendWaiver} disabled={waiverSending} style={{ ...smallSubtle, marginLeft: 6 }}>
            {waiverSending ? '…' : '✉ Waiver'}
          </button>
        )}
      </td>
    </tr>
  );
}

const editInput = { padding: '6px 10px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 12, fontFamily: 'inherit' };
const smallPrimary = { padding: '6px 12px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const smallSubtle = { padding: '4px 10px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };

function RefundConfirmModal({ booking, onCancel, onConfirm, submitting, error }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{
        background: 'var(--mid)', border: '1px solid rgba(231,76,60,0.4)',
        padding: '2rem', maxWidth: 460, width: '100%',
      }}>
        <div style={{ color: '#ff8a7e', fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>
          ⚠ Confirm Refund
        </div>
        <h3 style={{ color: 'var(--cream)', fontSize: 20, fontWeight: 900, margin: '0 0 1rem', letterSpacing: '-0.5px' }}>
          Refund {fmt(booking.totalCents)}?
        </h3>
        <div style={{ background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)', padding: 14, marginBottom: 18 }}>
          <p style={{ color: 'var(--cream)', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            This will refund <strong>{fmt(booking.totalCents)}</strong> to <strong>{booking.email}</strong>'s card via Stripe.
          </p>
          <ul style={{ color: 'var(--tan-light)', fontSize: 12, margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Booking will be marked <strong>refunded</strong></li>
            <li>{booking.playerCount} ticket{booking.playerCount > 1 ? 's' : ''} released back to inventory</li>
            <li><strong style={{ color: '#ff8a7e' }}>This action cannot be undone</strong></li>
          </ul>
        </div>
        {error && <div style={{ background: 'rgba(231,76,60,0.15)', color: '#ff8a7e', padding: 10, marginBottom: 14, fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button" onClick={onCancel} disabled={submitting}
            style={{ padding: '12px 22px', background: 'transparent', border: '1px solid rgba(200,184,154,0.3)', color: 'var(--tan)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' }}
          >Cancel</button>
          <button
            type="button" onClick={onConfirm} disabled={submitting}
            style={{ padding: '12px 22px', background: '#c0392b', border: 'none', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1 }}
          >{submitting ? 'Refunding…' : '▶ Issue Refund'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', padding: '6px 0', borderBottom: '1px solid rgba(200,184,154,0.05)', fontSize: 13 }}>
      <div style={{ flex: '0 0 140px', color: 'var(--olive-light)' }}>{label}</div>
      <div style={{ flex: 1, color: 'var(--cream)' }}>{value || '—'}</div>
    </div>
  );
}

// Styles
const headerRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', gap: 12, flexWrap: 'wrap' };
const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const newBookingBtn = {
  padding: '10px 18px', background: 'var(--orange)', color: '#fff',
  border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5,
  textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none',
  display: 'inline-flex', alignItems: 'center', flexShrink: 0,
};
const h2 = { fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--orange)', margin: '0 0 16px' };
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 };
const statCard = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.25rem' };
const filterBar = { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' };
const filterInput = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', minWidth: 180 };
const sectionBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)' };
const viewBtn = { padding: '4px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.3)', color: 'var(--tan)', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' };
const modalCard = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '2rem', maxWidth: 700, width: '100%' };
const closeBtn = { background: 'none', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--tan)', width: 32, height: 32, cursor: 'pointer', fontSize: 16 };
