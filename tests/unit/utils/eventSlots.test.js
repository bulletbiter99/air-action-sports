import { describe, it, expect } from 'vitest';
import { spotsSignal, LOW_LEFT, MIN_MOMENTUM } from '../../../src/utils/eventSlots.js';

describe('spotsSignal', () => {
  it('returns null when there is no capacity data', () => {
    expect(spotsSignal(0, 0)).toBeNull();
    expect(spotsSignal(5, null)).toBeNull();
    expect(spotsSignal(5, undefined)).toBeNull();
  });

  it('returns null below the head-count threshold (no reverse social proof)', () => {
    // Below MIN_MOMENTUM (50): show nothing rather than a small/unimpressive count.
    expect(spotsSignal(3, 150)).toBeNull();
    expect(spotsSignal(11, 150)).toBeNull();
    expect(spotsSignal(MIN_MOMENTUM - 1, 150)).toBeNull();
  });

  it('shows positive momentum once sign-ups cross the threshold', () => {
    expect(spotsSignal(MIN_MOMENTUM, 150)).toEqual({ tone: 'momentum', text: `${MIN_MOMENTUM} players locked in` });
    expect(spotsSignal(75, 150)).toEqual({ tone: 'momentum', text: '75 players locked in' });
  });

  it('escalates to urgent scarcity when few spots remain', () => {
    expect(spotsSignal(135, 150)).toEqual({ tone: 'urgent', text: 'Only 15 spots left' });
    expect(spotsSignal(150 - LOW_LEFT, 150)).toEqual({ tone: 'urgent', text: `Only ${LOW_LEFT} spots left` });
  });

  it('uses singular copy for a single remaining spot', () => {
    expect(spotsSignal(149, 150)).toEqual({ tone: 'urgent', text: 'Only 1 spot left' });
  });

  it('reports sold out when capacity is reached or exceeded', () => {
    expect(spotsSignal(150, 150)).toEqual({ tone: 'soldout', text: 'Sold out' });
    expect(spotsSignal(160, 150)).toEqual({ tone: 'soldout', text: 'Sold out' });
  });

  it('urgent takes priority over momentum near capacity', () => {
    // 145 sold of 150 → both "lots locked in" and "few left" are true; scarcity wins.
    expect(spotsSignal(145, 150).tone).toBe('urgent');
  });

  it('coerces non-finite/negative taken to a floor of 0', () => {
    expect(spotsSignal(-5, 150)).toBeNull(); // 0 sold, lots left → nothing
  });
});
