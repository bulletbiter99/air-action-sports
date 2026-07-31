import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { siteConfig } from '../data/siteConfig';
import { useEvents } from '../hooks/useEvents';

// Persistent "Book Now" pill that appears on scroll.
//
// Suppressed when there is nothing to book. It previously followed the visitor
// down every page and promised a booking that landed on "No events on the
// books." — the site's most insistent CTA pointing at its emptiest page. An
// absent pill is honest; a pill to a dead end costs trust at the exact moment
// someone is deciding.
//
// Also hidden on /booking and /waiver, where it is either redundant (already
// booking) or an interruption mid-form.
const HIDE_ON = [/^\/booking(\/|$)/, /^\/waiver(\/|$)/];

export default function FloatingBookPill() {
  const [visible, setVisible] = useState(false);
  const location = useLocation();
  // Upcoming only — an archived event still has a public page since #404 but
  // is NOT bookable (/quote and /checkout 409 on it), so it must not
  // resurrect the pill.
  const { events, loading } = useEvents({ includePast: false });

  // On an event detail page (/events/:slug), carry that event into the
  // booking flow so the pill pre-selects it instead of dropping the user
  // onto a blank event picker.
  const eventMatch = location.pathname.match(/^\/events\/([^/]+)$/);
  const bookTarget = eventMatch
    ? `${siteConfig.bookingLink}?event=${eventMatch[1]}`
    : siteConfig.bookingLink;

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      const winHeight = window.innerHeight;
      const nearBottom = scrollY + winHeight > docHeight - 400;
      setVisible(scrollY > 600 && !nearBottom);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const onHiddenRoute = HIDE_ON.some((re) => re.test(location.pathname));
  // While loading, render nothing rather than flash a CTA that may be a dead
  // end. The pill needs a 600px scroll before it shows anyway, so this costs
  // no real visibility.
  if (onHiddenRoute || loading || events.length === 0) return null;

  return (
    <Link to={bookTarget} className={`floating-book${visible ? ' visible' : ''}`}>
      &#9658; Book Now
    </Link>
  );
}
