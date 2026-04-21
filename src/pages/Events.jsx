import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { siteConfig } from '../data/siteConfig';
import { useEvents } from '../hooks/useEvents';
import '../styles/pages/events.css';

export default function Events() {
  const [filterType, setFilterType] = useState('all');
  const [filterSite, setFilterSite] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');

  const { events, loading, error } = useEvents({ includePast: true });
  const upcomingEvents = useMemo(() => events.filter((e) => !e.past), [events]);
  const pastEvents = useMemo(() => events.filter((e) => e.past), [events]);

  // Build filter option sets from the live event list so new sites/months
  // from admin show up without code changes.
  const siteOptions = useMemo(() => {
    const set = new Set(upcomingEvents.map((e) => e.site).filter(Boolean));
    return Array.from(set).sort();
  }, [upcomingEvents]);
  const monthOptions = useMemo(() => {
    const map = new Map();
    for (const e of upcomingEvents) if (e.month) map.set(e.month, e.date.month);
    return Array.from(map.entries()); // [[key, label], ...]
  }, [upcomingEvents]);
  const typeOptions = useMemo(() => {
    const set = new Set(upcomingEvents.map((e) => e.type).filter(Boolean));
    return Array.from(set).sort();
  }, [upcomingEvents]);

  const filteredEvents = upcomingEvents.filter((ev) => {
    const matchType = filterType === 'all' || ev.type === filterType;
    const matchSite = filterSite === 'all' || ev.site === filterSite;
    const matchMonth = filterMonth === 'all' || ev.month === filterMonth;
    return matchType && matchSite && matchMonth;
  });

  return (
    <>
      <SEO
        title="Events Calendar | Air Action Sports"
        description="Browse upcoming airsoft events at Air Action Sports. Milsim, skirmish, and open play sessions across multiple sites. Book your slot today."
        canonical="https://airactionsport.com/events"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      <div className="page-content">
        <div className="section-label">&#9632; Events Calendar</div>
        <h1 className="section-title">Upcoming Operations.</h1>
        <div className="divider"></div>
        <p className="section-sub">Check dates, pick your battle, and book your slot. Events fill up fast &mdash; don't miss out.</p>

        {/* Filter Bar */}
        <div className="filter-bar">
          <span className="filter-label">&#9632; Filter Events</span>
          <div className="filter-controls">
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
              <option value="all">All Sites</option>
              {siteOptions.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
              <option value="all">All Months</option>
              {monthOptions.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <p style={{ color: 'var(--olive-light)', textAlign: 'center', padding: '2rem' }}>Loading events…</p>
        )}
        {error && !loading && (
          <p style={{ color: '#ff8a7e', textAlign: 'center', padding: '2rem' }}>
            Couldn't load events. Please refresh in a moment.
          </p>
        )}

        {/* Events Grid */}
        <div className="events-grid">
          {filteredEvents.map((ev) => (
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
                <Link to={`/events/${ev.slug}`} className="event-title" style={{ textDecoration: 'none', color: 'var(--cream)' }}>{ev.title}</Link>
                <div className="event-loc">&#9679; {ev.location}</div>
                <div className="event-meta">
                  <div className="event-meta-item"><strong>Time</strong>{ev.time}</div>
                  <div className="event-meta-item"><strong>Slots</strong>{ev.slots.total} Players</div>
                  <div className="event-meta-item"><strong>From</strong>{ev.price}</div>
                </div>
                <div className="slots-bar">
                  <div
                    className="slots-fill"
                    style={{ width: `${Math.round((ev.slots.taken / ev.slots.total) * 100)}%` }}
                  ></div>
                </div>
                <div className="slots-text">
                  {ev.slots.taken} of {ev.slots.total} spots taken
                </div>
                <Link to={`/events/${ev.slug}`} className="btn-book">&#9658; View Details</Link>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {!loading && filteredEvents.length === 0 && (
          <div className="empty-state" style={{ display: 'block' }}>
            No events match your filters. Try adjusting your search or check back soon.
          </div>
        )}

        {/* Past Events */}
        {pastEvents.length > 0 && (
        <div className="past-section">
          <div className="section-label" style={{ marginTop: '2rem' }}>&#9632; Past Operations</div>
          <div className="divider"></div>
          <div className="events-grid">
            {pastEvents.map((ev) => (
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
                  <span className="event-complete">Event Complete</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Want a Custom Event?</h2>
        <p>We build bespoke operations for groups, corporate teams, and private parties.</p>
        <a href={siteConfig.bookingLink} target="_blank" rel="noopener noreferrer" className="btn-white">&#9658; Enquire Now</a>
      </div>
    </>
  );
}
