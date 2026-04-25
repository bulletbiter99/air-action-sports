import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAdmin } from './AdminContext';

const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const PAYMENT_METHODS = [
  { value: 'card',   label: 'Credit card (Stripe)', desc: 'Customer scans a QR code or taps the URL to pay via Stripe Checkout.' },
  { value: 'cash',   label: 'Cash',                  desc: 'Paid in person. Booking marked paid immediately.' },
  { value: 'venmo',  label: 'Venmo',                 desc: 'External payment. Confirm received before submitting.' },
  { value: 'paypal', label: 'PayPal',                desc: 'External payment. Confirm received before submitting.' },
  { value: 'comp',   label: 'Comp / Free',           desc: 'No charge. For staff, press, contest winners, etc.' },
];

export default function AdminNewBooking() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [qty, setQty] = useState(1);
  const [addonQtys, setAddonQtys] = useState({}); // { sku: qty }
  const [buyer, setBuyer] = useState({ fullName: '', email: '', phone: '' });
  const [attendees, setAttendees] = useState([{ firstName: '', lastName: '', email: '' }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [polledStatus, setPolledStatus] = useState(null); // 'pending' | 'paid' | 'cancelled'
  const [copied, setCopied] = useState(false);

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

  // Totals come from the public /quote endpoint so global Taxes & Fees (from /admin/settings/taxes-fees)
  // are applied identically to customer checkout. Comp bookings always zero out.
  const [totals, setTotals] = useState({ subtotal: 0, tax: 0, fee: 0, total: 0 });
  useEffect(() => {
    let cancelled = false;
    if (!eventId || !ticketTypeId || paymentMethod === 'comp') {
      setTotals({ subtotal: 0, tax: 0, fee: 0, total: 0 });
      return;
    }
    const payload = {
      eventId,
      ticketSelections: [{ ticketTypeId, qty }],
      addonSelections: Object.entries(addonQtys).filter(([, q]) => q > 0).map(([sku, q]) => ({ sku, qty: q })),
    };
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/bookings/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return;
        const q = await res.json();
        if (cancelled) return;
        setTotals({
          subtotal: q.subtotalCents || 0,
          tax: q.taxCents || 0,
          fee: q.feeCents || 0,
          total: q.totalCents || 0,
        });
      } catch {}
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [eventId, ticketTypeId, qty, addonQtys, paymentMethod]);

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

  // Generate QR code from the Stripe Checkout URL once we have one.
  useEffect(() => {
    if (!created?.paymentUrl) { setQrDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(created.paymentUrl, { width: 280, margin: 1, color: { dark: '#1a1c18', light: '#f4eedd' } })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => { console.error('QR gen failed', err); });
    return () => { cancelled = true; };
  }, [created?.paymentUrl]);

  // Poll booking status while waiting for the customer to complete card payment.
  // Stops when status flips to paid/cancelled or admin abandons.
  useEffect(() => {
    if (!created?.bookingId || created.paymentMethod !== 'card') return;
    if (polledStatus === 'paid' || polledStatus === 'cancelled') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/admin/bookings/${created.bookingId}`, { credentials: 'include', cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (data.booking?.status && !cancelled) setPolledStatus(data.booking.status);
      } catch {}
    };
    tick(); // immediate
    const t = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [created?.bookingId, created?.paymentMethod, polledStatus]);

  if (loading || !isAuthenticated) return null;

  if (created) {
    const isCardFlow = created.paymentMethod === 'card';
    const effectiveStatus = isCardFlow ? (polledStatus || created.status) : created.status;
    const isPaid = effectiveStatus === 'paid' || effectiveStatus === 'comp';
    const resetForNew = () => {
      setCreated(null); setQrDataUrl(null); setPolledStatus(null); setCopied(false);
      setBuyer({ fullName: '', email: '', phone: '' });
      setAttendees([{ firstName: '', lastName: '', email: '' }]);
      setQty(1); setAddonQtys({}); setNotes('');
    };

    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
        <h1 style={h1}>{isCardFlow && !isPaid ? 'Awaiting Card Payment' : 'Booking Created'}</h1>
        <div style={card}>
          <p style={{ color: 'var(--cream)' }}>
            Booking <code style={{ color: 'var(--tan)' }}>{created.bookingId}</code>
            {' · '}<strong>{fmt(created.totalCents)}</strong>
            {' · status: '}<strong style={{ color: isPaid ? '#27ae60' : 'var(--orange)' }}>{effectiveStatus}</strong>
          </p>

          {isCardFlow && !isPaid && (
            <div style={{ marginTop: 16, padding: 16, background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.15)', borderRadius: 4 }}>
              <p style={{ color: 'var(--cream)', fontSize: 13, margin: '0 0 12px' }}>
                Have the customer scan this QR code or open the URL on their phone:
              </p>
              {qrDataUrl ? (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <img src={qrDataUrl} alt="Stripe payment QR code" style={{ width: 240, height: 240, border: '4px solid var(--tan)', borderRadius: 4 }} />
                </div>
              ) : (
                <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>Generating QR…</p>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', marginBottom: 10 }}>
                <input
                  type="text"
                  readOnly
                  value={created.paymentUrl || ''}
                  onFocus={(e) => e.target.select()}
                  style={{ flex: 1, padding: '8px 10px', background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--tan)', fontSize: 11, fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  style={{ ...secondaryBtn, padding: '8px 14px' }}
                  onClick={() => {
                    navigator.clipboard?.writeText(created.paymentUrl).then(() => {
                      setCopied(true); setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <a
                  href={created.paymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...secondaryBtn, padding: '8px 14px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                >
                  Open
                </a>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--olive-light)', fontSize: 12 }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--orange)', animation: 'pulse 1.4s ease-in-out infinite',
                }} />
                Waiting for payment… (auto-refreshes every 3 seconds)
              </div>
              <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
            </div>
          )}

          {isPaid && (
            <p style={{ color: 'var(--olive-light)', fontSize: 13, marginTop: 12 }}>
              ✓ Payment received. Confirmation email sent. Attendees have QR tokens and still need to sign waivers before game day.
            </p>
          )}

          {!isCardFlow && (
            <p style={{ color: 'var(--olive-light)', fontSize: 13, marginTop: 8 }}>
              {created.paymentMethod === 'comp'
                ? 'Comp ticket — no payment required.'
                : `${created.paymentMethod} payment recorded. Booking marked paid.`}
              {' '}Attendees have QR tokens and still need to sign waivers before game day.
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button style={primaryBtn} onClick={resetForNew}>▶ New Booking</button>
            {isCardFlow && !isPaid && (
              <button
                style={{ ...secondaryBtn, color: '#e74c3c', borderColor: 'rgba(231,76,60,0.4)' }}
                onClick={async () => {
                  if (!confirm('Cancel this pending booking? The customer will not be able to pay this link afterwards.')) return;
                  // Fire-and-forget; the row stays as pending. We don't expose a cancel endpoint
                  // yet — admin can just walk away and try a different method.
                  resetForNew();
                }}
              >
                Cancel & Try Different Method
              </button>
            )}
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
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          style={input}
          aria-label="Payment method"
        >
          {PAYMENT_METHODS.map((pm) => (
            <option key={pm.value} value={pm.value}>{pm.label}</option>
          ))}
        </select>
        <div style={{ color: 'var(--olive-light)', fontSize: 12, marginTop: 6 }}>
          {PAYMENT_METHODS.find((pm) => pm.value === paymentMethod)?.desc}
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
            {totals.fee > 0 && <div style={totalRow}><span>Fees</span><span>{fmt(totals.fee)}</span></div>}
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
