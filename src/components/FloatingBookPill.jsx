import { useState, useEffect } from 'react';
import { siteConfig } from '../data/siteConfig';

export default function FloatingBookPill() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      const winHeight = window.innerHeight;
      const nearBottom = scrollY + winHeight > docHeight - 400;
      setVisible(scrollY > 600 && !nearBottom);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <a href={siteConfig.bookingLink} target="_blank" rel="noopener noreferrer" className={`floating-book${visible ? ' visible' : ''}`}>
      &#9658; Book Now
    </a>
  );
}
