import { Link } from 'react-router-dom';
import { useEvents } from '../hooks/useEvents';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Build a "May 9" style short date from an ISO datetime string.
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// Strip the trailing descriptor ("Ghost Town - Rural Neighborhood" → "Ghost Town").
function shortLocation(loc) {
  if (!loc) return '';
  return loc.split(/\s*[—–-]\s/)[0].trim();
}

export default function TickerBar() {
  const { events, loading } = useEvents({ includePast: false });
  const next = events?.[0] || null;

  // Hide while loading on first paint to avoid a flash of generic copy.
  if (loading && !next) return null;

  return (
    <div className="ticker-bar">
      {next ? (
        <>
          Next Mission: {next.title} &mdash; {shortLocation(next.location)}, {shortDate(next.dateIso)}
          {' '}<Link to="/booking">Book Now &rarr;</Link>
        </>
      ) : (
        <>
          Stay sharp &mdash; new operations announced regularly.
          {' '}<Link to="/events">See Upcoming Events &rarr;</Link>
        </>
      )}
    </div>
  );
}
