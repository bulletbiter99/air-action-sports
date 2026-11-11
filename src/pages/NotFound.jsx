import { Link, useLocation } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/not-found.css';

// This page used to count down from 10 and then navigate('/').
//
// That destroyed its own evidence. Every unmatched path in this app returns
// HTTP 200 with the SPA shell, so a dead link is already invisible to any
// status check, monitor or crawler — the 404 page was the ONLY place the broken
// URL was ever visible, and it erased it after ten seconds. A user could not
// read it, screenshot it, or report it, and anyone debugging over the phone
// watched the address bar change while they were still reading.
//
// The URL is now shown and kept. Leaving is a choice the visitor makes.
export default function NotFound() {
  const { pathname, search } = useLocation();
  const failedPath = `${pathname}${search}`;

  return (
    <>
      <SEO
        title="Mission Failed &mdash; Page Not Found"
        description="Page not found. Head back to base and find what you're looking for."
      />

      <div className="error-page">
        <div className="error-code">404</div>
        <h1 className="error-title">Mission Failed</h1>
        <p className="error-sub">
          Looks like this position has been overrun. The page you're looking for
          doesn't exist or has been moved. Fall back to safety.
        </p>
        {/* Shown so the visitor can read, screenshot or quote it to us. */}
        <p className="error-path">
          <code>{failedPath}</code>
        </p>
        <div className="error-links">
          <Link to="/" className="btn-home">
            &#9658; Back to Base
          </Link>
          <Link to="/events" className="btn-ghost">
            View Events
          </Link>
          <Link to="/contact" className="btn-ghost">
            Contact Us
          </Link>
        </div>
        <p className="countdown-redirect">
          If you followed a link from our site, please{' '}
          <Link to="/contact">let us know</Link> so we can fix it.
        </p>
      </div>
    </>
  );
}
