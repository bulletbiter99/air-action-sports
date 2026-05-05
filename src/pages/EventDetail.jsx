import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import SEO from '../components/SEO';
import useCountdown from '../hooks/useCountdown';
import { siteConfig } from '../data/siteConfig';
import { fetchEventBySlug, useEvents } from '../hooks/useEvents';
import '../styles/pages/event-detail.css';
import '../styles/pages/rules-of-engagement.css';

export default function EventDetail() {
  const { slug } = useParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copyText, setCopyText] = useState('Copy Link');
  const { events: allEvents } = useEvents({ includePast: false });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchEventBySlug(slug)
      .then((e) => { if (alive) { setEvent(e); setLoading(false); } })
      .catch(() => { if (alive) { setEvent(null); setLoading(false); } });
    return () => { alive = false; };
  }, [slug]);

  const relatedEvents = (allEvents || [])
    .filter((e) => !e.past && e.slug !== slug && e.id !== slug)
    .slice(0, 2);

  if (loading) {
    return (
      <div className="page-content" style={{ textAlign: 'center', padding: '8rem 2rem' }}>
        <p className="section-sub">Loading event…</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page-content" style={{ textAlign: 'center', padding: '8rem 2rem' }}>
        <h1 className="section-title">Event Not Found</h1>
        <p className="section-sub">The event you're looking for doesn't exist or has been removed.</p>
        <Link to="/events" className="btn-primary">&#9658; View All Events</Link>
      </div>
    );
  }

  // Prefer the real ISO timestamp; fall back to an approximation from display fields.
  const eventDateISO = event.dateIso
    || (event.month
      ? `2026-${event.month === 'apr' ? '04' : event.month === 'may' ? '05' : event.month === 'jun' ? '06' : event.month === 'mar' ? '03' : '01'}-${String(event.date.day).padStart(2, '0')}T09:00:00`
      : '2026-04-19T09:00:00');

  const dateFull = event.date?.month
    ? `${event.date.month.replace(/\d{4}/, '').trim()} ${event.date.day}, ${event.date.month.match(/\d{4}/)?.[0] || '2026'}`
    : event.dateIso?.slice(0, 10) || '';

  return (
    <>
      <SEO
        title={`${event.title} — ${event.date.month.replace(' ', ' ')} ${event.date.day} | Air Action Sports`}
        description={`${event.title} — a full-day airsoft event at ${event.location.split(' —')[0] || event.location} on ${dateFull}. Book your place now.`}
        canonical={`https://airactionsport.com/events/${slug}`}
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Event Hero Banner */}
      <div
        className="event-hero"
        style={event.coverImageUrl ? {
          backgroundImage: `linear-gradient(rgba(20,20,20,0.55), rgba(20,20,20,0.75)), url("${event.coverImageUrl}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : undefined}
      >
        <div className="event-hero-content">
          <div className="event-hero-meta">
            <span className="event-hero-date">{dateFull}</span>
            <span className="event-hero-badge">
              {event.type.charAt(0).toUpperCase() + event.type.slice(1)}
            </span>
          </div>
          <h1>{event.title}</h1>
          <div className="event-hero-site">&#9679; {event.location}</div>
        </div>
      </div>

      {/* Main Content */}
      <div className="page-content">
        <div className="event-detail-grid">
          {/* Left Column — Event Details */}
          <div>
            {/* Schedule */}
            <div className="detail-section">
              <h2>Schedule</h2>
              <table className="pricing-table">
                <tbody>
                  <tr>
                    <td>Check-In</td>
                    <td>{event.checkIn || '—'}</td>
                  </tr>
                  <tr>
                    <td>First Game Starts</td>
                    <td>{event.firstGame || '—'} — TDM</td>
                  </tr>
                  <tr>
                    <td>End Time</td>
                    <td>{event.endTime || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mission Briefing */}
            <div className="detail-section">
              <h2>Mission Briefing</h2>
              <p>
                As twilight falls over {event.location.split(' —')[0] || 'the site'}, two factions prepare to clash in a high-stakes operation. {event.title} is a full-day airsoft event built around squad-based tactics and objective-driven gameplay. Expect fast rotations, flanking manoeuvres through buildings, and coordinated assaults on fortified positions.
              </p>
              <p>
                Teams will be briefed on mission objectives at staging. Communication, teamwork, and smart positioning will decide the outcome. Whether you're a seasoned operator or stepping onto the field for the first time, this event is designed to deliver intense, fair, and unforgettable gameplay from first light to last round.
              </p>
            </div>

            {/* Game Modes */}
            {event.gameModes && event.gameModes.length > 0 && (
              <div className="detail-section">
                <h2>Game Modes</h2>
                <ul>
                  {event.gameModes.map((mode, i) => (
                    <li key={i}>{mode}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* What's Included */}
            <div className="detail-section">
              <h2>What's Included</h2>
              <ul>
                <li>Full-day airsoft gameplay ({event.checkIn?.split('–')[0]?.trim() || '6:30 AM'} check-in through {event.endTime || '8:00 PM'})</li>
                <li>Safety briefing and equipment check</li>
                <li>Trained marshals on field</li>
                <li>Free parking</li>
                <li>Rental gear available (see below)</li>
              </ul>
            </div>

            {/* Rental Packages */}
            {event.rentals && event.rentals.length > 0 && (
              <div className="detail-section">
                <h2>Rental Packages</h2>
                <table className="pricing-table">
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.rentals.map((rental, i) => (
                      <tr key={i}>
                        <td>
                          <strong>{rental.name}</strong>
                          <br />
                          <span style={{ fontSize: '12px', color: 'var(--olive-light)' }}>{rental.description}</span>
                        </td>
                        <td>{rental.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* BB Purchases */}
            {event.bbPurchases && event.bbPurchases.length > 0 && (
              <div className="detail-section">
                <h2>BB Purchases</h2>
                <table className="pricing-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.bbPurchases.map((bb, i) => (
                      <tr key={i}>
                        <td>{bb.name}</td>
                        <td>{bb.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Admission Pricing */}
            <div className="detail-section">
              <h2>Admission</h2>
              <table className="pricing-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Individual (BYO gear)</td>
                    <td>{event.price.replace('/head', '')}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Rules & Requirements */}
            <div className="detail-section">
              <h2>Rules &amp; Requirements</h2>
              <ul>
                <li>Minimum age 12 (12&ndash;17 with parent/guardian on-site)</li>
                <li>ANSI Z87.1+ full-seal eye protection mandatory; full-face mask required for under-18</li>
                <li>FPS limits enforced by class (rifle 350, DMR/LMG 450, sniper 550 with .20g)</li>
                <li>Hits called honestly &mdash; honor system, marshals enforce</li>
                <li>No blind fire, no physical contact, no impaired play</li>
                <li>Completed waiver required (emailed after booking)</li>
              </ul>
              <div className="roe-callout">
                <strong>Read first</strong>
                <span>
                  Full weapon class breakdown, MEDs, and field conduct rules:{' '}
                  <Link to="/rules-of-engagement">Rules of Engagement</Link>
                </span>
              </div>
            </div>

            {/* Terrain */}
            <div className="detail-section">
              <h2>Terrain</h2>
              <p>
                {event.location.includes('Ghost Town')
                  ? 'Ghost Town features 19 buildings across a rural neighborhood setting with bunker systems and fortified objectives. The site offers varied engagement zones suited to both long-range and close-quarters play.'
                  : event.location.includes('Echo Urban')
                  ? 'Echo Urban is an indoor warehouse facility featuring multiple floors, narrow corridors, and purpose-built rooms for close-quarters combat training.'
                  : 'Foxtrot Fields is a 25-acre open field site with varied terrain zones and purpose-built staging areas.'}
              </p>
            </div>
          </div>

          {/* Right Column — Sidebar */}
          <div className="event-sidebar">
            {/* Mini Countdown */}
            <MiniCountdown targetDate={eventDateISO} />

            {/* Event Info Card */}
            <div className="info-card">
              <div className="info-card-title">Event Info</div>
              <div className="info-card-item">
                <span className="info-card-label">Date</span>
                <span className="info-card-value">{dateFull}</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">Check-In</span>
                <span className="info-card-value">{event.checkIn || event.time}</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">First Game</span>
                <span className="info-card-value">{event.firstGame || '—'}</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">End Time</span>
                <span className="info-card-value">{event.endTime || '—'}</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">Location</span>
                <span className="info-card-value">{event.location.split(' —')[0] || event.location.split(' \u2014')[0]}</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">Type</span>
                <span className="info-card-value">{event.type.charAt(0).toUpperCase() + event.type.slice(1)}</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">Slots</span>
                <span className="info-card-value">{event.slots.total} Players</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">Price From</span>
                <span className="info-card-value">{event.price}</span>
              </div>
              <div className="info-card-item">
                <span className="info-card-label">FPS Limit</span>
                <span className="info-card-value">350 / 500</span>
              </div>
            </div>

            {/* Book Now Button */}
            <Link
              to={siteConfig.bookingLink}
              className="form-submit"
              style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: '1.5rem' }}
            >
              &#9658; Book Now
            </Link>

            {/* Waiver Notice */}
            <p style={{ fontSize: '12px', color: 'var(--olive-light)', textAlign: 'center', marginBottom: '1.5rem' }}>
              Waiver will be emailed after booking
            </p>

            {/* Share Buttons */}
            <div className="share-btns">
              <a
                href={`https://www.facebook.com/sharer/sharer.php?u=https://airactionsport.com/events/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="share-btn"
              >
                Facebook
              </a>
              <a
                href={`https://wa.me/?text=Check%20out%20this%20airsoft%20event%3A%20https%3A%2F%2Fairactionsport.com%2Fevents%2F${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="share-btn"
              >
                WhatsApp
              </a>
              <button
                className="share-btn"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href).then(() => {
                    setCopyText('Copied!');
                    setTimeout(() => setCopyText('Copy Link'), 2000);
                  });
                }}
              >
                {copyText}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Related Events */}
      <section style={{ background: 'var(--mid)', padding: '5rem 2rem' }}>
        <div className="container">
          <div className="section-label">&#9632; More Upcoming Events</div>
          <h2 className="section-title">Other Operations.</h2>
          <div className="divider"></div>
          <div className="related-events">
            {relatedEvents.map((ev) => (
              <div className="event-card" key={ev.id}>
                <div className="event-header">
                  <div className="event-date">
                    <div className="event-day">{ev.date.day}</div>
                    <div className="event-month">{ev.date.month}</div>
                  </div>
                  <span className={`event-type ${ev.type}`}>
                    {ev.type.charAt(0).toUpperCase() + ev.type.slice(1)}
                  </span>
                </div>
                <div className="event-body">
                  <div className="event-title">{ev.title}</div>
                  <div className="event-loc">&#9679; {ev.location}</div>
                  <div className="event-meta">
                    <div className="event-meta-item"><strong>Time</strong>{ev.time}</div>
                    <div className="event-meta-item"><strong>Slots</strong>{ev.slots.total} Players</div>
                    <div className="event-meta-item"><strong>From</strong>{ev.price}</div>
                  </div>
                  <Link to={`/events/${ev.slug}`} className="btn-book">&#9658; View Details</Link>
                </div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: '2rem' }}>
            <Link
              to="/events"
              style={{
                color: 'var(--orange)',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                textDecoration: 'none',
              }}
            >
              View All Events &rarr;
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

/* Mini Countdown sub-component */
function MiniCountdown({ targetDate }) {
  const { days, hours, mins, secs } = useCountdown(targetDate);

  return (
    <div className="countdown-mini">
      <div className="countdown-mini-label">Starts In</div>
      <div className="countdown-mini-timer">
        <div className="cd-mini-block">
          <div className="cd-mini-num">{days}</div>
          <div className="cd-mini-unit">Days</div>
        </div>
        <div className="cd-mini-block">
          <div className="cd-mini-num">{hours}</div>
          <div className="cd-mini-unit">Hours</div>
        </div>
        <div className="cd-mini-block">
          <div className="cd-mini-num">{mins}</div>
          <div className="cd-mini-unit">Mins</div>
        </div>
        <div className="cd-mini-block">
          <div className="cd-mini-num">{secs}</div>
          <div className="cd-mini-unit">Secs</div>
        </div>
      </div>
    </div>
  );
}
