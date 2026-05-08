// M4 B12c — `/admin/today` page activation per D09.
//
// Resurfaces the dynamic Today nav item from B5 + Roster/Scan/Rentals
// as quick-action tiles when an event runs today. The route is always
// alive so deep-links from CheckInBanner (B6) + TodayCheckIns persona
// widget (B4c) work; the sidebar entry only renders when
// activeEventToday=true (controlled by sidebarConfig.js's `dynamic`
// field + getVisibleItems filter).
//
// Three render states based on useTodayActive():
//   - todayState === undefined → loading (first paint before /today/active resolves)
//   - activeEventToday === false → empty-state card pointing to /admin/events
//   - activeEventToday === true && eventId !== null → header + 3 action tiles
//   - activeEventToday === true && eventId === null → ambiguous (2+ events today);
//     point operator to /admin/events to pick one
//
// Inline styles (consistent with AdminDashboard.jsx pattern). Follows the
// same color palette as other admin pages (var(--cream), var(--orange),
// var(--olive-light), var(--mid)). No new tests in B12c; component is
// thin glue + Link deep-links.

import { Link } from 'react-router-dom';
import { useTodayActive } from '../hooks/useWidgetData.js';

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

  if (!activeEventToday) {
    return <NoEventTodayState />;
  }

  if (!eventId) {
    return <AmbiguousState />;
  }

  return <ActiveEventTodayView eventId={eventId} />;
}

function NoEventTodayState() {
  return (
    <div style={page}>
      <header style={headerRow}>
        <h1 style={h1}>Today</h1>
      </header>
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
      <header style={headerRow}>
        <h1 style={h1}>Today</h1>
      </header>
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

function ActiveEventTodayView({ eventId }) {
  const eventQs = `?event=${encodeURIComponent(eventId)}`;
  return (
    <div style={page}>
      <header style={headerRow}>
        <h1 style={h1}>Today</h1>
        <p style={subtitle}>Event in progress · {eventId}</p>
      </header>
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
    </div>
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
const headerRow = { marginBottom: '2rem' };
const h1 = {
  fontSize: 28, fontWeight: 900, textTransform: 'uppercase',
  letterSpacing: '-1px', color: 'var(--cream)', margin: 0,
};
const subtitle = {
  marginTop: 6, color: 'var(--olive-light)', fontSize: 13,
  fontFamily: 'monospace', letterSpacing: 0.5,
};
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
