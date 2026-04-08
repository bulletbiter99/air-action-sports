import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function MobileMenu({ isOpen, onClose }) {
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <div className={`mobile-menu${isOpen ? ' active' : ''}`}>
      <Link to="/#games" onClick={onClose}>Games</Link>
      <Link to="/locations" onClick={onClose}>Locations</Link>
      <Link to="/events" onClick={onClose}>Events</Link>
      <Link to="/pricing" onClick={onClose}>Pricing</Link>
      <Link to="/faq" onClick={onClose}>FAQ</Link>
      <Link to="/contact" onClick={onClose}>Contact</Link>
      <Link to="/booking" className="mobile-menu-cta" onClick={onClose}>Book Now</Link>
    </div>
  );
}
