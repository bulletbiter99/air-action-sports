import { useState, useEffect } from 'react';
import { eventInstantMs } from '../utils/eventTime';

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

// `targetDate` is an event's `dateIso` — naive America/Denver wall clock with no
// offset. `new Date(naive)` would parse it in the VIEWER's zone, so the old
// countdown was correct only for Mountain visitors and ran fast everywhere else
// (2h on the East Coast, 7h in the UK), hitting zero while the op was still
// hours away. Resolve the real instant instead.
//
// Two branches on purpose: eventInstantMs returns null for a value that already
// carries a 'Z' or a numeric offset, i.e. a genuine absolute timestamp. The hook
// is named generically and only ever receives naive strings today, but a future
// caller passing a real timestamp should still work rather than freeze at zero.
function calcDiff(targetDate) {
  const resolved = eventInstantMs(targetDate);
  const diff = (resolved == null ? Date.parse(targetDate) : resolved) - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return { days: '00', hours: '00', mins: '00', secs: '00' };

  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return { days: pad(d), hours: pad(h), mins: pad(m), secs: pad(s) };
}
