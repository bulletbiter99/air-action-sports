import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash (paid in person)', desc: 'Creates paid booking. Mark as settled at the venue.' },
  { value: 'comp', label: 'Comp / Free', desc: 'No charge. For staff, press, contest winners, etc.' },
];

export default function AdminNewBooking() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [qty, setQty] = useState(1);
  const [addonQtys, setAddonQtys] = useState({}); // { sku: qty }
  const [buyer, setBuyer] = useState({ fullName: '', email: '', phone: '' });
  const [attendees, setAttendees] = useState([{ firstName: '', lastName: '', email: '' }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
    else if (!hasRole('manager')) navigate('/admin');
  }, [loading, isAuthenticated, hasRole, navigate]);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setEvents(data.events || []);
    if (data.events?.length && !eventId) setEventId(data.events[0].id);
  }, [eventId]);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const event = useMemo(() => events.find((e) => e.id === eventId), [events, eventId]);
  const ticketTypes = event?.ticketTypes || [];
  const addons = event?.addons || [];

  useEffect(() => {
    if (!ticketTypes.length) { setTicketTypeId(''); return; }
    if (!ticketTypes.find((t) => t.id === ticketTypeId)) {
      setTicketTypeId(ticketTypes[0].id);
    }
  }, [ticketTypes, ticketTypeId]);

  useEffect(() => {
    setAttendees((prev) => {
      const out = [];
      for (let i = 0; i < qty; i++) out.push(prev[i] || { firstName: '', lastName: '', email: '' });
      return out;
    });
  }, [qty]);

  const updateAttendee = (i, field, val) => {
    setAttendees((p) => p.map((a, idx) => (idx === i ? { ...a, [field]: val } : a)));
  };

  const totals = useMemo(() => {
    if (!event || !ticketTypes.length) return { subtotal: 0, tax: 0, total: 0 };
    if (paymentMethod === 'comp') return { subtotal: 0, tax: 0, total: 0 };
    const tt = ticketTypes.find((t) => t.id === ticketTypeId);
    let subtotal = (tt?.priceCents || 0) * qty;
    for (const [sku, addonQty] of Object.entries(addonQtys)) {
      const a = addons.find((x) => x.sku === sku);
      if (a) subtotal += a.price_cents * addonQty;
    }
    const tax = Math.floor((subtotal * (event.taxRateBps || 0)) / 10000);
    return { subtotal, tax, total: subtotal + tax };
  }, [event, ticketTypes, ticketTypeId, qty, addonQtys, addons, paymentMethod]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!eventId || !ticketTypeId) return setError('Pick an event and ticket type.');
    if (!buyer.fullName.trim() || !buyer.email.trim()) return setError('Buyer name + email required.');
    for (const [i, a] of attendees.entries()) {
      if (!a.firstName.trim()) return setError(`Player ${i + 1} first name required.`);
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/bookings/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          paymentMethod,
          buyer,
          attendees: attendees.map((a) => ({ ...a, ticketTypeId })),
          addonSelections: Object.entries(addonQtys)
            .filter(([, q]) => q > 0)
            .map(([sku, qty]) => ({ sku, qty })),
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setCreated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !isAuthenticated) return null;

  if (created) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
        <h1 style={h1}>Booking Created</h1>
        <div style={card}>
          <p style={{ color: 'var(--cream)' }}>
            Booking <code style={{ color: 'var(--tan)' }}>{created.bookingId}</code> created
            {' · '}
            <strong>{fmt(created.totalCents)}</strong>
            {' · status: '}<strong>{created.status}</strong>
          </p>
          <p style={{ color: 'var(--olive-light)', fontSize: 13, marginTop: 8 }}>
            {created.status === 'paid'
              ? `Cash collected at venue. No Stripe charge.`
              : `Comp ticket — no payment required.`}
            {' '}Attendees have QR tokens assigned and still need to sign waivers before game day.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button style={primaryBtn} onClick={() => {
              setCreated(null); setBuyer({ fullName: '', email: '', phone: '' });
              setAttendees([{ firstName: '', lastName: '', email: '' }]);
              setQty(1); setAddonQtys({}); setNotes('');
            }}>▶ New Booking</button>
            <button style={secondaryBtn} onClick={() => navigate('/admin')}>Back to Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '2rem' }}>
      <h1 style={h1}>New Booking</h1>
      <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 24 }}>
        Create a booking directly in the system — walk-in, phone booking, or comp. Counts toward capacity.
      </p>

      {error && <div style={errBanner}>{error}</div>}

      <form onSubmit={submit} style={card}>
        <h3 style={sectionH}>Payment Method</h3>
        <div style={radioGrid}>
          {PAYMENT_METHODS.map((pm) => (
            <label key={pm.value} style={{
              ...radioCard,
              borderColor: paymentMethod === pm.value ? 'var(--orange)' : 'rgba(200,184,154,0.15)',
              background: paymentMethod === pm.value ? 'rgba(212,84,26,0.06)' : 'rgba(0,0,0,0.2)',
            }}>
              <input
                type="radio" name="pm" value={pm.value}
                checked={paymentMethod === pm.value}
                onChange={(e) => setPaymentMethod(e.target.value)}
                style={{ accentColor: 'var(--orange)' }}
              />
              <div>
                <div style={{ fontWeight: 800, color: 'var(--cream)', fontSize: 13 }}>{pm.label}</div>
                <div style={{ color: 'var(--olive-light)', fontSize: 12, marginTop: 4 }}>{pm.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <h3 style={sectionH}>Event</h3>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={input} required>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.title} — {ev.displayDate}{ev.past ? ' (past)' : ''}
            </option>
          ))}
        </select>

        <div style={formRow}>
          <Field label="Ticket Type">
            <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)} style={input} required>
              {ticketTypes.length === 0 && <option value="">No ticket types</option>}
              {ticketTypes.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.name} — {tt.priceDisplay}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Number of Players">
            <input type="number" min="1" max="50" value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))} style={input} required />
          </Field>
        </div>

        {addons.length > 0 && (
          <>
            <h3 style={sectionH}>Add-ons (optional)</h3>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12 }}>
              {addons.map((addon) => (
                <div key={addon.sku} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(200,184,154,0.05)' }}>
                  <div>
                    <strong style={{ color: 'var(--cream)', fontSize: 13 }}>{addon.name}</strong>
                    {addon.type === 'rental' && <span style={rentalBadge}>Rental</span>}
                    <div style={{ fontSize: 12, color: 'var(--olive-light)' }}>${(addon.price_cents / 100).toFixed(2)}{addon.description ? ` · ${addon.description}` : ''}</div>
                  </div>
                  <input
                    type="number" min="0" max={addon.max_per_order || 99}
                    value={addonQtys[addon.sku] || 0}
                    onChange={(e) => setAddonQtys({ ...addonQtys, [addon.sku]: Math.max(0, parseInt(e.target.value) || 0) })}
                    style={{ ...input, width: 70, textAlign: 'center' }}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {paymentMethod !== 'comp' && totals.total > 0 && (
          <div style={totalsBox}>
            <div style={totalRow}><span>Subtotal</span><span>{fmt(totals.subtotal)}</span></div>
            {totals.tax > 0 && <div style={totalRow}><span>Tax</span><span>{fmt(totals.tax)}</span></div>}
            <div style={{ ...totalRow, fontSize: 16, fontWeight: 800, color: 'var(--cream)', borderTop: '1px solid rgba(212,84,26,0.3)', paddingTop: 8, marginTop: 6 }}>
              <span>Total to collect</span>
              <span>{fmt(totals.total)}</span>
            </div>
          </div>
        )}

        <h3 style={sectionH}>Buyer / Point of Contact</h3>
        <div style={formRow}>
          <Field label="Name">
            <input type="text" value={buyer.fullName} onChange={(e) => setBuyer({ ...buyer, fullName: e.target.value })} style={input} required />
          </Field>
          <Field label="Email">
            <input type="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} style={input} required />
          </Field>
        </div>
        <Field label="Phone (optional)">
          <input type="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} style={input} />
        </Field>

        <h3 style={sectionH}>Players ({attendees.length})</h3>
        {attendees.map((a, i) => (
          <div key={i} style={attendeeRow}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', marginBottom: 8 }}>PLAYER {i + 1}</div>
            <div style={formRow}>
              <Field label="First name">
                <input type="text" value={a.firstName} onChange={(e) => updateAttendee(i, 'firstName', e.target.value)} style={input} required />
              </Field>
              <Field label="Last name">
                <input type="text" value={a.lastName} onChange={(e) => updateAttendee(i, 'lastName', e.target.value)} style={input} />
              </Field>
            </div>
            <Field label="Email (optional — gets waiver link emailed)">
              <input type="email" value={a.email} onChange={(e) => updateAttendee(i, 'email', e.target.value)} style={input} />
            </Field>
          </div>
        ))}

        <Field label="Notes (internal, not shown to customer)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>

        <button type="submit" disabled={submitting} style={primaryBtn}>
          {submitting
            ? 'Creating…'
            : paymentMethod === 'comp'
              ? `▶ Create Comp Booking (${attendees.length} player${attendees.length > 1 ? 's' : ''})`
              : `▶ Collect ${fmt(totals.total)} & Create Booking`}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 200, marginBottom: 14 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: '0 0 0.5rem' };
const sectionH = { fontSize: 12, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase', margin: '24px 0 12px' };
const card = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '2rem' };
const formRow = { display: 'flex', gap: 16, flexWrap: 'wrap' };
const attendeeRow = { padding: '16px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(200,184,154,0.05)', marginBottom: 12 };
const radioGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 };
const radioCard = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, border: '1px solid', cursor: 'pointer', transition: 'all 0.15s' };
const rentalBadge = { display: 'inline-block', marginLeft: 6, fontSize: 9, fontWeight: 800, letterSpacing: 1.5, padding: '1px 6px', background: 'rgba(212,84,26,0.15)', color: 'var(--orange)', border: '1px solid rgba(212,84,26,0.3)', textTransform: 'uppercase' };
const totalsBox = { background: 'rgba(212,84,26,0.06)', border: '1px solid rgba(212,84,26,0.25)', padding: 14, margin: '16px 0' };
const totalRow = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: 'var(--tan-light)' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--tan)', marginBottom: 6 };
const input = { width: '100%', padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const primaryBtn = { padding: '14px 28px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', marginTop: 16, width: '100%' };
const secondaryBtn = { padding: '14px 28px', background: 'transparent', color: 'var(--tan)', border: '1px solid rgba(200,184,154,0.3)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', marginTop: 16 };
const errBanner = { background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#ff8a7e', padding: 12, marginBottom: 16, fontSize: 13 };
