import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

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
    <Link to="/booking" className={`floating-book${visible ? ' visible' : ''}`}>
      &#9658; Book Now
    </Link>
  );
}
