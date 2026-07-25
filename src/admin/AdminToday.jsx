// M4 B12c — `/admin/today` page activation per D09.
//
// Resurfaces the dynamic Today nav item from B5 + Roster/Scan/Rentals
// as quick-action tiles when an event runs today. The route is always
// alive so deep-links from CheckInBanner (B6) + TodayCheckIns persona
// widget (B4c) work; the sidebar entry only renders when
// activeEventToday=true (controlled by sidebarConfig.js's `dynamic`
// field + getVisibleItems filter).
//
// Render states based on useTodayActive():
//   - todayState === undefined → loading (first paint before /today/active resolves)
//   - activeEventToday === false → empty-state card pointing to /admin/events
//   - activeEventToday === true → one tile group PER active event (the
//     /today/active `events` array, added 2026-07, carries id+title; on a
//     two-event day each event gets its own Roster/Check-in deep-links).
//     Falls back to a single eventId-only group for a stale cached payload
//     without `events`, and to the /admin/events pointer if neither exists.
//
// Inline styles (consistent with AdminDashboard.jsx pattern). Follows the
// same color palette as other admin pages (var(--cream), var(--orange),
// var(--olive-light), var(--mid)). No new tests in B12c; component is
// thin glue + Link deep-links.

import { Link } from 'react-router-dom';
import { useTodayActive } from '../hooks/useWidgetData.js';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';

const TODAY_HEADER = { title: 'Today', breadcrumb: [{ label: 'Today' }] };

export default function AdminToday() {
  const todayState = useTodayActive();

  // Initial paint before the shared /today/active subscription resolves.
  if (todayState === undefined) {
    return (
      <div style={page}>
        <p style={muted}>Loading…</p>
      </div>
    );
  }

  const activeEventToday = Boolean(todayState?.activeEventToday);
  const eventId = todayState?.eventId || null;
  const events = Array.isArray(todayState?.events) && todayState.events.length > 0
    ? todayState.events
    : (eventId ? [{ id: eventId, title: null }] : []);

  if (!activeEventToday) {
    return <NoEventTodayState />;
  }

  // activeEventToday=true but no event list — a stale cached payload from a
  // pre-`events` deploy. Point at /admin/events rather than render nothing.
  if (events.length === 0) {
    return <AmbiguousState />;
  }

  return <ActiveEventTodayView events={events} />;
}

function NoEventTodayState() {
  return (
    <div style={page}>
      <AdminPageHeader {...TODAY_HEADER} />
      <div style={card}>
        <h2 style={h2}>No event today</h2>
        <p style={cardBody}>
          The Today view lights up when an event is scheduled for today and
          the doors are about to open. Quick links to Roster, Check-in, and
          Rentals appear here on event days.
        </p>
        <p style={cardBody}>
          Browse upcoming dates on the <Link to="/admin/events" style={link}>Events</Link> page.
        </p>
      </div>
    </div>
  );
}

function AmbiguousState() {
  return (
    <div style={page}>
      <AdminPageHeader {...TODAY_HEADER} />
      <div style={card}>
        <h2 style={h2}>Multiple events scheduled today</h2>
        <p style={cardBody}>
          More than one event is on the calendar for today. Pick the one you
          want to operate from the <Link to="/admin/events" style={link}>Events</Link> page;
          inside the event you'll find Roster, Check-in, and Rentals.
        </p>
      </div>
    </div>
  );
}

function ActiveEventTodayView({ events }) {
  const description = events.length === 1
    ? `Event in progress · ${events[0].title || events[0].id}`
    : `${events.length} events in progress`;
  return (
    <div style={page}>
      <AdminPageHeader {...TODAY_HEADER} description={description} />
      {events.map((event) => (
        <EventTileGroup
          key={event.id}
          event={event}
          showTitle={events.length > 1}
        />
      ))}
    </div>
  );
}

function EventTileGroup({ event, showTitle }) {
  const eventQs = `?event=${encodeURIComponent(event.id)}`;
  return (
    <section style={tileGroup} aria-label={event.title || event.id}>
      {showTitle && <h2 style={groupTitle}>{event.title || event.id}</h2>}
      <div style={tilesGrid}>
        <ActionTile
          to={`/admin/roster${eventQs}`}
          label="Roster"
          desc="Player list + waiver status"
        />
        <ActionTile
          to={`/admin/scan${eventQs}`}
          label="Check in"
          desc="Scan QR codes / manual lookup"
          accent
        />
        <ActionTile
          to="/admin/rentals/assignments"
          label="Rentals"
          desc="Equipment assignment + return"
        />
      </div>
    </section>
  );
}

function ActionTile({ to, label, desc, accent }) {
  return (
    <Link to={to} style={accent ? { ...tile, ...tileAccent } : tile}>
      <h2 style={tileLabel}>{label}</h2>
      <p style={tileDesc}>{desc}</p>
      <span style={tileArrow} aria-hidden="true">→</span>
    </Link>
  );
}

const page = { maxWidth: 1100, margin: '0 auto', padding: '2rem' };
const card = {
  background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)',
  padding: '1.75rem', maxWidth: 640,
};
const h2 = {
  fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2,
  color: 'var(--orange)', margin: '0 0 14px',
};
const cardBody = {
  fontSize: 14, color: 'var(--cream)', lineHeight: 1.55, margin: '0 0 12px',
};
const muted = { color: 'var(--olive-light)', fontSize: 13, padding: '1.5rem' };
const link = { color: 'var(--orange)', textDecoration: 'underline' };

const tileGroup = { marginBottom: 28 };
const groupTitle = {
  fontSize: 15, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 2,
  color: 'var(--orange)', margin: '0 0 12px',
};
const tilesGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
};
const tile = {
  position: 'relative',
  display: 'block',
  padding: '1.5rem 1.25rem',
  background: 'var(--mid)',
  border: '1px solid rgba(200,184,154,0.15)',
  textDecoration: 'none',
  color: 'var(--cream)',
  transition: 'border-color 0.12s, transform 0.12s',
};
const tileAccent = {
  borderColor: 'rgba(215,108,33,0.5)',
  background: 'rgba(215,108,33,0.06)',
};
const tileLabel = {
  fontSize: 18, fontWeight: 900, textTransform: 'uppercase',
  letterSpacing: 1, color: 'var(--cream)', margin: '0 0 8px',
};
const tileDesc = {
  fontSize: 13, color: 'var(--olive-light)', margin: 0, lineHeight: 1.5,
};
const tileArrow = {
  position: 'absolute', right: 16, bottom: 16,
  fontSize: 20, fontWeight: 800, color: 'var(--orange)',
};
