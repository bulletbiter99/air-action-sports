import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/booking.css';

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function BookingSuccess() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [booking, setBooking] = useState(null);
  const [event, setEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pollingLeft, setPollingLeft] = useState(10);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    let attempts = 0;

    async function load() {
      try {
        const res = await fetch(`/api/bookings/${token}`);
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        if (cancelled) return;
        setBooking(data.booking);
        setEvent(data.event);
        setAttendees(data.attendees || []);
        setLoading(false);

        // Webhook may take a beat — poll a few times if still pending
        if (data.booking.status === 'pending' && attempts < 10) {
          attempts++;
          setPollingLeft(10 - attempts);
          setTimeout(load, 1500);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  if (!token) {
    return (
      <div className="page-content">
        <h1 className="section-title">No booking found.</h1>
        <Link to="/booking" className="btn-primary" style={{ display: 'inline-block', marginTop: '1rem' }}>
          &#9658; Back to Booking
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-content">
        <p style={{ color: 'var(--olive-light)' }}>Confirming your booking…</p>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="page-content">
        <h1 className="section-title">Booking not found.</h1>
        <p style={{ color: 'var(--olive-light)' }}>Check the link and try again, or contact us.</p>
      </div>
    );
  }

  const isPaid = booking.status === 'paid';

  return (
    <>
      <SEO title="Booking Confirmed | Air Action Sports" canonical="https://airactionsport.com/booking/success" />
      <div className="page-content">
        <div className="section-label">&#9632; {isPaid ? 'Mission Confirmed' : 'Processing'}</div>
        <h1 className="section-title">{isPaid ? 'You\'re in.' : 'Finalizing payment…'}</h1>
        <div className="divider"></div>

        {!isPaid && (
          <div className="booking-error" style={{ background: 'rgba(212,84,26,0.1)', color: 'var(--tan-light)', borderColor: 'rgba(212,84,26,0.3)' }}>
            Payment confirmation is still being processed by Stripe. This usually takes a few seconds. Polling {pollingLeft} more times…
          </div>
        )}

        {event && (
          <div className="booking-section">
            <h3 className="booking-section-title">{event.title}</h3>
            <div className="review-sub">{event.displayDate} · {event.location} · {event.timeRange}</div>
          </div>
        )}

        <div className="booking-section">
          <h3 className="booking-section-title">Your Order</h3>
          {booking.lineItems.map((item, i) => (
            <div key={i} className="review-line">
              <span>{item.qty} × {item.name}</span>
              <span>{fmt(item.line_total_cents)}</span>
            </div>
          ))}
          <div className="review-line" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(200,184,154,0.15)' }}>
            <strong>Total paid</strong>
            <strong>{fmt(booking.totalCents)}</strong>
          </div>
          <div className="review-sub" style={{ marginTop: '0.5rem' }}>
            Booking ID: <code style={{ color: 'var(--tan)' }}>{booking.id}</code>
          </div>
        </div>

        {attendees.length > 0 && (
          <div className="booking-section">
            <h3 className="booking-section-title">Players &amp; Waivers</h3>
            {(() => {
              const signedCount = attendees.filter((a) => a.waiverSigned).length;
              const totalCount = attendees.length;
              if (signedCount === totalCount) {
                return (
                  <p className="booking-section-desc" style={{ color: '#7ed99b' }}>
                    &#10003; All {totalCount} player{totalCount === 1 ? '' : 's'} already have a valid waiver on file. You&rsquo;re cleared for game day &mdash; nothing to sign.
                  </p>
                );
              }
              if (signedCount > 0) {
                return (
                  <p className="booking-section-desc">
                    {signedCount} of {totalCount} player{totalCount === 1 ? '' : 's'} already have a valid waiver on file. The remaining player{(totalCount - signedCount) === 1 ? '' : 's'} need{(totalCount - signedCount) === 1 ? 's' : ''} to sign before game day &mdash; share the link below.
                  </p>
                );
              }
              return (
                <p className="booking-section-desc">
                  Each player needs to sign a waiver before game day. Share the link below with each player.
                </p>
              );
            })()}
            {attendees.map((a) => {
              const expiresDate = a.waiverExpiresAt
                ? new Date(a.waiverExpiresAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                : null;
              return (
                <div key={a.id} className="review-line" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div>{a.firstName} {a.lastName}</div>
                    {a.waiverSigned && expiresDate && (
                      <div style={{ fontSize: 11, color: 'var(--olive-light)', marginTop: 2 }}>
                        Waiver on file &middot; valid through {expiresDate}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {a.waiverSigned ? (
                      <span style={{ color: '#7ed99b', fontWeight: 700, alignSelf: 'center', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
                        &#10003; On file
                      </span>
                    ) : (
                      <a href={`/waiver?token=${a.qrToken}`} className="btn-secondary" style={{ padding: '6px 14px', fontSize: '11px' }}>
                        Sign Waiver
                      </a>
                    )}
                    <a
                      href={`/booking/ticket?token=${a.qrToken}&auto=0`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                      style={{ padding: '6px 14px', fontSize: '11px' }}
                    >&darr; Ticket PDF</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ color: 'var(--olive-light)', fontSize: '13px', marginTop: '2rem' }}>
          A confirmation email has been sent to <strong>{booking.email}</strong>. Questions? Just reply to it.
        </p>

        <Link to="/" className="btn-primary" style={{ display: 'inline-block', marginTop: '1.5rem' }}>
          &#9658; Back to Home
        </Link>
      </div>
    </>
  );
}
