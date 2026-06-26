// Multi-day events — Phase 5. adaptEvent (src/hooks/useEvents.js) forwards the
// span fields the public pages branch on: endDateIso (raw), the operator's
// free-text displayDate, and a derived isMultiDay flag.

import { describe, it, expect } from 'vitest';
import { adaptEvent } from '../../../src/hooks/useEvents.js';

describe('adaptEvent — multi-day fields', () => {
  it('forwards endDateIso + displayDate and flags isMultiDay for a real span', () => {
    const out = adaptEvent({
      id: 'e',
      dateIso: '2026-06-20T16:00:00',
      endDateIso: '2026-06-21T22:00:00',
      displayDate: '20-21 June 2026',
    });
    expect(out.endDateIso).toBe('2026-06-21T22:00:00');
    expect(out.displayDate).toBe('20-21 June 2026');
    expect(out.isMultiDay).toBe(true);
  });

  it('isMultiDay=false (endDateIso null) when there is no end date', () => {
    const out = adaptEvent({ id: 'e', dateIso: '2026-06-20T16:00:00' });
    expect(out.endDateIso).toBe(null);
    expect(out.isMultiDay).toBe(false);
  });

  it('isMultiDay=false when the end is the SAME calendar day (timed, not a span)', () => {
    const out = adaptEvent({
      id: 'e',
      dateIso: '2026-06-20T08:00:00',
      endDateIso: '2026-06-20T22:00:00',
    });
    expect(out.isMultiDay).toBe(false);
  });
});
