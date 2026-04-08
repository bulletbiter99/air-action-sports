import { useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import TickerBar from './TickerBar';

export default function Navbar({ showTicker, onHamburgerClick, isMobileMenuOpen }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      {showTicker && <TickerBar />}
      <nav className={scrolled ? 'scrolled' : ''}>
        <Link to="/" className="nav-logo">&#9658; Air Action Sports</Link>
        <div className="nav-links">
          <NavLink to="/#games">Games</NavLink>
          <NavLink to="/locations">Locations</NavLink>
          <NavLink to="/events">Events</NavLink>
          <NavLink to="/pricing">Pricing</NavLink>
          <NavLink to="/faq">FAQ</NavLink>
          <NavLink to="/contact">Contact</NavLink>
        </div>
        <Link to="/booking" className="nav-cta">Book Now</Link>
        <button
          className={`hamburger${isMobileMenuOpen ? ' active' : ''}`}
          aria-label="Menu"
          aria-expanded={isMobileMenuOpen}
          onClick={onHamburgerClick}
        >
          <span></span><span></span><span></span>
        </button>
      </nav>
    </>
  );
}
