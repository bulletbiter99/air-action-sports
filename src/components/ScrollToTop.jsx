import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      // Retry a few times — lazy-loaded pages may not have mounted yet when
      // we navigate cross-page (e.g. from / to /locations#ghost-town).
      let attempts = 0;
      const tryScroll = () => {
        const el = document.querySelector(hash);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
          return;
        }
        if (attempts++ < 15) timer = setTimeout(tryScroll, 50);
      };
      let timer = setTimeout(tryScroll, 0);
      return () => clearTimeout(timer);
    }

    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
}
