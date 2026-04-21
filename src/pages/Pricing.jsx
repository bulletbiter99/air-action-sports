import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { useEvents } from '../hooks/useEvents';
import '../styles/pages/pricing.css';

export default function Pricing() {
  const { events, loading } = useEvents({ includePast: false });
  const nextEvent = events[0] || null;

  return (
    <>
      <SEO
        title="Pricing | Air Action Sports"
        description="Transparent airsoft event pricing. Admission, rental packages, and BB purchases. No hidden fees."
        canonical="https://airactionsport.com/pricing"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Pricing Hero */}
      <div className="pricing-hero">
        <div className="section-label">&#9632; Pricing</div>
        <h1 className="section-title">No Hidden Fees. No Surprises.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          Transparent pricing for every type of player. Walk-in, rent, or bring your own gear &mdash; you know exactly what you're paying before you book.
        </p>
      </div>

      <div className="page-content">
        {loading && !nextEvent && (
          <p style={{ color: 'var(--olive-light)', textAlign: 'center', padding: '2rem' }}>Loading pricing…</p>
        )}
        {!loading && !nextEvent && (
          <p style={{ color: 'var(--olive-light)', textAlign: 'center', padding: '2rem' }}>
            No upcoming events right now. Check back soon.
          </p>
        )}
        {nextEvent && (
          <>
            {/* Event Title Banner */}
            <div className="pricing-event-banner">
              <div className="section-label">&#9632; Next Event</div>
              <h2 className="section-title">
                <Link to={`/events/${nextEvent.slug}`} style={{ color: 'var(--cream)', textDecoration: 'none' }}>
                  {nextEvent.title}
                </Link>
              </h2>
              <div className="divider"></div>
              <p className="pricing-event-details">
                {nextEvent.date.month.replace(/\d{4}/, '').trim()} {nextEvent.date.day}, {nextEvent.date.month.match(/\d{4}/)?.[0] || '2026'} &mdash; {nextEvent.location.split(' —')[0] || nextEvent.location.split(' \u2014')[0]}
              </p>
            </div>

            {/* Pricing Cards */}
            <div className="pricing-grid">
              {/* Admission Card */}
              <div className="price-card">
                <div className="price-header">
                  <div className="price-name">Admission</div>
                  <div className="price-amount">
                    {nextEvent.price.replace('/head', '')} <span>/per player</span>
                  </div>
                  <div className="price-desc">BYO gear &mdash; show up and play</div>
                </div>
                <ul className="price-features">
                  <li>Full-day gameplay ({nextEvent.checkIn?.split('–')[0]?.trim() || ''} &ndash; {nextEvent.endTime || ''})</li>
                  <li>Check-in: {nextEvent.checkIn || '—'}</li>
                  <li>First game: {nextEvent.firstGame || '—'}</li>
                  <li>Safety briefing &amp; equipment check</li>
                  <li>Trained marshals on field</li>
                  <li>Free parking</li>
                </ul>
                <div className="price-cta">
                  <Link to={`/events/${nextEvent.slug}`}>View Event Details</Link>
                </div>
              </div>

              {/* Rental Package Cards */}
              {nextEvent.rentals && nextEvent.rentals.map((rental, i) => (
                <div className={`price-card ${i === 0 ? 'featured' : ''}`} key={i}>
                  <div className="price-header">
                    <div className="price-name">{rental.name}</div>
                    <div className="price-amount">
                      {rental.price} <span>/per player</span>
                    </div>
                    <div className="price-desc">Rental package</div>
                  </div>
                  <ul className="price-features">
                    {rental.description.split(', ').map((item, j) => (
                      <li key={j}>{item.charAt(0).toUpperCase() + item.slice(1)}</li>
                    ))}
                  </ul>
                  <div className="price-cta">
                    <Link to={`/events/${nextEvent.slug}`}>View Event Details</Link>
                  </div>
                </div>
              ))}
            </div>

            {/* BB Purchases */}
            {nextEvent.bbPurchases && nextEvent.bbPurchases.length > 0 && (
              <div className="addon-section">
                <div className="section-label">&#9632; BB Purchases</div>
                <h2 className="section-title">Stock Up.</h2>
                <div className="divider"></div>
                <div className="addon-grid">
                  {nextEvent.bbPurchases.map((bb, i) => (
                    <div className="addon-item" key={i}>
                      <div>
                        <div className="addon-name">{bb.name}</div>
                        <div className="addon-detail">Available at check-in</div>
                      </div>
                      <div className="addon-price">{bb.price}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Game Modes */}
            {nextEvent.gameModes && nextEvent.gameModes.length > 0 && (
              <div className="addon-section">
                <div className="section-label">&#9632; Game Modes</div>
                <h2 className="section-title">What You'll Play.</h2>
                <div className="divider"></div>
                <div className="addon-grid">
                  {nextEvent.gameModes.map((mode, i) => (
                    <div className="addon-item" key={i}>
                      <div>
                        <div className="addon-name">{mode}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Note Box */}
        <div className="note-box">
          <strong>Please Note</strong>
          <p>All admission prices include full-day gameplay, safety briefing, and marshal support. Rental packages are separate from admission. Under 16s must be accompanied by a paying adult. A completed waiver is required and will be emailed to you after booking.</p>
        </div>
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Ready to Book?</h2>
        <p>Pick your event and lock in your slot.</p>
        <Link to="/events" className="btn-white">&#9658; View Events</Link>
      </div>
    </>
  );
}
