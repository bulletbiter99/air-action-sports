import { describe, it, expect } from 'vitest';
import { parseEventBody } from '../../../worker/routes/admin/events.js';

// The event type feeds the public pages' className variants
// (.event-type.milsim etc., all lowercase), but the column was operator
// free-text for its whole life — prod accumulated "MILSIM" / "Airsoft" /
// "AIRSOFT". parseEventBody now lowercases at the write boundary so DB rows
// stay consistent however the client posts (stale admin tabs and direct API
// calls can still send arbitrary casing after the form became a select).

describe('parseEventBody — type casing normalization', () => {
  it('lowercases an uppercase type', () => {
    const { patch } = parseEventBody({ type: 'MILSIM' }, { partial: true });
    expect(patch.type).toBe('milsim');
  });

  it('lowercases a mixed-case type', () => {
    const { patch } = parseEventBody({ type: 'Airsoft' }, { partial: true });
    expect(patch.type).toBe('airsoft');
  });

  it('passes an already-lowercase type through unchanged', () => {
    const { patch } = parseEventBody({ type: 'skirmish' }, { partial: true });
    expect(patch.type).toBe('skirmish');
  });

  it('preserves null (clear) semantics', () => {
    const { patch } = parseEventBody({ type: null }, { partial: true });
    expect(patch.type).toBe(null);
  });

  it('omits type entirely when absent from the body (partial-update safety)', () => {
    const { patch } = parseEventBody({ title: 'X' }, { partial: true });
    expect('type' in patch).toBe(false);
  });
});
