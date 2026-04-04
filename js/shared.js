/* ============================================================
   AIR ACTION SPORTS — SHARED JAVASCRIPT
   Mobile menu, back-to-top, cookie consent
   ============================================================ */

/* Mobile Menu Toggle */
const hamburger = document.querySelector('.hamburger');
const mobileMenu = document.querySelector('.mobile-menu');

if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    mobileMenu.classList.toggle('active');
    hamburger.setAttribute('aria-expanded', hamburger.classList.contains('active'));
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
  });

  mobileMenu.querySelectorAll('a, .mobile-menu-cta').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('active');
      mobileMenu.classList.remove('active');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });
}

/* Back-to-Top Button */
const backToTop = document.querySelector('.back-to-top');
if (backToTop) {
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 400);
  });
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* Cookie Consent Banner */
const cookieBanner = document.querySelector('.cookie-banner');
if (cookieBanner && !localStorage.getItem('cookieConsent')) {
  cookieBanner.classList.add('visible');
}
const cookieAccept = document.querySelector('.cookie-accept');
if (cookieAccept) {
  cookieAccept.addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'accepted');
    cookieBanner.classList.remove('visible');
  });
}
const cookieDecline = document.querySelector('.cookie-decline');
if (cookieDecline) {
  cookieDecline.addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'declined');
    cookieBanner.classList.remove('visible');
  });
}
