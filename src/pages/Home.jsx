import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import TickerBar from '../components/TickerBar';
import CountdownTimer from '../components/CountdownTimer';
import { siteConfig } from '../data/siteConfig';
import { useEvents } from '../hooks/useEvents';
import { locations } from '../data/locations';
import { testimonials } from '../data/testimonials';
import '../styles/pages/home.css';

const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function countdownLabel(ev) {
  if (!ev?.dateIso) return ev?.title || '';
  const d = new Date(ev.dateIso);
  if (Number.isNaN(d.getTime())) return ev.title;
  const loc = (ev.location || '').split(/\s*[—–-]\s/)[0].trim();
  const dateStr = `${MONTH_NAME[d.getMonth()]} ${d.getDate()}`;
  return loc ? `${ev.title} — ${loc}, ${dateStr}` : `${ev.title} — ${dateStr}`;
}

export default function Home() {
  const { events } = useEvents({ includePast: false });
  const upcomingEvents = events.slice(0, 2);
  const featuredEvent = events[0] || null;

  return (
    <>
      <SEO
        title="Air Action Sports — Airsoft Events Across Multiple Elite Outdoor Sites"
        description="Air Action Sports runs tactical airsoft events across multiple outdoor sites. Milsim, skirmish, and private hire. Book your next battle today."
        canonical="https://airactionsport.com/"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      >
        {/* Schema.org — LocalBusiness */}
        <script type="application/ld+json">{`
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Air Action Sports",
  "description": "Tactical airsoft events across multiple elite outdoor sites. Milsim, skirmish, and private hire.",
  "url": "https://airactionsport.com",
  "telephone": "+1-801-833-5127",
  "email": "actionairsport@gmail.com",
  "sameAs": [
    "https://www.facebook.com/groups/2545278778822344/",
    "https://www.instagram.com/kaysaircombat/"
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.9",
    "reviewCount": "50"
  }
}
        `}</script>
        {/* Schema.org — Event (Operation Nightfall) */}
        <script type="application/ld+json">{`
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Operation Nightfall",
  "description": "Tactical airsoft event at Ghost Town site. Full-day gameplay with milsim and skirmish modes.",
  "startDate": "2026-05-09T09:00:00",
  "endDate": "2026-05-09T17:00:00",
  "eventStatus": "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "location": {
    "@type": "Place",
    "name": "Ghost Town — Rural Neighborhood",
    "address": "Utah, United States"
  },
  "organizer": {
    "@type": "Organization",
    "name": "Air Action Sports",
    "url": "https://airactionsport.com"
  },
  "offers": {
    "@type": "Offer",
    "price": "35",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://airactionsport.com/booking.html"
  }
}
        `}</script>
      </SEO>

      {/* GA4 placeholder — replace G-XXXXXXXXXX with real Measurement ID */}

      <TickerBar />

      {/* ============================================================
          HERO SECTION
          ============================================================ */}
      <div className="hero">
        <div
          className="hero-bg-photo"
          style={(featuredEvent?.heroImageUrl || featuredEvent?.coverImageUrl) ? {
            backgroundImage: `url("${featuredEvent.heroImageUrl || featuredEvent.coverImageUrl}")`,
          } : undefined}
        ></div>
        <div className="hero-grid-overlay"></div>
        <div className="hero-content">
          <div className="hero-badge">&#9632; Live Field Operations &#9632;</div>
          <h1>Live Airsoft<span>Events</span></h1>
          <p className="hero-sub">
            Real terrain. Real tactics. Real fun.<br />
            Airsoft events across multiple elite outdoor sites.
          </p>
          <div className="hero-btns">
            <Link to={siteConfig.bookingLink} className="btn-primary">&#9658; Book Your Battle</Link>
            <Link to="/events" className="btn-secondary">View Upcoming Events</Link>
          </div>
          <div className="hero-stats">
            <div className="stat">
              <div className="stat-num">5+</div>
              <div className="stat-label">Battle Sites</div>
            </div>
            <div className="stat">
              <div className="stat-num">2k+</div>
              <div className="stat-label">Players Deployed</div>
            </div>
            <div className="stat">
              <div className="stat-num">50+</div>
              <div className="stat-label">Events Run</div>
            </div>
            <div className="stat">
              <div className="stat-num">4.9</div>
              <div className="stat-label">Avg. Rating</div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          COUNTDOWN TIMER — sourced from the next upcoming event in D1.
          Hidden entirely when no upcoming events exist.
          ============================================================ */}
      {featuredEvent && (
        <div className="countdown-band">
          <div className="countdown-label">&#9632; Next Mission Launches In &#9632;</div>
          <div className="countdown-event-name">
            {countdownLabel(featuredEvent)}
          </div>
          <CountdownTimer targetDate={featuredEvent.dateIso} />
          <div className="countdown-sub">&#9632; Limited slots available &mdash; secure your position now &#9632;</div>
        </div>
      )}

      {/* ============================================================
          ABOUT SECTION
          ============================================================ */}
      <section className="about" id="about">
        <div className="container">
          <div className="about-grid">
            <div>
              <div className="section-label fade-in">&#9632; Who We Are</div>
              <h2 className="section-title">Built by players,<br />run for players.</h2>
              <div className="divider"></div>
              <p className="section-sub">
                Air Action Sports was born in the field. We're a crew of hardcore airsoft enthusiasts who wanted more than just a casual skirmish. We built a multi-site operation that delivers elite-level gameplay experiences &mdash; from urban close-quarters combat to wide-open woodland warfare.
              </p>
            </div>
            <div className="about-visual">
              <div className="about-card">
                <div className="about-card-icon">&#127959;</div>
                <div className="about-card-title">Urban CQB</div>
              </div>
              <div className="about-card">
                <div className="about-card-icon">&#127795;</div>
                <div className="about-card-title">Woodland Ops</div>
              </div>
              <div className="about-card">
                <div className="about-card-icon">&#128110;</div>
                <div className="about-card-title">Marshalled Games</div>
              </div>
              <div className="about-card">
                <div className="about-card-icon">&#127937;</div>
                <div className="about-card-title">Gear Available</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          GAME TYPES SECTION
          ============================================================ */}
      <section style={{ background: 'var(--dark)', padding: '5rem 2rem' }} id="games">
        <div className="container">
          <div className="section-label fade-in">&#9632; Game Types</div>
          <h2 className="section-title">Choose Your Weapon.</h2>
          <div className="divider"></div>
          <p className="section-sub">Multiple formats. Infinite scenarios. Find your style and gear up.</p>
          <div className="games-grid">
            <div className="game-card">
              <div className="game-num">01</div>
              <div className="game-title">Milsim</div>
              <p className="game-desc">
                Full military simulation events with realistic scenarios, squad tactics, and objective-based missions. The ultimate test of teamwork, communication, and precision.
              </p>
              <div className="game-tags">
                <span className="tag">Scenario Ops</span>
                <span className="tag">Squad Tactics</span>
                <span className="tag">Objective Play</span>
              </div>
            </div>
            <div className="game-card">
              <div className="game-num">02</div>
              <div className="game-title">Skirmish</div>
              <p className="game-desc">
                Fast-paced open play sessions. Team deathmatch, capture the flag, and domination modes. Perfect for all skill levels &mdash; walk in, gear up, and start shooting.
              </p>
              <div className="game-tags">
                <span className="tag">Team Deathmatch</span>
                <span className="tag">Capture the Flag</span>
                <span className="tag">Domination</span>
              </div>
            </div>
            <div className="game-card">
              <div className="game-num">03</div>
              <div className="game-title">Private Events</div>
              <p className="game-desc">
                Book a whole site for your group. Birthday battles, stag dos, corporate team-building, or custom game modes. Your site, your rules, our marshals.
              </p>
              <div className="game-tags">
                <span className="tag">Private Hire</span>
                <span className="tag">Corporate</span>
                <span className="tag">Custom Games</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          LOCATIONS SECTION
          ============================================================ */}
      <section className="locations" id="locations">
        <div className="container">
          <div className="section-label fade-in">&#9632; Our Sites</div>
          <h2 className="section-title">Multiple Theatres of War.</h2>
          <div className="divider"></div>
          <p className="section-sub">Every site is a different mission. Explore our growing network of battle-ready properties.</p>
          <div className="locations-grid">
            {locations.map((loc) => (
              <div className="loc-card" key={loc.id}>
                <div className="loc-photo">
                  <div className={`loc-photo-placeholder ${loc.photoClass || ''}`}></div>
                  <div className="loc-photo-label">&#9632; {loc.cardLabel}</div>
                </div>
                <div className="loc-body">
                  <div className="loc-top">
                    <div>
                      <div className="loc-name">{loc.name}</div>
                      <div className="loc-address">{loc.cardAddress || loc.address}</div>
                    </div>
                    <span className={`loc-badge ${loc.badge === 'open' ? 'open' : ''}`}>
                      {loc.badge === 'open' ? 'Open' : 'Coming Soon'}
                    </span>
                  </div>
                  <div className="loc-features">
                    {(loc.cardFeatures || loc.features).map((f, i) => (
                      <div className="loc-feature" key={i}>{f}</div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          GALLERY SECTION
          ============================================================ */}
      <section className="gallery" id="gallery">
        <div className="container">
          <div className="gallery-intro">
            <div>
              <div className="section-label fade-in">&#9632; Our Terrain</div>
              <h2 className="section-title">See the Battlefield.</h2>
              <div className="divider"></div>
            </div>
          </div>
          <div className="gallery-grid">
            <Link to="/locations#ghost-town" className="gallery-item gallery-item--link" aria-label="View Ghost Town details">
              <div className="gallery-photo g1"></div>
              <div className="gallery-overlay">
                <div className="gallery-tag">&#9632; Ghost Town &mdash; Rural Neighborhood</div>
              </div>
            </Link>
            <Link to="/locations#trench-warfare" className="gallery-item gallery-item--link" aria-label="View Echo Urban details">
              <div className="gallery-photo g2"></div>
              <div className="gallery-overlay">
                <div className="gallery-tag">&#9632; Echo Urban &mdash; CQB</div>
              </div>
            </Link>
            <Link to="/locations#foxtrot-fields" className="gallery-item gallery-item--link" aria-label="View Foxtrot Fields details">
              <div className="gallery-photo g3"></div>
              <div className="gallery-overlay">
                <div className="gallery-tag">&#9632; Foxtrot Fields</div>
              </div>
            </Link>
            <div className="gallery-item">
              <div className="gallery-photo g4"></div>
              <div className="gallery-overlay">
                <div className="gallery-tag">&#9632; Game Day Action</div>
              </div>
            </div>
            <div className="gallery-item">
              <div className="gallery-photo g5"></div>
              <div className="gallery-overlay">
                <div className="gallery-tag">&#9632; Milsim Staging</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          UPCOMING EVENTS SECTION
          ============================================================ */}
      <section style={{ background: 'var(--mid)', padding: '5rem 2rem' }} id="events">
        <div className="container">
          <div className="section-label fade-in">&#9632; Upcoming Events</div>
          <h2 className="section-title">Next Deployments.</h2>
          <div className="divider"></div>
          <p className="section-sub">Spots fill fast. Check dates, pick your battle, and lock in your squad.</p>
          <div className="events-grid">
            {upcomingEvents.map((ev) => (
              <div className="event-card" key={ev.id}>
                <div className="event-header">
                  <div className="event-date">
                    <div className="event-day">{ev.date.day}</div>
                    <div className="event-month">{ev.date.month}</div>
                  </div>
                  <span className={`event-type ${ev.type}`}>{ev.type.charAt(0).toUpperCase() + ev.type.slice(1)}</span>
                </div>
                <div className="event-body">
                  <Link to={`/events/${ev.slug}`} className="event-title" style={{ textDecoration: 'none', color: 'var(--cream)' }}>{ev.title}</Link>
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
        </div>
      </section>

      {/* ============================================================
          WHY CHOOSE US SECTION
          ============================================================ */}
      <section style={{ background: 'var(--dark)', padding: '5rem 2rem' }}>
        <div className="container">
          <div className="section-label fade-in">&#9632; Why Choose Us</div>
          <h2 className="section-title">No-Nonsense.<br />All Action.</h2>
          <div className="divider"></div>
          <div className="why-grid">
            <div className="why-item">
              <div className="why-icon">&#9760;</div>
              <div className="why-title">Safety First</div>
              <p className="why-desc">Fully trained marshals, mandatory safety briefings, and strict FPS limits enforced at every event.</p>
            </div>
            <div className="why-item">
              <div className="why-icon">&#127979;</div>
              <div className="why-title">Gear Hire Available</div>
              <p className="why-desc">Don't own kit? No problem. Quality loaner gear available for all skill levels at every site.</p>
            </div>
            <div className="why-item">
              <div className="why-icon">&#127758;</div>
              <div className="why-title">Multiple Venues</div>
              <p className="why-desc">Different terrain and game styles across all our sites &mdash; no two events ever feel the same.</p>
            </div>
            <div className="why-item">
              <div className="why-icon">&#128100;</div>
              <div className="why-title">All Skill Levels</div>
              <p className="why-desc">From total beginners to seasoned milsim veterans. We design events for everyone to enjoy.</p>
            </div>
            <div className="why-item">
              <div className="why-icon">&#127942;</div>
              <div className="why-title">Community-Driven</div>
              <p className="why-desc">Built by players, for players. Regular events, online groups, and a growing local scene.</p>
            </div>
            <div className="why-item">
              <div className="why-icon">&#127881;</div>
              <div className="why-title">Private Event Hire</div>
              <p className="why-desc">Birthday battles, team-building days, stag dos. Book a whole site exclusively for your group.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          TESTIMONIALS SECTION
          ============================================================ */}
      <section className="testimonials">
        <div className="container">
          <div className="section-label fade-in">&#9632; In the Field</div>
          <h2 className="section-title">Players Don't Lie.</h2>
          <div className="divider"></div>
          <div className="test-grid">
            {testimonials.map((t) => (
              <div className="test-card" key={t.initials}>
                <div className="test-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
                <p className="test-text">&ldquo;{t.text}&rdquo;</p>
                <div className="test-author">
                  <div className="test-avatar">{t.initials}</div>
                  <div>
                    <div className="test-name">{t.name}</div>
                    <div className="test-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          CTA BAND
          ============================================================ */}
      <div className="cta-band">
        <h2>Ready to Deploy?</h2>
        <p>Slots go fast. Don't miss the next operation.</p>
        <Link to={siteConfig.bookingLink} className="btn-white">&#9658; Book Your Battle Now</Link>
      </div>
    </>
  );
}
