import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/waiver.css';

export default function Waiver() {
  const [formData, setFormData] = useState({
    name: '',
    dob: '',
    email: '',
    phone: '',
    emergencyName: '',
    emergencyPhone: '',
    relationship: '',
    agree: false,
    privacy: false,
    signature: '',
    parentName: '',
    parentRelationship: '',
    parentConsent: false,
    parentSignature: '',
  });
  const [errors, setErrors] = useState({});
  const [showConfirmation, setShowConfirmation] = useState(false);

  const todayFormatted = useMemo(() => {
    const today = new Date();
    return today.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }, []);

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

    if (!formData.name.trim()) newErrors.name = true;
    if (!formData.dob) newErrors.dob = true;
    if (!formData.email.trim() || !emailRegex.test(formData.email.trim()))
      newErrors.email = true;
    if (!formData.phone.trim()) newErrors.phone = true;
    if (!formData.emergencyName.trim()) newErrors.emergencyName = true;
    if (!formData.emergencyPhone.trim()) newErrors.emergencyPhone = true;
    if (!formData.agree) newErrors.agree = true;
    if (!formData.signature.trim()) newErrors.signature = true;

    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validate();
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setShowConfirmation(true);
      window.scrollTo(0, 0);
    }
  };

  return (
    <>
      <SEO
        title="Player Waiver | Air Action Sports"
        description="Complete your digital liability waiver before attending an Air Action Sports airsoft event. All players must sign before gameplay."
        canonical="https://airactionsport.com/waiver"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Waiver Confirmation Panel */}
      <div
        className={`waiver-confirmation${showConfirmation ? ' active' : ''}`}
      >
        <h2>&#9632; Waiver Submitted!</h2>
        <p>
          Your waiver has been received. You're cleared for action. See you on
          the battlefield.
        </p>
        <Link
          to="/"
          className="form-submit"
          style={{ textDecoration: 'none', display: 'inline-block' }}
        >
          Back to Home
        </Link>
      </div>

      <div
        className="page-content"
        style={showConfirmation ? { display: 'none' } : undefined}
      >
        {/* Print-only header */}
        <div className="print-header">
          <h1>Air Action Sports &mdash; Player Liability Waiver</h1>
          <p>Digital waiver submission</p>
        </div>

        <div className="section-label">&#9632; Player Waiver</div>
        <h2 className="section-title">Safety First.</h2>
        <div className="divider"></div>

        {/* Waiver Intro */}
        <div className="waiver-intro">
          <p>
            <strong>
              All players must complete this waiver before participating in any
              Air Action Sports event.
            </strong>
          </p>
          <p>
            <strong>Players under 18</strong> must have a parent or guardian
            complete the additional section below.
          </p>
          <p>This waiver must be submitted before your event date.</p>
        </div>

        {/* Waiver Form */}
        {/* PLACEHOLDER: Replace YOUR-FORM-ID with your Formspree endpoint */}
        <form id="waiver-form" onSubmit={handleSubmit} noValidate>
          {/* Section 1 -- Player Information */}
          <div className="waiver-section">
            <h3>1. Player Information</h3>
            <div className="form-row">
              <div className={`form-group${errors.name ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-name">
                  Full Name *
                </label>
                <input
                  type="text"
                  id="w-name"
                  name="name"
                  className="form-input"
                  placeholder="Your full name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
                <span className="form-error">
                  Please enter your full name
                </span>
              </div>
              <div className={`form-group${errors.dob ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-dob">
                  Date of Birth *
                </label>
                <input
                  type="date"
                  id="w-dob"
                  name="dob"
                  className="form-input"
                  value={formData.dob}
                  onChange={handleChange}
                  required
                />
                <span className="form-error">
                  Please enter your date of birth
                </span>
              </div>
            </div>
            <div className="form-row">
              <div className={`form-group${errors.email ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-email">
                  Email *
                </label>
                <input
                  type="email"
                  id="w-email"
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
              <div className={`form-group${errors.phone ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-phone">
                  Phone *
                </label>
                <input
                  type="tel"
                  id="w-phone"
                  name="phone"
                  className="form-input"
                  placeholder="Your phone number"
                  value={formData.phone}
                  onChange={handleChange}
                  required
                />
                <span className="form-error">
                  Please enter your phone number
                </span>
              </div>
            </div>
            <div
              className={`form-group${errors.emergencyName ? ' error' : ''}`}
            >
              <label className="form-label" htmlFor="w-emergency-name">
                Emergency Contact Name *
              </label>
              <input
                type="text"
                id="w-emergency-name"
                name="emergencyName"
                className="form-input"
                placeholder="Emergency contact full name"
                value={formData.emergencyName}
                onChange={handleChange}
                required
              />
              <span className="form-error">
                Please enter an emergency contact name
              </span>
            </div>
            <div className="form-row">
              <div
                className={`form-group${errors.emergencyPhone ? ' error' : ''}`}
              >
                <label className="form-label" htmlFor="w-emergency-phone">
                  Emergency Contact Phone *
                </label>
                <input
                  type="tel"
                  id="w-emergency-phone"
                  name="emergencyPhone"
                  className="form-input"
                  placeholder="Emergency contact phone"
                  value={formData.emergencyPhone}
                  onChange={handleChange}
                  required
                />
                <span className="form-error">
                  Please enter an emergency contact phone
                </span>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="w-relationship">
                  Relationship
                </label>
                <select
                  id="w-relationship"
                  name="relationship"
                  className="form-input"
                  value={formData.relationship}
                  onChange={handleChange}
                >
                  <option value="">Select...</option>
                  <option value="parent">Parent</option>
                  <option value="spouse">Spouse</option>
                  <option value="sibling">Sibling</option>
                  <option value="friend">Friend</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2 -- Acknowledgement of Risk */}
          <div className="waiver-section">
            <h3>2. Acknowledgement of Risk</h3>
            <div className="waiver-text">
              <ol>
                <li>
                  I understand airsoft involves physical activity and inherent
                  risks including but not limited to bruising, sprains, and eye
                  injury.
                </li>
                <li>
                  I confirm I will wear mandatory face and eye protection at all
                  times during gameplay.
                </li>
                <li>
                  I agree to follow all safety rules, marshal instructions, and
                  FPS limits.
                </li>
                <li>
                  I accept that Air Action Sports, its staff, and site owners are
                  not liable for injuries sustained during gameplay, provided
                  reasonable safety measures are in place.
                </li>
                <li>
                  I confirm I am physically fit to participate and have no
                  medical conditions that would prevent safe participation.
                </li>
                <li>
                  I understand that failure to follow safety rules may result in
                  immediate removal from the event without refund.
                </li>
              </ol>
            </div>
          </div>

          {/* Section 3 -- Consent & Signature */}
          <div className="waiver-section">
            <h3>3. Consent &amp; Signature</h3>

            <div
              className={`form-group${errors.agree ? ' error' : ''}`}
              style={{ marginBottom: '1rem' }}
            >
              <label
                className="form-label"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  id="w-agree"
                  name="agree"
                  checked={formData.agree}
                  onChange={handleChange}
                  required
                  style={{ marginTop: '3px', accentColor: 'var(--orange)' }}
                />
                <span>
                  I have read, understood, and agree to the terms above *
                </span>
              </label>
              <span className="form-error">
                You must agree to the terms to continue
              </span>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label
                className="form-label"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  id="w-privacy"
                  name="privacy"
                  checked={formData.privacy}
                  onChange={handleChange}
                  style={{ marginTop: '3px', accentColor: 'var(--orange)' }}
                />
                <span>
                  I consent to Air Action Sports storing my data as outlined in
                  the{' '}
                  <Link
                    to="/privacy"
                    style={{
                      color: 'var(--orange)',
                      textDecoration: 'underline',
                    }}
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </div>

            <div className={`form-group${errors.signature ? ' error' : ''}`}>
              <label className="form-label">Digital Signature *</label>
              <p
                style={{
                  fontSize: '12px',
                  color: 'var(--olive-light)',
                  marginBottom: '0.5rem',
                }}
              >
                Type your full name as your digital signature
              </p>
              <div className="signature-field">
                <input
                  type="text"
                  id="w-signature"
                  name="signature"
                  placeholder="Your full name"
                  value={formData.signature}
                  onChange={handleChange}
                  required
                />
              </div>
              <span className="form-error">
                Please type your full name as your signature
              </span>
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label className="form-label" htmlFor="w-date">
                Date
              </label>
              <input
                type="text"
                id="w-date"
                name="date"
                className="form-input"
                readOnly
                value={todayFormatted}
              />
            </div>
          </div>

          {/* Section 4 -- Under 18s */}
          <div className="waiver-section">
            <div className="under18-section">
              <h3>Parent / Guardian Consent (Under 18s Only)</h3>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="w-parent-name">
                    Parent / Guardian Name
                  </label>
                  <input
                    type="text"
                    id="w-parent-name"
                    name="parentName"
                    className="form-input"
                    placeholder="Parent or guardian full name"
                    value={formData.parentName}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-group">
                  <label
                    className="form-label"
                    htmlFor="w-parent-relationship"
                  >
                    Relationship to Player
                  </label>
                  <input
                    type="text"
                    id="w-parent-relationship"
                    name="parentRelationship"
                    className="form-input"
                    placeholder="e.g. Mother, Father, Guardian"
                    value={formData.parentRelationship}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label
                  className="form-label"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    id="w-parent-consent"
                    name="parentConsent"
                    checked={formData.parentConsent}
                    onChange={handleChange}
                    style={{ marginTop: '3px', accentColor: 'var(--orange)' }}
                  />
                  <span>
                    I am the parent/guardian and give consent for the named
                    player to participate
                  </span>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Parent / Guardian Signature
                </label>
                <div className="signature-field">
                  <input
                    type="text"
                    id="w-parent-signature"
                    name="parentSignature"
                    placeholder="Parent/guardian full name"
                    value={formData.parentSignature}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="waiver-actions">
            <button type="submit" className="form-submit">
              &#9658; Submit Waiver
            </button>
            <button
              type="button"
              className="btn-print"
              onClick={() => window.print()}
            >
              Print Waiver
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
