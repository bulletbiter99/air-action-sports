import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import SEO from '../components/SEO';
import useCountdown from '../hooks/useCountdown';
import { events } from '../data/events';
import '../styles/pages/event-detail.css';

export default function EventDetail() {
  const { slug } = useParams();
  const event = events.find((e) => e.id === slug);
  const [copyText, setCopyText] = useState('Copy Link');

  // Get related events (other upcoming events, excluding this one)
  const relatedEvents = events
    .filter((e) => !e.past && e.id !== slug)
    .slice(0, 2);

  if (!event) {
    return (
      <div className="page-content" style={{ textAlign: 'center', padding: '8rem 2rem' }}>
        <h1 className="section-title">Event Not Found</h1>
        <p className="section-sub">The event you're looking for doesn't exist or has been removed.</p>
        <Link to="/events" className="btn-primary">&#9658; View All Events</Link>
      </div>
    );
  }

  // Derive full date and ISO from data
  const eventDateISO = event.date.month
    ? `2026-${event.month === 'apr' ? '04' : event.month === 'may' ? '05' : event.month === 'jun' ? '06' : event.month === 'mar' ? '03' : '01'}-${String(event.date.day).padStart(2, '0')}T09:00:00`
    : '2026-04-19T09:00:00';

  const dateFull = `${event.date.month.replace(/\d{4}/, '').trim()} ${event.date.day}, ${event.date.month.match(/\d{4}/)?.[0] || '2026'}`;

  return (
    <>
      <SEO
        title={`${event.title} — ${event.date.month.replace(' ', ' ')} ${event.date.day} | Air Action Sports`}
        description={`${event.title} — a full-day airsoft event at ${event.location.split(' —')[0] || event.location} on ${dateFull}. Book your place now.`}
        canonical={`https://airactionsport.com/events/${slug}`}
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Event Hero Banner */}
      <div className="event-hero">
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

            {/* What's Included */}
            <div className="detail-section">
              <h2>What's Included</h2>
              <ul>
                <li>Full-day airsoft gameplay</li>
                <li>Safety briefing and equipment check</li>
                <li>Trained marshals on field</li>
                <li>Tea/coffee at staging area</li>
                <li>Free parking</li>
                <li>Gear hire available (additional cost)</li>
              </ul>
            </div>

            {/* Rules & Requirements */}
            <div className="detail-section">
              <h2>Rules &amp; Requirements</h2>
              <ul>
                <li>Minimum age 12 (under 16 with adult)</li>
                <li>Full face protection mandatory</li>
                <li>FPS limits strictly enforced (350 AEG / 500 bolt-action)</li>
                <li>No blind firing</li>
                <li>No physical contact</li>
                <li>Completed <Link to="/waiver" style={{ color: 'var(--orange)' }}>waiver</Link> required</li>
              </ul>
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

            {/* Pricing */}
            <div className="detail-section">
              <h2>Pricing</h2>
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
                  <tr>
                    <td>Individual + Gear Hire</td>
                    <td>${parseInt(event.price.replace(/[^0-9]/g, '')) + 15}</td>
                  </tr>
                  <tr>
                    <td>Group 5-9 (per head)</td>
                    <td>${parseInt(event.price.replace(/[^0-9]/g, '')) - 5}</td>
                  </tr>
                  <tr>
                    <td>Group 10+ (per head)</td>
                    <td>${parseInt(event.price.replace(/[^0-9]/g, '')) - 10}</td>
                  </tr>
                </tbody>
              </table>
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
                <span className="info-card-label">Time</span>
                <span className="info-card-value">{event.time}</span>
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
              to="/booking"
              className="form-submit"
              style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: '1.5rem' }}
            >
              &#9658; Book Now
            </Link>

            {/* Waiver Link */}
            <p style={{ fontSize: '12px', color: 'var(--olive-light)', textAlign: 'center', marginBottom: '1.5rem' }}>
              All players must complete the <Link to="/waiver" style={{ color: 'var(--orange)' }}>waiver</Link>
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
                  <Link to="/booking" className="btn-book">&#9658; Book Slot</Link>
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
