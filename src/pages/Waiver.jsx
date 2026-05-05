import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/waiver.css';

export default function Waiver() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [attendee, setAttendee] = useState(null);
  const [event, setEvent] = useState(null);
  const [waiverDoc, setWaiverDoc] = useState(null);
  const [alreadySigned, setAlreadySigned] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    dob: '',
    email: '',
    phone: '',
    emergencyName: '',
    emergencyPhone: '',
    relationship: '',
    medicalConditions: '',
    agree: false,
    erecordsConsent: false,
    privacy: false,
    signature: '',
    juryTrialInitials: '',
    // Parent / guardian (required if minor — both 12-15 and 16-17)
    parentName: '',
    parentRelationship: '',
    parentConsent: false,
    parentSignature: '',
    parentPhoneDayOfEvent: '',
    parentInitials: '',
    // On-site supervising adult (required only for 12-15)
    supervisingAdultSameAsParent: true,
    supervisingAdultName: '',
    supervisingAdultRelationship: '',
    supervisingAdultSignature: '',
    supervisingAdultPhoneDayOfEvent: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  }, []);

  const expectedName = useMemo(() => {
    if (!attendee) return '';
    return [attendee.firstName, attendee.lastName].filter(Boolean).join(' ').trim();
  }, [attendee]);

  const normalizeName = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const signatureMatches = !expectedName || normalizeName(formData.signature) === normalizeName(expectedName);

  // 4-tier age policy mirroring worker/routes/waivers.js ageTier().
  const computedAge = useMemo(() => {
    if (!formData.dob) return null;
    const d = new Date(formData.dob);
    if (Number.isNaN(d.getTime())) return null;
    return (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  }, [formData.dob]);
  const ageTier = useMemo(() => {
    if (computedAge == null) return null;
    if (computedAge < 12) return 'BLOCKED';
    if (computedAge < 16) return '12-15';
    if (computedAge < 18) return '16-17';
    return '18+';
  }, [computedAge]);
  const isMinor = ageTier === '12-15' || ageTier === '16-17';
  const needsSupervisingAdult = ageTier === '12-15';

  // When the user toggles "supervising adult is same as parent" we mirror
  // parent fields into the supervising adult fields so the server gets a
  // populated record either way.
  useEffect(() => {
    if (!needsSupervisingAdult) return;
    if (!formData.supervisingAdultSameAsParent) return;
    setFormData((p) => ({
      ...p,
      supervisingAdultName: p.parentName,
      supervisingAdultRelationship: p.parentRelationship,
      supervisingAdultSignature: p.parentSignature,
      supervisingAdultPhoneDayOfEvent: p.parentPhoneDayOfEvent,
    }));
  }, [
    needsSupervisingAdult,
    formData.supervisingAdultSameAsParent,
    formData.parentName,
    formData.parentRelationship,
    formData.parentSignature,
    formData.parentPhoneDayOfEvent,
  ]);

  // Load attendee info when token is present
  useEffect(() => {
    if (!token) {
      setLoading(false);
      setLoadError('No waiver link provided. Please use the link from your booking email.');
      return;
    }
    let cancelled = false;
    fetch(`/api/waivers/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Invalid waiver link');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setAttendee(data.attendee);
        setEvent(data.event);
        setWaiverDoc(data.waiverDocument || null);
        setAlreadySigned(!!data.attendee.alreadySigned);
        // Pre-fill form from attendee + buyer info
        setFormData((prev) => ({
          ...prev,
          name: [data.attendee.firstName, data.attendee.lastName].filter(Boolean).join(' '),
          email: data.attendee.email || '',
          phone: data.attendee.phone || '',
        }));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message || 'Could not load waiver.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  };

  const validate = () => {
    const errs = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.name.trim()) errs.name = true;
    if (!formData.dob) errs.dob = true;
    if (!formData.email.trim() || !emailRegex.test(formData.email.trim())) errs.email = true;
    if (!formData.phone.trim()) errs.phone = true;
    if (!formData.emergencyName.trim()) errs.emergencyName = true;
    if (!formData.emergencyPhone.trim()) errs.emergencyPhone = true;
    if (!formData.agree) errs.agree = true;
    if (!formData.erecordsConsent) errs.erecordsConsent = true;
    if (!formData.signature.trim()) {
      errs.signature = 'Please type your full name as your signature';
    } else if (expectedName && normalizeName(formData.signature) !== normalizeName(expectedName)) {
      errs.signature = `Signature must match the name on your ticket: ${expectedName}`;
    }

    // Jury trial waiver initials — required for everyone (Waiver §22)
    if (!formData.juryTrialInitials.trim()) {
      errs.juryTrialInitials = 'Initials acknowledging the Jury Trial Waiver are required';
    }

    // 4-tier age policy
    if (ageTier === 'BLOCKED') {
      errs.dob = 'Players must be at least 12 years old to participate at any AAS event.';
    }
    if (isMinor) {
      if (!formData.parentName.trim()) errs.parentName = true;
      if (!formData.parentSignature.trim()) errs.parentSignature = true;
      if (!formData.parentConsent) errs.parentConsent = true;
      if (!formData.parentInitials.trim()) errs.parentInitials = 'Parent/Guardian initials acknowledging the Age Policy are required';
    }
    if (needsSupervisingAdult) {
      // Even when "same as parent" is toggled on, we require the user to
      // confirm the parent fields (which are mirrored over). If they un-toggle,
      // they fill the supervising adult block separately.
      if (!formData.supervisingAdultName.trim()) errs.supervisingAdultName = true;
      if (!formData.supervisingAdultSignature.trim()) errs.supervisingAdultSignature = true;
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/waivers/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Could not submit waiver.');
        setSubmitting(false);
        return;
      }
      setShowConfirmation(true);
      window.scrollTo(0, 0);
    } catch {
      setSubmitError('Network error — please try again.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <SEO title="Player Waiver | Air Action Sports" canonical="https://airactionsport.com/waiver" />
        <div className="page-content"><p style={{ color: 'var(--olive-light)' }}>Loading waiver…</p></div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <SEO title="Waiver Error | Air Action Sports" canonical="https://airactionsport.com/waiver" />
        <div className="page-content">
          <div className="section-label">&#9632; Waiver</div>
          <h1 className="section-title">Link Invalid.</h1>
          <div className="divider"></div>
          <p style={{ color: 'var(--olive-light)' }}>{loadError}</p>
          <Link to="/" className="btn-primary" style={{ display: 'inline-block', marginTop: '1.5rem' }}>
            &#9658; Back to Home
          </Link>
        </div>
      </>
    );
  }

  if (alreadySigned) {
    return (
      <>
        <SEO title="Waiver Signed | Air Action Sports" canonical="https://airactionsport.com/waiver" />
        <div className="page-content">
          <div className="section-label">&#9632; Waiver</div>
          <h1 className="section-title">Already Signed.</h1>
          <div className="divider"></div>
          <p style={{ color: 'var(--olive-light)' }}>
            {attendee?.firstName}'s waiver for {event?.title} has already been signed. You're cleared for action.
          </p>
          <Link to="/" className="btn-primary" style={{ display: 'inline-block', marginTop: '1.5rem' }}>
            &#9658; Back to Home
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <SEO
        title="Player Waiver | Air Action Sports"
        description="Complete your digital liability waiver before attending an Air Action Sports airsoft event."
        canonical="https://airactionsport.com/waiver"
      />

      {showConfirmation && (
        <div className={`waiver-confirmation active`}>
          <h2>&#9632; Waiver Submitted!</h2>
          <p>
            Your waiver has been received. You're cleared for action. See you on the battlefield.
          </p>
          <Link to="/" className="form-submit" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Back to Home
          </Link>
        </div>
      )}

      <div className="page-content" style={showConfirmation ? { display: 'none' } : undefined}>
        <div className="section-label">&#9632; Player Waiver</div>
        <h2 className="section-title">Safety First.</h2>
        <div className="divider"></div>

        {event && (
          <div className="waiver-intro">
            <p>
              <strong>Event:</strong> {event.title} — {event.displayDate} — {event.location}
            </p>
            <p>
              Each player must complete this waiver before gameplay. Under 18? A parent or guardian must
              complete the bottom section.
            </p>
          </div>
        )}

        {submitError && (
          <div className="booking-error" style={{ marginBottom: '1.5rem' }}>{submitError}</div>
        )}

        <form id="waiver-form" onSubmit={handleSubmit} noValidate>
          {/* Section 1 -- Player Information */}
          <div className="waiver-section">
            <h3>1. Player Information</h3>
            <div className="form-row">
              <div className={`form-group${errors.name ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-name">Full Name *</label>
                <input type="text" id="w-name" name="name" className="form-input"
                  value={formData.name} onChange={handleChange} required />
                <span className="form-error">Please enter your full name</span>
              </div>
              <div className={`form-group${errors.dob ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-dob">Date of Birth *</label>
                <input type="date" id="w-dob" name="dob" className="form-input"
                  value={formData.dob} onChange={handleChange} required />
                <span className="form-error">Please enter your date of birth</span>
              </div>
            </div>
            <div className="form-row">
              <div className={`form-group${errors.email ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-email">Email *</label>
                <input type="email" id="w-email" name="email" className="form-input"
                  value={formData.email} onChange={handleChange} required />
                <span className="form-error">Please enter a valid email</span>
              </div>
              <div className={`form-group${errors.phone ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-phone">Phone *</label>
                <input type="tel" id="w-phone" name="phone" className="form-input"
                  value={formData.phone} onChange={handleChange} required />
                <span className="form-error">Please enter your phone number</span>
              </div>
            </div>
            <div className={`form-group${errors.emergencyName ? ' error' : ''}`}>
              <label className="form-label" htmlFor="w-emergency-name">Emergency Contact Name *</label>
              <input type="text" id="w-emergency-name" name="emergencyName" className="form-input"
                placeholder="Emergency contact full name"
                value={formData.emergencyName} onChange={handleChange} required />
              <span className="form-error">Please enter an emergency contact name</span>
            </div>
            <div className="form-row">
              <div className={`form-group${errors.emergencyPhone ? ' error' : ''}`}>
                <label className="form-label" htmlFor="w-emergency-phone">Emergency Contact Phone *</label>
                <input type="tel" id="w-emergency-phone" name="emergencyPhone" className="form-input"
                  value={formData.emergencyPhone} onChange={handleChange} required />
                <span className="form-error">Please enter an emergency contact phone</span>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="w-relationship">Relationship</label>
                <select id="w-relationship" name="relationship" className="form-input"
                  value={formData.relationship} onChange={handleChange}>
                  <option value="">Select...</option>
                  <option value="parent">Parent</option>
                  <option value="spouse">Spouse</option>
                  <option value="sibling">Sibling</option>
                  <option value="friend">Friend</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="w-medical">
                Known Medical Conditions / Allergies <span style={{ color: 'var(--olive-light)', fontWeight: 400 }}>(optional but encouraged)</span>
              </label>
              <textarea id="w-medical" name="medicalConditions" rows={3} className="form-input"
                placeholder="e.g. asthma, bee sting allergy, dietary restrictions — anything our medics should know"
                value={formData.medicalConditions} onChange={handleChange}
                style={{ resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            {/* Age tier hint when DOB is filled. Renders an outright error when
                the participant is under 12 (we hard-block; they can't sign). */}
            {ageTier === 'BLOCKED' && (
              <div className="booking-error" style={{ marginTop: '0.75rem' }}>
                <strong>Sorry — players must be at least 12 years old.</strong> Please contact us if you have questions.
              </div>
            )}
            {ageTier && ageTier !== 'BLOCKED' && (
              <div style={{ fontSize: 12, color: 'var(--olive-light)', marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(212,84,26,0.05)', borderLeft: '3px solid var(--orange)' }}>
                <strong style={{ color: 'var(--orange)' }}>Age tier: {ageTier}</strong> &mdash;{' '}
                {ageTier === '12-15' && 'Parent or legal guardian consent + on-site supervising adult required.'}
                {ageTier === '16-17' && 'Parent or legal guardian written consent required (no on-site adult required).'}
                {ageTier === '18+' && 'Adult — you can sign independently.'}
              </div>
            )}
          </div>

          {/* Section 2 -- Acknowledgement of Risk. Body rendered from the
              versioned waiver_documents row so the text and its hash stay in
              sync with what the server will snapshot on submit. */}
          <div className="waiver-section">
            <h3>2. Acknowledgement of Risk</h3>
            <div
              className="waiver-text"
              dangerouslySetInnerHTML={{ __html: waiverDoc?.bodyHtml || '' }}
            />
            {waiverDoc && (
              <p style={{ fontSize: '11px', color: 'var(--olive-light)', marginTop: '0.5rem' }}>
                Waiver version {waiverDoc.version}
              </p>
            )}
          </div>

          {/* Section 3 -- Consent & Signature */}
          <div className="waiver-section">
            <h3>3. Consent &amp; Signature</h3>

            <div className={`form-group${errors.agree ? ' error' : ''}`} style={{ marginBottom: '1rem' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" id="w-agree" name="agree"
                  checked={formData.agree} onChange={handleChange} required
                  style={{ marginTop: '3px', accentColor: 'var(--orange)' }} />
                <span>I have read, understood, and agree to the terms above *</span>
              </label>
              <span className="form-error">You must agree to the terms to continue</span>
            </div>

            {/* ESIGN §7001(c) e-records consent \u2014 distinct from terms agreement. */}
            <div className={`form-group${errors.erecordsConsent ? ' error' : ''}`} style={{ marginBottom: '1rem' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" id="w-erecords" name="erecordsConsent"
                  checked={formData.erecordsConsent} onChange={handleChange} required
                  style={{ marginTop: '3px', accentColor: 'var(--orange)' }} />
                <span>
                  I consent to sign and receive this waiver electronically. I understand I
                  may request a paper copy by contacting Air Action Sports. *
                </span>
              </label>
              <span className="form-error">Electronic records consent is required to sign online</span>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" id="w-privacy" name="privacy"
                  checked={formData.privacy} onChange={handleChange}
                  style={{ marginTop: '3px', accentColor: 'var(--orange)' }} />
                <span>
                  I consent to Air Action Sports storing my data as outlined in the{' '}
                  <Link to="/privacy" style={{ color: 'var(--orange)', textDecoration: 'underline' }}>
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </div>

            <div className={`form-group${errors.signature || (formData.signature && !signatureMatches) ? ' error' : ''}`}>
              <label className="form-label">Digital Signature *</label>
              <p style={{ fontSize: '12px', color: 'var(--olive-light)', marginBottom: '0.5rem' }}>
                Type your full name exactly as it appears on your ticket:{' '}
                <strong style={{ color: 'var(--tan)' }}>{expectedName || '—'}</strong>
              </p>
              <div className="signature-field">
                <input type="text" id="w-signature" name="signature" placeholder={expectedName || 'Your full name'}
                  value={formData.signature} onChange={handleChange} required autoComplete="off" />
              </div>
              {formData.signature && !signatureMatches && (
                <span className="form-error" style={{ display: 'block' }}>
                  Signature must match the name on your ticket: <strong>{expectedName}</strong>
                </span>
              )}
              {errors.signature && typeof errors.signature === 'string' && (
                <span className="form-error" style={{ display: 'block' }}>{errors.signature}</span>
              )}
            </div>

            {/* Jury Trial Waiver §22 — separate initials per the document. */}
            <div className={`form-group${errors.juryTrialInitials ? ' error' : ''}`} style={{ marginTop: '1.25rem' }}>
              <label className="form-label" htmlFor="w-jury-initials">
                Jury Trial Waiver Initials *
              </label>
              <p style={{ fontSize: '12px', color: 'var(--olive-light)', marginBottom: '0.5rem' }}>
                Per Section 22, by initialing here I waive my right to a jury trial in any proceeding arising from this Agreement or the Activities.
              </p>
              <input type="text" id="w-jury-initials" name="juryTrialInitials" className="form-input"
                placeholder="e.g. JD"
                value={formData.juryTrialInitials} onChange={handleChange}
                maxLength={10}
                style={{ maxWidth: 200, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700 }}
                required />
              {errors.juryTrialInitials && typeof errors.juryTrialInitials === 'string' && (
                <span className="form-error" style={{ display: 'block' }}>{errors.juryTrialInitials}</span>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label className="form-label" htmlFor="w-date">Date</label>
              <input type="text" id="w-date" name="date" className="form-input" readOnly value={todayFormatted} />
            </div>
          </div>

          {/* Section 4 — Parent / Guardian (only for 12-15 and 16-17). Hidden
              entirely when the participant is 18+ or DOB is empty. */}
          {isMinor && (
            <div className="waiver-section">
              <div className="under18-section">
                <h3>Parent / Guardian Consent</h3>
                <p style={{ fontSize: '13px', color: 'var(--olive-light)', marginBottom: '1rem' }}>
                  Required for ages 12&ndash;17. {needsSupervisingAdult && 'For ages 12-15, an on-site supervising adult is also required (next section).'}
                </p>
                <div className="form-row">
                  <div className={`form-group${errors.parentName ? ' error' : ''}`}>
                    <label className="form-label" htmlFor="w-parent-name">Parent / Guardian Full Legal Name *</label>
                    <input type="text" id="w-parent-name" name="parentName" className="form-input"
                      value={formData.parentName} onChange={handleChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="w-parent-relationship">Relationship to Player</label>
                    <input type="text" id="w-parent-relationship" name="parentRelationship" className="form-input"
                      placeholder="e.g. Mother, Father, Guardian"
                      value={formData.parentRelationship} onChange={handleChange} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="w-parent-phone">Parent / Guardian Phone (Day of Event)</label>
                  <input type="tel" id="w-parent-phone" name="parentPhoneDayOfEvent" className="form-input"
                    placeholder="Phone we can reach you on event day"
                    value={formData.parentPhoneDayOfEvent} onChange={handleChange} />
                </div>
                <div className={`form-group${errors.parentConsent ? ' error' : ''}`} style={{ marginBottom: '1rem' }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input type="checkbox" id="w-parent-consent" name="parentConsent"
                      checked={formData.parentConsent} onChange={handleChange}
                      style={{ marginTop: '3px', accentColor: 'var(--orange)' }} />
                    <span>I am the parent/legal guardian and consent to the named player&rsquo;s participation. *</span>
                  </label>
                </div>
                <div className={`form-group${errors.parentSignature ? ' error' : ''}`}>
                  <label className="form-label">Parent / Guardian Signature *</label>
                  <div className="signature-field">
                    <input type="text" id="w-parent-signature" name="parentSignature"
                      placeholder="Parent/guardian full name"
                      value={formData.parentSignature} onChange={handleChange} />
                  </div>
                </div>
                <div className={`form-group${errors.parentInitials ? ' error' : ''}`} style={{ marginTop: '1rem' }}>
                  <label className="form-label" htmlFor="w-parent-initials">Initials acknowledging Age Participation Policy *</label>
                  <input type="text" id="w-parent-initials" name="parentInitials" className="form-input"
                    placeholder="e.g. JS"
                    value={formData.parentInitials} onChange={handleChange}
                    maxLength={10}
                    style={{ maxWidth: 200, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700 }} />
                  {errors.parentInitials && typeof errors.parentInitials === 'string' && (
                    <span className="form-error" style={{ display: 'block' }}>{errors.parentInitials}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Section 5 — On-Site Supervising Adult (12-15 only).
              Defaults to the parent fields; toggling off lets the user fill
              a separate person (e.g., parent can't make it but uncle can). */}
          {needsSupervisingAdult && (
            <div className="waiver-section">
              <div className="under18-section">
                <h3>On-Site Supervising Adult</h3>
                <p style={{ fontSize: '13px', color: 'var(--olive-light)', marginBottom: '0.75rem' }}>
                  Required for ages 12&ndash;15. The supervising adult must be physically present on-site for the full event duration and is personally responsible for the minor&rsquo;s supervision and PPE compliance.
                </p>
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <input type="checkbox" id="w-supervising-same"
                      name="supervisingAdultSameAsParent"
                      checked={formData.supervisingAdultSameAsParent}
                      onChange={handleChange}
                      style={{ accentColor: 'var(--orange)' }} />
                    <span>The supervising adult is the same person as the parent/guardian above.</span>
                  </label>
                </div>

                {!formData.supervisingAdultSameAsParent && (
                  <>
                    <div className="form-row">
                      <div className={`form-group${errors.supervisingAdultName ? ' error' : ''}`}>
                        <label className="form-label" htmlFor="w-supervising-name">Supervising Adult Full Legal Name *</label>
                        <input type="text" id="w-supervising-name" name="supervisingAdultName" className="form-input"
                          value={formData.supervisingAdultName} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="w-supervising-rel">Relationship to Minor</label>
                        <input type="text" id="w-supervising-rel" name="supervisingAdultRelationship" className="form-input"
                          placeholder="e.g. Uncle, Family Friend"
                          value={formData.supervisingAdultRelationship} onChange={handleChange} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="w-supervising-phone">Supervising Adult Phone (Day of Event)</label>
                      <input type="tel" id="w-supervising-phone" name="supervisingAdultPhoneDayOfEvent" className="form-input"
                        value={formData.supervisingAdultPhoneDayOfEvent} onChange={handleChange} />
                    </div>
                    <div className={`form-group${errors.supervisingAdultSignature ? ' error' : ''}`}>
                      <label className="form-label">Supervising Adult Signature *</label>
                      <div className="signature-field">
                        <input type="text" id="w-supervising-signature" name="supervisingAdultSignature"
                          placeholder="Supervising adult full name"
                          value={formData.supervisingAdultSignature} onChange={handleChange} />
                      </div>
                    </div>
                  </>
                )}

                {formData.supervisingAdultSameAsParent && formData.parentName && (
                  <p style={{ fontSize: '12px', color: 'var(--olive-light)', fontStyle: 'italic' }}>
                    Using parent/guardian details: <strong style={{ color: 'var(--tan)' }}>{formData.parentName}</strong>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="waiver-actions">
            <button type="submit" className="form-submit" disabled={submitting}>
              {submitting ? 'Submitting…' : '▶ Submit Waiver'}
            </button>
            <button type="button" className="btn-print" onClick={() => window.print()}>
              Print Waiver
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
