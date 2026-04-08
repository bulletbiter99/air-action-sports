import { useState, useEffect } from 'react';

function pad(n) {
  return String(n).padStart(2, '0');
}

export default function useCountdown(targetDate) {
  const [timeLeft, setTimeLeft] = useState(() => calcDiff(targetDate));

  useEffect(() => {
    const id = setInterval(() => {
      setTimeLeft(calcDiff(targetDate));
    }, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return timeLeft;
}

function calcDiff(targetDate) {
  const diff = new Date(targetDate) - new Date();
  if (diff <= 0) return { days: '00', hours: '00', mins: '00', secs: '00' };

  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return { days: pad(d), hours: pad(h), mins: pad(m), secs: pad(s) };
}
