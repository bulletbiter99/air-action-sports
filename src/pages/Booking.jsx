import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/booking.css';

export default function Booking() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    players: '',
    eventType: '',
    site: '',
    date: '',
    referral: '',
    gearHire: '',
    message: '',
  });
  const [errors, setErrors] = useState({});
  const [showConfirmation, setShowConfirmation] = useState(false);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const validate = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.fullName.trim()) newErrors.fullName = true;
    if (!formData.email.trim() || !emailRegex.test(formData.email.trim()))
      newErrors.email = true;
    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length < 7) newErrors.phone = true;
    if (!formData.players || parseInt(formData.players) < 1)
      newErrors.players = true;
    if (!formData.eventType) newErrors.eventType = true;
    if (!formData.site) newErrors.site = true;
    if (!formData.date) newErrors.date = true;

    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validate();
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      // TODO: Replace with Formspree or backend API submission
      setShowConfirmation(true);
    }
  };

  const handleDismiss = () => {
    setShowConfirmation(false);
    setFormData({
      fullName: '',
      email: '',
      phone: '',
      players: '',
      eventType: '',
      site: '',
      date: '',
      referral: '',
      gearHire: '',
      message: '',
    });
    setErrors({});
  };

  return (
    <>
      <SEO
        title="Book Your Battle | Air Action Sports"
        description="Book your next airsoft event with Air Action Sports. Fill in the mission briefing form to reserve your slot for milsim, skirmish, or private hire events."
        canonical="https://airactionsport.com/booking"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Main Content */}
      <div className="page-content">
        <div className="section-label">&#9632; Book Your Battle</div>
        <h1 className="section-title">Mission Briefing Form.</h1>
        <div className="divider"></div>
        <p className="section-sub" style={{ marginBottom: '2.5rem' }}>
          Fill in your details below and we'll get back to you within 24 hours to
          confirm your booking. All fields marked are required.
        </p>

        {/* PLACEHOLDER: Replace YOUR-FORM-ID with your Formspree endpoint */}
        <form id="booking-form" onSubmit={handleSubmit} noValidate>
          <div className="form-row">
            <div className={`form-group${errors.fullName ? ' error' : ''}`}>
              <label className="form-label" htmlFor="full-name">
                Full Name
              </label>
              <input
                type="text"
                id="full-name"
                name="fullName"
                className="form-input"
                placeholder="Your full name"
                value={formData.fullName}
                onChange={handleChange}
                required
              />
              <span className="form-error">Please enter your full name.</span>
            </div>
            <div className={`form-group${errors.email ? ' error' : ''}`}>
              <label className="form-label" htmlFor="email">
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                className="form-input"
                placeholder="you@email.com"
                value={formData.email}
                onChange={handleChange}
                required
              />
              <span className="form-error">
                Please enter a valid email address.
              </span>
            </div>
          </div>

          <div className="form-row">
            <div className={`form-group${errors.phone ? ' error' : ''}`}>
              <label className="form-label" htmlFor="phone">
                Phone
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                className="form-input"
                placeholder="Your phone number"
                value={formData.phone}
                onChange={handleChange}
                required
              />
              <span className="form-error">
                Please enter a valid phone number (min 7 digits).
              </span>
            </div>
            <div className={`form-group${errors.players ? ' error' : ''}`}>
              <label className="form-label" htmlFor="players">
                Number of Players
              </label>
              <input
                type="number"
                id="players"
                name="players"
                className="form-input"
                placeholder="e.g. 6"
                min="1"
                value={formData.players}
                onChange={handleChange}
                required
              />
              <span className="form-error">
                Please enter at least 1 player.
              </span>
            </div>
          </div>

          <div className={`form-group${errors.eventType ? ' error' : ''}`}>
            <label className="form-label" htmlFor="event-type">
              Event Type
            </label>
            <select
              id="event-type"
              name="eventType"
              className="form-select"
              value={formData.eventType}
              onChange={handleChange}
              required
            >
              <option value="">Select event type</option>
              <option value="milsim">Milsim</option>
              <option value="skirmish">Skirmish</option>
              <option value="private-event">Private Event</option>
            </select>
            <span className="form-error">Please select an event type.</span>
          </div>

          <div className={`form-group${errors.site ? ' error' : ''}`}>
            <label className="form-label" htmlFor="site">
              Preferred Site
            </label>
            <select
              id="site"
              name="site"
              className="form-select"
              value={formData.site}
              onChange={handleChange}
              required
            >
              <option value="">Select preferred site</option>
              <option value="ghost-town">
                Ghost Town &mdash; Rural Neighborhood
              </option>
              <option value="echo-urban">Echo Urban &mdash; CQB</option>
              <option value="foxtrot-fields">
                Foxtrot Fields &mdash; Open Field
              </option>
            </select>
            <span className="form-error">Please select a preferred site.</span>
          </div>

          <div className="form-row">
            <div className={`form-group${errors.date ? ' error' : ''}`}>
              <label className="form-label" htmlFor="date">
                Preferred Date
              </label>
              <input
                type="date"
                id="date"
                name="date"
                className="form-input"
                min={today}
                value={formData.date}
                onChange={handleChange}
                required
              />
              <span className="form-error">Please select a date.</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="referral">
                How Did You Hear About Us?
              </label>
              <select
                id="referral"
                name="referral"
                className="form-select"
                value={formData.referral}
                onChange={handleChange}
              >
                <option value="">Select an option</option>
                <option value="google">Google</option>
                <option value="social-media">Social Media</option>
                <option value="word-of-mouth">Word of Mouth</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Do you need gear hire?</label>
            <div className="form-radio-group">
              <label className="form-radio">
                <input
                  type="radio"
                  name="gearHire"
                  value="yes"
                  checked={formData.gearHire === 'yes'}
                  onChange={handleChange}
                />{' '}
                Yes
              </label>
              <label className="form-radio">
                <input
                  type="radio"
                  name="gearHire"
                  value="no"
                  checked={formData.gearHire === 'no'}
                  onChange={handleChange}
                />{' '}
                No
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="message">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              className="form-textarea"
              placeholder="Any additional details, special requests, or questions..."
              value={formData.message}
              onChange={handleChange}
            ></textarea>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--olive-light)', marginBottom: '1.5rem' }}>
            A safety waiver will be emailed to you after booking and must be completed before game day.
          </p>

          <button type="submit" className="form-submit">
            &#9658; Submit Booking Request
          </button>
        </form>
      </div>

      {/* Booking Confirmation Panel */}
      <div
        className={`booking-confirmation${showConfirmation ? ' visible' : ''}`}
      >
        <div className="booking-confirmation-inner">
          <div className="section-label">&#9632; Mission Received!</div>
          <h2>Booking Request Sent.</h2>
          <p>
            Thanks for getting in touch. We've received your mission briefing and
            will confirm your booking via email within 24 hours. Check your inbox
            and get ready to deploy.
          </p>
          <Link to="/" className="btn-primary" onClick={handleDismiss}>
            &#9658; Back to Home
          </Link>
        </div>
      </div>

      {/* Private Hire Section */}
      <section className="private-hire">
        <div className="container">
          <div className="section-label">&#9632; Private Hire</div>
          <h2 className="section-title">Exclusive Site Hire.</h2>
          <div className="divider"></div>
          <p className="section-sub" style={{ marginBottom: '1.5rem' }}>
            Looking to book an entire site for your group? We offer exclusive
            private hire for corporate team-building days, birthday battles, stag
            dos, and special occasions. Get the full site to yourselves with
            custom game modes and dedicated marshals.
          </p>
          <div className="private-hire-features">
            <div className="private-hire-feature">
              &#9632; Full Site Exclusive
            </div>
            <div className="private-hire-feature">
              &#9632; Custom Game Modes
            </div>
            <div className="private-hire-feature">
              &#9632; Dedicated Marshals
            </div>
          </div>
          <Link
            to="/contact"
            className="btn-primary"
            style={{ display: 'inline-block', marginTop: '1rem' }}
          >
            &#9658; Enquire About Private Hire
          </Link>
        </div>
      </section>
    </>
  );
}
