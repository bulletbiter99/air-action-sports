// Conversion-aware "spots" signal for event cards / detail pages.
//
// We deliberately do NOT render a raw "X of Y taken" fill bar: most events
// have large capacity (e.g. 150) and few early sales, so an almost-empty bar
// reads as reverse social proof ("nobody's going") and suppresses bookings.
// Instead this returns a positively-framed signal that escalates with demand:
//
//   - remaining === 0           → { tone: 'soldout',  text: 'Sold out' }
//   - remaining <= LOW_LEFT     → { tone: 'urgent',   text: 'Only N spots left' }
//   - taken    >= MIN_MOMENTUM  → { tone: 'momentum', text: 'N players locked in' }
//   - otherwise                 → null  (too few sign-ups to show without
//                                         looking empty — render nothing)
//
// total <= 0 (no capacity data) → null.

export const LOW_LEFT = 20;       // "Only N spots left" once remaining hits this
export const MIN_MOMENTUM = 10;   // need at least this many sales to brag

export function spotsSignal(taken, total) {
  const cap = Number(total) || 0;
  const sold = Math.max(0, Number(taken) || 0);
  if (cap <= 0) return null;

  const remaining = Math.max(0, cap - sold);

  if (remaining === 0) return { tone: 'soldout', text: 'Sold out' };
  if (remaining <= LOW_LEFT) {
    return { tone: 'urgent', text: `Only ${remaining} spot${remaining === 1 ? '' : 's'} left` };
  }
  if (sold >= MIN_MOMENTUM) {
    return { tone: 'momentum', text: `${sold} players locked in` };
  }
  return null;
}
