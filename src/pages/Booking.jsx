import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/booking.css';

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function Booking() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [taxesFees, setTaxesFees] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [step, setStep] = useState(1);

  const [ticketQtys, setTicketQtys] = useState({}); // { ttId: qty }
  const [addonQtys, setAddonQtys] = useState({});   // { sku: qty }

  const [buyer, setBuyer] = useState({ fullName: '', email: '', phone: '', referral: '' });
  const [attendees, setAttendees] = useState([]);
  const [useBuyerForFirst, setUseBuyerForFirst] = useState(true);

  const [promoCode, setPromoCode] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  // Load events + active taxes/fees
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/events', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/taxes-fees', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ taxesFees: [] })),
    ])
      .then(([ev, tf]) => {
        if (cancelled) return;
        setEvents(ev.events || []);
        setTaxesFees(tf.taxesFees || []);
        if (ev.events?.length === 1) setSelectedEventId(ev.events[0].id);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load events. Please refresh.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  // Sync attendees array with ticket quantities
  useEffect(() => {
    if (!selectedEvent) return;
    const expected = [];
    for (const [ttId, qty] of Object.entries(ticketQtys)) {
      for (let i = 0; i < qty; i++) expected.push({ ticketTypeId: ttId });
    }
    setAttendees((prev) => {
      const out = [];
      for (let i = 0; i < expected.length; i++) {
        const existing = prev[i];
        if (existing && existing.ticketTypeId === expected[i].ticketTypeId) out.push(existing);
        else out.push({ firstName: '', lastName: '', email: '', phone: '', ticketTypeId: expected[i].ticketTypeId, customAnswers: {} });
      }
      return out;
    });
  }, [ticketQtys, selectedEvent?.id]);

  // Mirror buyer → first attendee when toggle is on
  useEffect(() => {
    if (!useBuyerForFirst || attendees.length === 0) return;
    setAttendees((prev) => {
      if (prev.length === 0) return prev;
      const [first, ...rest] = prev;
      const parts = buyer.fullName.trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ');
      const updated = { ...first, firstName, lastName, email: buyer.email, phone: buyer.phone };
      return [updated, ...rest];
    });
  }, [buyer.fullName, buyer.email, buyer.phone, useBuyerForFirst, attendees.length]);

  const totalTickets = useMemo(
    () => Object.values(ticketQtys).reduce((a, b) => a + b, 0),
    [ticketQtys]
  );

  const totals = useMemo(() => {
    if (!selectedEvent) return { subtotalCents: 0, taxAndFeesCents: 0, totalCents: 0, totalAttendees: 0 };
    const ttMap = new Map(selectedEvent.ticketTypes.map((t) => [t.id, t]));
    const addonMap = new Map((selectedEvent.addons || []).map((a) => [a.sku, a]));
    let ticketsSubtotal = 0;
    let totalAttendees = 0;
    for (const [ttId, qty] of Object.entries(ticketQtys)) {
      const tt = ttMap.get(ttId);
      if (tt) { ticketsSubtotal += tt.priceCents * qty; totalAttendees += qty; }
    }
    let addonsSubtotal = 0;
    for (const [sku, qty] of Object.entries(addonQtys)) {
      const addon = addonMap.get(sku);
      if (addon) addonsSubtotal += addon.price_cents * qty;
    }
    const subtotal = ticketsSubtotal + addonsSubtotal;

    // Empty cart → show zeros. Per-order fixed fees (e.g., the Stripe-style
    // $0.30 processing fee) would otherwise leak in pre-selection because
    // their multiplier is 1 regardless of attendee count.
    if (subtotal === 0) {
      return { subtotalCents: 0, taxAndFeesCents: 0, totalCents: 0, totalAttendees };
    }

    const afterDiscount = subtotal; // promo applied server-side during checkout

    const unitMultiplier = (per) => per === 'ticket' || per === 'attendee' ? totalAttendees : 1;
    const baseFor = (applies) => applies === 'tickets' ? ticketsSubtotal
      : applies === 'addons' ? addonsSubtotal
      : afterDiscount;

    const taxes = taxesFees.filter((t) => t.category === 'tax')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const fees = taxesFees.filter((t) => t.category === 'fee')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    let taxCents = 0;
    for (const t of taxes) {
      const pct = Math.floor((baseFor(t.applies_to) * (t.percent_bps || 0)) / 10000);
      const fixed = (t.fixed_cents || 0) * unitMultiplier(t.per_unit);
      taxCents += pct + fixed;
    }
    let feeCents = 0;
    for (const f of fees) {
      const base = f.applies_to === 'tickets' ? ticketsSubtotal
        : f.applies_to === 'addons' ? addonsSubtotal
        : afterDiscount + taxCents;
      const pct = Math.floor((base * (f.percent_bps || 0)) / 10000);
      const fixed = (f.fixed_cents || 0) * unitMultiplier(f.per_unit);
      feeCents += pct + fixed;
    }

    return {
      subtotalCents: subtotal,
      taxAndFeesCents: taxCents + feeCents,
      totalCents: subtotal + taxCents + feeCents,
      totalAttendees,
    };
  }, [ticketQtys, addonQtys, selectedEvent, taxesFees]);

  const setTicketQty = (ttId, qty) => {
    setTicketQtys((p) => ({ ...p, [ttId]: Math.max(0, qty) }));
  };
  const setAddonQty = (sku, qty) => {
    setAddonQtys((p) => ({ ...p, [sku]: Math.max(0, qty) }));
  };

  const updateAttendee = (index, field, value) => {
    setAttendees((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  };

  const updateAttendeeAnswer = (index, key, value) => {
    setAttendees((prev) => prev.map((a, i) => (
      i === index ? { ...a, customAnswers: { ...(a.customAnswers || {}), [key]: value } } : a
    )));
  };

  // Validation per step
  const validateStep1 = () => {
    const errs = {};
    if (!selectedEventId) errs.event = 'Please choose an event.';
    if (totalTickets < 1) errs.tickets = 'Select at least 1 ticket.';
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const validateStep2 = () => {
    const errs = {};
    if (!buyer.fullName.trim()) errs.fullName = 'Required.';
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim());
    if (!emailOk) errs.email = 'Valid email required.';
    if (buyer.phone.replace(/\D/g, '').length < 7) errs.phone = 'Valid phone required.';
    attendees.forEach((a, i) => {
      if (!a.firstName.trim()) errs[`att_${i}_firstName`] = 'Required.';
    });
    const questions = selectedEvent?.customQuestions || [];
    for (const q of questions) {
      if (!q.required) continue;
      attendees.forEach((a, i) => {
        const v = (a.customAnswers || {})[q.key];
        if (v === undefined || v === null || String(v).trim() === '') {
          errs[`att_${i}_q_${q.key}`] = 'Required.';
        }
      });
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const goNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goBack = () => {
    setStep((s) => Math.max(1, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/bookings/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedEventId,
          buyer,
          attendees,
          addonSelections: Object.entries(addonQtys)
            .filter(([, q]) => q > 0)
            .map(([sku, qty]) => ({ sku, qty })),
          promoCode: promoCode.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = data.stripeUrl;
    } catch {
      setError('Network error — please try again.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-content"><p style={{ color: 'var(--olive-light)' }}>Loading events…</p></div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="page-content">
        <div className="section-label">&#9632; Book Your Battle</div>
        <h1 className="section-title">No events on the books.</h1>
        <div className="divider"></div>
        <p className="section-sub">We're planning the next drop. Check back soon or <Link to="/contact" style={{ color: 'var(--orange)' }}>drop us a line</Link> to get notified.</p>
      </div>
    );
  }

  return (
    <>
      <SEO
        title="Book Your Battle | Air Action Sports"
        description="Book your next airsoft event with Air Action Sports. Pick your event, ticket, and gear rentals — secure checkout."
        canonical="https://airactionsport.com/booking"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      <div className="page-content">
        <div className="section-label">&#9632; Book Your Battle</div>
        <h1 className="section-title">Mission Briefing.</h1>
        <div className="divider"></div>

        {/* Stepper */}
        <div className="booking-stepper">
          <Step num={1} label="Event & Tickets" active={step === 1} done={step > 1} />
          <Step num={2} label="Players & Contact" active={step === 2} done={step > 2} />
          <Step num={3} label="Review & Pay" active={step === 3} done={false} />
        </div>

        {error && <div className="booking-error">{error}</div>}

        {step === 1 && (
          <StepTicketsAndAddons
            events={events}
            selectedEvent={selectedEvent}
            selectedEventId={selectedEventId}
            setSelectedEventId={setSelectedEventId}
            ticketQtys={ticketQtys}
            setTicketQty={setTicketQty}
            addonQtys={addonQtys}
            setAddonQty={setAddonQty}
            totals={totals}
            validationErrors={validationErrors}
          />
        )}

        {step === 2 && selectedEvent && (
          <StepPlayersAndContact
            buyer={buyer}
            setBuyer={setBuyer}
            attendees={attendees}
            updateAttendee={updateAttendee}
            updateAttendeeAnswer={updateAttendeeAnswer}
            useBuyerForFirst={useBuyerForFirst}
            setUseBuyerForFirst={setUseBuyerForFirst}
            ticketTypes={selectedEvent.ticketTypes}
            customQuestions={selectedEvent.customQuestions || []}
            validationErrors={validationErrors}
          />
        )}

        {step === 3 && selectedEvent && (
          <StepReview
            event={selectedEvent}
            ticketQtys={ticketQtys}
            addonQtys={addonQtys}
            buyer={buyer}
            attendees={attendees}
            promoCode={promoCode}
            setPromoCode={setPromoCode}
            message={message}
            setMessage={setMessage}
            totals={totals}
            submitting={submitting}
            onSubmit={handleSubmit}
          />
        )}

        {/* Nav buttons */}
        <div className="booking-nav">
          {step > 1 && (
            <button type="button" className="btn-secondary" onClick={goBack} disabled={submitting}>
              &laquo; Back
            </button>
          )}
          {step < 3 && (
            <button type="button" className="btn-primary" onClick={goNext}>
              Continue &#9658;
            </button>
          )}
        </div>
      </div>

      {/* Private Hire (kept from original) */}
      <section className="private-hire">
        <div className="container">
          <div className="section-label">&#9632; Private Hire</div>
          <h2 className="section-title">Exclusive Site Hire.</h2>
          <div className="divider"></div>
          <p className="section-sub" style={{ marginBottom: '1.5rem' }}>
            Looking to book an entire site for your group? We offer exclusive private hire for corporate team-building days, birthday battles, and special occasions.
          </p>
          <div className="private-hire-features">
            <div className="private-hire-feature">&#9632; Full Site Exclusive</div>
            <div className="private-hire-feature">&#9632; Custom Game Modes</div>
            <div className="private-hire-feature">&#9632; Dedicated Marshals</div>
          </div>
          <Link to="/contact" className="btn-primary" style={{ display: 'inline-block', marginTop: '1rem' }}>
            &#9658; Enquire About Private Hire
          </Link>
        </div>
      </section>
    </>
  );
}

function Step({ num, label, active, done }) {
  return (
    <div className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
      <div className="step-num">{done ? '✓' : num}</div>
      <div className="step-label">{label}</div>
    </div>
  );
}

function QtyControl({ value, onChange, max = 99, disabled }) {
  return (
    <div className="qty-control">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={disabled || value <= 0}>−</button>
      <span className="qty-value">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max}>+</button>
    </div>
  );
}

function StepTicketsAndAddons({
  events, selectedEvent, selectedEventId, setSelectedEventId,
  ticketQtys, setTicketQty, addonQtys, setAddonQty, totals, validationErrors,
}) {
  return (
    <>
      {/* Selected-event banner — shown for both single + multi event modes
          so the user always sees what they're booking. */}
      {selectedEvent && (
        <div
          className="booking-event-banner"
          style={
            (selectedEvent.bannerImageUrl || selectedEvent.coverImageUrl)
              ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.85) 100%), url(${selectedEvent.bannerImageUrl || selectedEvent.coverImageUrl})` }
              : undefined
          }
        >
          <div className="booking-event-banner-meta">
            <div className="booking-event-banner-date">
              {selectedEvent.displayDay} {selectedEvent.displayMonth}
            </div>
            <div className="booking-event-banner-title">{selectedEvent.title}</div>
            <div className="booking-event-banner-loc">&#9679; {selectedEvent.location}</div>
            {selectedEvent.shortDescription && (
              <div className="booking-event-banner-desc">{selectedEvent.shortDescription}</div>
            )}
            <div className="booking-event-banner-time">
              {selectedEvent.checkIn || selectedEvent.timeRange} &mdash; {selectedEvent.basePriceDisplay}
            </div>
          </div>
        </div>
      )}

      {events.length > 1 && (
        <div className="booking-section">
          <h3 className="booking-section-title">Choose Event</h3>
          <div className="event-cards">
            {events.map((ev) => (
              <button
                type="button"
                key={ev.id}
                className={`event-card-select ${selectedEventId === ev.id ? 'selected' : ''}`}
                onClick={() => setSelectedEventId(ev.id)}
              >
                <div className="event-date">{ev.displayDay} {ev.displayMonth}</div>
                <div className="event-name">{ev.title}</div>
                <div className="event-loc">{ev.location}</div>
                <div className="event-price">{ev.basePriceDisplay}</div>
              </button>
            ))}
          </div>
          {validationErrors.event && <div className="form-error visible">{validationErrors.event}</div>}
        </div>
      )}

      {selectedEvent && (
        <>
          <div className="booking-section">
            <h3 className="booking-section-title">
              Tickets
              <span className="booking-section-sub"> &mdash; pick how many players, then continue</span>
            </h3>

            <div className="selector-group">
              <div className="selector-label">Tickets</div>
              {selectedEvent.ticketTypes.map((tt) => (
                <div key={tt.id} className="select-row">
                  <div className="select-info">
                    <div className="select-name">{tt.name}</div>
                    {tt.description && <div className="select-desc">{tt.description}</div>}
                    <div className="select-meta">
                      <strong>{tt.priceDisplay}</strong>
                      {tt.remaining != null && <span className="remaining"> · {tt.remaining} left</span>}
                      {tt.soldOut && <span className="sold-out"> · Sold out</span>}
                    </div>
                  </div>
                  <QtyControl
                    value={ticketQtys[tt.id] || 0}
                    onChange={(q) => setTicketQty(tt.id, q)}
                    max={tt.maxPerOrder || 99}
                    disabled={tt.soldOut}
                  />
                </div>
              ))}
              {validationErrors.tickets && <div className="form-error visible">{validationErrors.tickets}</div>}
            </div>

            {selectedEvent.addons && selectedEvent.addons.length > 0 && (
              <div className="selector-group">
                <div className="selector-label">Add-ons & Rentals</div>
                {selectedEvent.addons.map((addon) => (
                  <div key={addon.sku} className="select-row">
                    <div className="select-info">
                      <div className="select-name">
                        {addon.name}
                        {addon.type === 'rental' && <span className="badge-rental"> Rental</span>}
                      </div>
                      {addon.description && <div className="select-desc">{addon.description}</div>}
                      <div className="select-meta">
                        <strong>${(addon.price_cents / 100).toFixed(2)}</strong>
                      </div>
                    </div>
                    <QtyControl
                      value={addonQtys[addon.sku] || 0}
                      onChange={(q) => setAddonQty(addon.sku, q)}
                      max={addon.max_per_order || 99}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="order-summary sticky">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{fmt(totals.subtotalCents)}</span>
            </div>
            {totals.taxAndFeesCents > 0 && (
              <div className="summary-row"><span>Taxes &amp; Fees</span><span>{fmt(totals.taxAndFeesCents)}</span></div>
            )}
            <div className="summary-row total">
              <span>Total</span>
              <span>{fmt(totals.totalCents)}</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function StepPlayersAndContact({
  buyer, setBuyer, attendees, updateAttendee, updateAttendeeAnswer,
  useBuyerForFirst, setUseBuyerForFirst, ticketTypes, customQuestions, validationErrors,
}) {
  const ttById = new Map(ticketTypes.map((t) => [t.id, t]));
  return (
    <>
      <div className="booking-section">
        <h3 className="booking-section-title">Your Contact Info</h3>
        <p className="booking-section-desc">We'll send your confirmation and waiver links here.</p>
        <div className="form-row">
          <div className={`form-group${validationErrors.fullName ? ' error' : ''}`}>
            <label className="form-label">Full Name *</label>
            <input className="form-input" value={buyer.fullName}
              onChange={(e) => setBuyer({ ...buyer, fullName: e.target.value })} />
            {validationErrors.fullName && <span className="form-error">{validationErrors.fullName}</span>}
          </div>
          <div className={`form-group${validationErrors.email ? ' error' : ''}`}>
            <label className="form-label">Email *</label>
            <input type="email" className="form-input" value={buyer.email}
              onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
            {validationErrors.email && <span className="form-error">{validationErrors.email}</span>}
          </div>
        </div>
        <div className="form-row">
          <div className={`form-group${validationErrors.phone ? ' error' : ''}`}>
            <label className="form-label">Phone *</label>
            <input type="tel" className="form-input" value={buyer.phone}
              onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} />
            {validationErrors.phone && <span className="form-error">{validationErrors.phone}</span>}
          </div>
          <div className="form-group">
            <label className="form-label">How did you hear about us?</label>
            <select className="form-select" value={buyer.referral}
              onChange={(e) => setBuyer({ ...buyer, referral: e.target.value })}>
              <option value="">Select…</option>
              <option value="google">Google</option>
              <option value="social-media">Social Media</option>
              <option value="word-of-mouth">Word of Mouth</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      </div>

      <div className="booking-section">
        <h3 className="booking-section-title">Player Details</h3>
        <p className="booking-section-desc">
          Each player will receive their own waiver link to sign before game day.
        </p>

        {attendees.length > 0 && (
          <label className="checkbox-row">
            <input type="checkbox" checked={useBuyerForFirst}
              onChange={(e) => setUseBuyerForFirst(e.target.checked)} />
            <span>First player is me (auto-fill from contact info)</span>
          </label>
        )}

        {attendees.map((att, i) => {
          const tt = ttById.get(att.ticketTypeId);
          const locked = i === 0 && useBuyerForFirst;
          return (
            <div key={i} className={`attendee-card${locked ? ' locked' : ''}`}>
              <div className="attendee-head">
                <strong>Player {i + 1}</strong>
                {tt && <span className="attendee-ticket">{tt.name}</span>}
              </div>
              <div className="form-row">
                <div className={`form-group${validationErrors[`att_${i}_firstName`] ? ' error' : ''}`}>
                  <label className="form-label">First name *</label>
                  <input className="form-input" disabled={locked} value={att.firstName}
                    onChange={(e) => updateAttendee(i, 'firstName', e.target.value)} />
                  {validationErrors[`att_${i}_firstName`] && (
                    <span className="form-error">{validationErrors[`att_${i}_firstName`]}</span>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Last name</label>
                  <input className="form-input" disabled={locked} value={att.lastName}
                    onChange={(e) => updateAttendee(i, 'lastName', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Email (optional)</label>
                  <input type="email" className="form-input" disabled={locked} value={att.email}
                    onChange={(e) => updateAttendee(i, 'email', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone (optional)</label>
                  <input type="tel" className="form-input" disabled={locked} value={att.phone}
                    onChange={(e) => updateAttendee(i, 'phone', e.target.value)} />
                </div>
              </div>

              {customQuestions.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(200,184,154,0.1)' }}>
                  {customQuestions.map((q) => {
                    const errKey = `att_${i}_q_${q.key}`;
                    const err = validationErrors[errKey];
                    const answer = (att.customAnswers || {})[q.key] ?? '';
                    return (
                      <div key={q.key} className={`form-group${err ? ' error' : ''}`}>
                        <label className="form-label">
                          {q.label}{q.required ? ' *' : ''}
                        </label>
                        {q.type === 'textarea' ? (
                          <textarea className="form-textarea" rows={3} value={answer}
                            onChange={(e) => updateAttendeeAnswer(i, q.key, e.target.value)} />
                        ) : q.type === 'select' ? (
                          <select className="form-select" value={answer}
                            onChange={(e) => updateAttendeeAnswer(i, q.key, e.target.value)}>
                            <option value="">Select…</option>
                            {(q.options || []).map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : q.type === 'checkbox' ? (
                          <label className="checkbox-row">
                            <input type="checkbox" checked={!!answer}
                              onChange={(e) => updateAttendeeAnswer(i, q.key, e.target.checked ? 'yes' : '')} />
                            <span>{q.label}</span>
                          </label>
                        ) : (
                          <input className="form-input" value={answer}
                            onChange={(e) => updateAttendeeAnswer(i, q.key, e.target.value)} />
                        )}
                        {err && <span className="form-error">{err}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function StepReview({
  event, ticketQtys, addonQtys, buyer, attendees,
  promoCode, setPromoCode, message, setMessage,
  totals, submitting, onSubmit,
}) {
  const ttById = new Map(event.ticketTypes.map((t) => [t.id, t]));
  const addonBySku = new Map((event.addons || []).map((a) => [a.sku, a]));
  return (
    <>
      <div className="booking-section">
        <h3 className="booking-section-title">Review Your Order</h3>

        <div className="review-block">
          <div className="review-heading">Event</div>
          <div>{event.title} · {event.displayDate}</div>
          <div className="review-sub">{event.location}</div>
          <div className="review-sub">{event.timeRange}</div>
        </div>

        <div className="review-block">
          <div className="review-heading">Tickets</div>
          {Object.entries(ticketQtys).filter(([, q]) => q > 0).map(([ttId, qty]) => {
            const tt = ttById.get(ttId);
            if (!tt) return null;
            return (
              <div key={ttId} className="review-line">
                <span>{qty} × {tt.name}</span>
                <span>{fmt(tt.priceCents * qty)}</span>
              </div>
            );
          })}
        </div>

        {Object.values(addonQtys).some((q) => q > 0) && (
          <div className="review-block">
            <div className="review-heading">Add-ons</div>
            {Object.entries(addonQtys).filter(([, q]) => q > 0).map(([sku, qty]) => {
              const addon = addonBySku.get(sku);
              if (!addon) return null;
              return (
                <div key={sku} className="review-line">
                  <span>{qty} × {addon.name}</span>
                  <span>{fmt(addon.price_cents * qty)}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="review-block">
          <div className="review-heading">Players</div>
          {attendees.map((a, i) => (
            <div key={i} className="review-line">
              <span>Player {i + 1}: {a.firstName} {a.lastName}</span>
              <span className="review-sub">{ttById.get(a.ticketTypeId)?.name}</span>
            </div>
          ))}
        </div>

        <div className="review-block">
          <div className="review-heading">Contact</div>
          <div>{buyer.fullName}</div>
          <div className="review-sub">{buyer.email} · {buyer.phone}</div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Promo Code (optional)</label>
            <input className="form-input" value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="Enter code" />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Message / Special Requests (optional)</label>
          <textarea className="form-textarea" rows={3} value={message}
            onChange={(e) => setMessage(e.target.value)} />
        </div>
      </div>

      <div className="order-summary">
        <div className="summary-row"><span>Subtotal</span><span>{fmt(totals.subtotalCents)}</span></div>
        {totals.taxAndFeesCents > 0 && <div className="summary-row"><span>Taxes &amp; Fees</span><span>{fmt(totals.taxAndFeesCents)}</span></div>}
        <div className="summary-row total"><span>Total</span><span>{fmt(totals.totalCents)}</span></div>
        <p className="summary-note">You'll be redirected to Stripe to complete payment. Your booking will be confirmed once payment succeeds.</p>
        <button type="button" className="form-submit" onClick={onSubmit} disabled={submitting}>
          {submitting ? 'Redirecting to Stripe…' : `▶ Pay ${fmt(totals.totalCents)}`}
        </button>
      </div>
    </>
  );
}
