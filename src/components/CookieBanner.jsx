import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function CookieBanner() {
  const [visible, setVisible] = useState(
    () => !localStorage.getItem('cookieConsent')
  );

  if (!visible) return null;

  const handleAccept = () => {
    localStorage.setItem('cookieConsent', 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem('cookieConsent', 'declined');
    setVisible(false);
  };

  return (
    <div className="cookie-banner visible">
      <p>
        We use cookies to improve your experience. By continuing to use this site you agree to our{' '}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
      <div className="cookie-btns">
        <button className="cookie-accept" onClick={handleAccept}>Accept</button>
        <button className="cookie-decline" onClick={handleDecline}>Decline</button>
      </div>
    </div>
  );
}
