import { useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { siteConfig } from '../data/siteConfig';
import '../styles/pages/contact.css';

export default function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  });
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validate = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.name.trim()) newErrors.name = true;
    if (!formData.email.trim() || !emailRegex.test(formData.email.trim()))
      newErrors.email = true;
    if (!formData.message.trim()) newErrors.message = true;

    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validate();
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      // PLACEHOLDER: Replace with actual form submission (Formspree, fetch to backend, etc.)
      alert("Message sent! We'll get back to you shortly.");
      setFormData({ name: '', email: '', phone: '', subject: '', message: '' });
      setErrors({});
    }
  };

  return (
    <>
      <SEO
        title="Contact Us | Air Action Sports"
        description="Get in touch with Air Action Sports. Enquiries about bookings, private hire, corporate events, and more."
        canonical="https://airactionsport.com/contact"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      <div className="page-content">
        <div className="section-label">&#9632; Get In Touch</div>
        <h2 className="section-title">Contact HQ.</h2>
        <div className="divider"></div>
        <p className="section-sub">
          Got a question, want to book a private event, or just want to chat
          about airsoft? Drop us a message and we'll get back to you.
        </p>

        <div className="contact-grid">
          {/* Left Column -- Contact Form */}
          <div>
            {/* PLACEHOLDER: Replace YOUR-FORM-ID with your Formspree endpoint */}
            <form id="contact-form" onSubmit={handleSubmit} noValidate>
              <div className="form-row">
                <div className={`form-group${errors.name ? ' error' : ''}`}>
                  <label className="form-label" htmlFor="name">
                    Name *
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    className="form-input"
                    placeholder="Your name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                  />
                  <span className="form-error">Please enter your name</span>
                </div>
                <div className={`form-group${errors.email ? ' error' : ''}`}>
                  <label className="form-label" htmlFor="email">
                    Email *
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
                    Please enter a valid email
                  </span>
                </div>
              </div>

              <div className="form-group">
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
                />
                <span className="form-error">
                  Please enter a valid phone number
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="subject">
                  Subject
                </label>
                <select
                  id="subject"
                  name="subject"
                  className="form-select"
                  value={formData.subject}
                  onChange={handleChange}
                >
                  <option value="" disabled>
                    Select a subject
                  </option>
                  <option value="general">General Enquiry</option>
                  <option value="booking">Booking Question</option>
                  <option value="private-hire">Private Hire</option>
                  <option value="corporate">Corporate Events</option>
                  <option value="feedback">Feedback</option>
                  <option value="other">Other</option>
                </select>
                <span className="form-error">Please select a subject</span>
              </div>

              <div className={`form-group${errors.message ? ' error' : ''}`}>
                <label className="form-label" htmlFor="message">
                  Message *
                </label>
                <textarea
                  id="message"
                  name="message"
                  className="form-textarea"
                  placeholder="Tell us what you need..."
                  value={formData.message}
                  onChange={handleChange}
                  required
                ></textarea>
                <span className="form-error">Please enter your message</span>
              </div>

              <button type="submit" className="form-submit">
                &#9658; Send Message
              </button>
            </form>
          </div>

          {/* Right Column -- Info Panel */}
          <div className="info-panel">
            <div className="info-item">
              <div className="info-label">Phone</div>
              <div className="info-value">
                <a
                  href={siteConfig.phoneLink}
                  style={{ color: 'var(--tan-light)', textDecoration: 'none' }}
                >
                  {siteConfig.phone}
                </a>
              </div>
            </div>

            <div className="info-item">
              <div className="info-label">Email</div>
              {/* PLACEHOLDER: Update with real email */}
              <div className="info-value">
                <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
              </div>
            </div>

            <div className="info-item">
              <div className="info-label">Hours</div>
              <div className="info-value">
                Mon&ndash;Fri: 9am &ndash; 5pm
                <br />
                Weekends: Event days only
              </div>
            </div>

            <div className="info-item">
              <div className="info-label">Social</div>
              <div className="info-social">
                <a
                  href={siteConfig.social.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-link"
                  aria-label="Facebook"
                >
                  <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                </a>
                <a
                  href={siteConfig.social.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-link"
                  aria-label="Instagram"
                >
                  <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 100-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 11-2.882 0 1.441 1.441 0 012.882 0z" />
                  </svg>
                </a>
              </div>
            </div>

            <div className="response-note">
              <p>
                We aim to respond to all enquiries within 24 hours. For urgent
                queries on event days, call us directly.
              </p>
            </div>
          </div>
        </div>

        {/* Map Section */}
        <div className="map-section">
          {/* Google Maps embed — add iframe when ready */}
        </div>
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Ready to Book?</h2>
        <p>Skip the form and reserve your slot now.</p>
        <Link to="/booking" className="btn-white">
          &#9658; Book Your Battle
        </Link>
      </div>
    </>
  );
}
