import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/not-found.css';

export default function NotFound() {
  const [count, setCount] = useState(10);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setInterval(() => {
      setCount((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

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
          Redirecting to home in <span>{count}</span> seconds...
        </p>
      </div>
    </>
  );
}
