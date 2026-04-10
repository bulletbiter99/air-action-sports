import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/privacy.css';

export default function Privacy() {
  return (
    <>
      <SEO
        title="Privacy Policy | Air Action Sports"
        description="Air Action Sports privacy policy. How we collect, use, and protect your personal data."
        canonical="https://airactionsport.com/privacy"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      <div className="privacy-content">
        <div className="page-label">&#9632; Legal</div>
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated: April 2026</p>

        <h2>Who We Are</h2>
        {/* PLACEHOLDER: Update with real business details */}
        <p>
          Air Action Sports operates airsoft events across multiple outdoor
          sites. This privacy policy explains how we collect, use, and protect
          your personal information when you use our website or book our
          services.
        </p>

        <h2>Information We Collect</h2>
        <p>
          We may collect the following information when you use our website:
        </p>
        <ul>
          <li>
            <strong>Contact information</strong> &mdash; name, email address,
            phone number (when you submit a form or booking)
          </li>
          <li>
            <strong>Booking details</strong> &mdash; event preferences, group
            size, gear hire requirements
          </li>
          <li>
            <strong>Usage data</strong> &mdash; pages visited, time spent,
            browser type (via cookies and analytics)
          </li>
          <li>
            <strong>Waiver information</strong> &mdash; name, date of birth,
            emergency contact (when you submit a waiver form)
          </li>
        </ul>

        <h2>How We Use Your Information</h2>
        <ul>
          <li>To process bookings and enquiries</li>
          <li>To send event confirmations and updates</li>
          <li>
            To send newsletters (only if you subscribe &mdash; you can
            unsubscribe at any time)
          </li>
          <li>To improve our website and services</li>
          <li>To comply with legal obligations (e.g., waiver records)</li>
        </ul>

        <h2>Cookies</h2>
        <p>
          Our website uses cookies to remember your preferences (such as cookie
          consent) and to understand how visitors use our site. You can decline
          non-essential cookies via the banner shown on your first visit.
        </p>

        <h2>Third-Party Services</h2>
        {/* PLACEHOLDER: Update this list based on which services you integrate */}
        <p>
          We may use the following third-party services that process data on our
          behalf:
        </p>
        <ul>
          <li>Google Analytics &mdash; website usage statistics</li>
          <li>Formspree &mdash; form submission handling</li>
          <li>Mailchimp &mdash; newsletter delivery</li>
        </ul>

        <h2>Data Retention</h2>
        <p>
          We retain your personal data only for as long as necessary to provide
          our services and comply with legal requirements. Booking records and
          waivers are retained for a minimum of 3 years.
        </p>

        <h2>Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Request access to the personal data we hold about you</li>
          <li>Request correction or deletion of your data</li>
          <li>
            Withdraw consent for marketing communications at any time
          </li>
          <li>Lodge a complaint with a data protection authority</li>
        </ul>

        <h2>Contact</h2>
        {/* PLACEHOLDER: Update with real contact email */}
        <p>
          If you have questions about this policy or want to exercise your data
          rights, contact us at{' '}
          <a href="mailto:actionairsport@gmail.com">actionairsport@gmail.com</a>.
        </p>

        <Link to="/" className="back-link">
          &#9658; Back to Home
        </Link>
      </div>
    </>
  );
}
