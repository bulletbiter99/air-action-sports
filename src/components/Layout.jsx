import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import MobileMenu from './MobileMenu';
import Footer from './Footer';
import FloatingBookPill from './FloatingBookPill';
import BackToTop from './BackToTop';
import CookieBanner from './CookieBanner';

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isHome = location.pathname === '/';

  // Toggle has-ticker class on body when on home page
  useEffect(() => {
    if (isHome) {
      document.body.classList.add('has-ticker');
    } else {
      document.body.classList.remove('has-ticker');
    }
    return () => document.body.classList.remove('has-ticker');
  }, [isHome]);

  return (
    <>
      <a href="#main-content" className="skip-to-content">Skip to content</a>
      <Navbar
        showTicker={isHome}
        onHamburgerClick={() => setMobileMenuOpen((prev) => !prev)}
        isMobileMenuOpen={mobileMenuOpen}
      />
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
      <main id="main-content">
        <Outlet />
      </main>
      <FloatingBookPill />
      <BackToTop />
      <CookieBanner />
      <Footer />
    </>
  );
}
