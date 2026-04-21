import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/booking.css';

export default function BookingCancelled() {
  return (
    <>
      <SEO title="Booking Cancelled | Air Action Sports" canonical="https://airactionsport.com/booking/cancelled" />
      <div className="page-content">
        <div className="section-label">&#9632; Payment Cancelled</div>
        <h1 className="section-title">No charge made.</h1>
        <div className="divider"></div>
        <p style={{ color: 'var(--olive-light)', marginBottom: '1.5rem' }}>
          Your booking wasn't completed and nothing was charged. Your seats are released — pick back up any time.
        </p>
        <Link to="/booking" className="btn-primary" style={{ display: 'inline-block' }}>
          &#9658; Try Again
        </Link>
      </div>
    </>
  );
}
