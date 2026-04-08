import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      // Wait a tick so the DOM has rendered before scrolling to hash
      const timer = setTimeout(() => {
        const el = document.querySelector(hash);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }, 0);
      return () => clearTimeout(timer);
    }

    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
}
