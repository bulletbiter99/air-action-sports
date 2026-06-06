import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { siteConfig } from '../data/siteConfig';

export default function FloatingBookPill() {
  const [visible, setVisible] = useState(false);
  const location = useLocation();

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

  return (
    <Link to={bookTarget} className={`floating-book${visible ? ' visible' : ''}`}>
      &#9658; Book Now
    </Link>
  );
}
