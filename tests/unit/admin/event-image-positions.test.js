import { describe, it, expect } from 'vitest';
import { normalizeImagePosition, parseEventBody } from '../../../worker/routes/admin/events.js';
import { formatEvent } from '../../../worker/lib/formatters.js';

describe('normalizeImagePosition', () => {
  it('returns null for empty / center / null (use page default)', () => {
    expect(normalizeImagePosition(null)).toBe(null);
    expect(normalizeImagePosition(undefined)).toBe(null);
    expect(normalizeImagePosition('')).toBe(null);
    expect(normalizeImagePosition('  ')).toBe(null);
    expect(normalizeImagePosition('center')).toBe(null);
    expect(normalizeImagePosition('50% 50%')).toBe(null); // collapses to default
  });

  it('canonicalizes an "x% y%" pair (rounded ints)', () => {
    expect(normalizeImagePosition('20% 80%')).toBe('20% 80%');
    expect(normalizeImagePosition('19.6% 80.2%')).toBe('20% 80%');
  });

  it('maps keywords onto the right axes', () => {
    expect(normalizeImagePosition('top')).toBe('50% 0%');
    expect(normalizeImagePosition('bottom')).toBe('50% 100%');
    expect(normalizeImagePosition('left')).toBe('0% 50%');
    expect(normalizeImagePosition('right')).toBe('100% 50%');
    expect(normalizeImagePosition('right bottom')).toBe('100% 100%');
  });

  it('clamps out-of-range percentages', () => {
    expect(normalizeImagePosition('150% -10%')).toBe('100% 0%');
  });

  it('rejects unsafe / unparseable input by defaulting to null (no CSS injection)', () => {
    expect(normalizeImagePosition('red; background:url(http://evil)')).toBe(null);
    expect(normalizeImagePosition('50px 30px')).toBe(null);
    expect(normalizeImagePosition('calc(50%)')).toBe(null);
    expect(normalizeImagePosition('expression(alert(1))')).toBe(null);
  });

  it('keeps at most two tokens', () => {
    expect(normalizeImagePosition('20% 80% 99%')).toBe('20% 80%');
  });
});

describe('parseEventBody — image positions', () => {
  it('maps camelCase positions into the normalized snake_case patch', () => {
    const { patch } = parseEventBody(
      { cardImagePosition: '20% 80%', heroImagePosition: 'top', bannerImagePosition: 'center' },
      { partial: true },
    );
    expect(patch.card_image_position).toBe('20% 80%');
    expect(patch.hero_image_position).toBe('50% 0%');
    expect(patch.banner_image_position).toBe(null); // center → default
  });

  it('omits position columns absent from the body (partial update safety)', () => {
    const { patch } = parseEventBody({ cardImagePosition: '10% 10%' }, { partial: true });
    expect(patch.card_image_position).toBe('10% 10%');
    expect('hero_image_position' in patch).toBe(false);
    expect('banner_image_position' in patch).toBe(false);
  });
});

describe('formatEvent — image positions', () => {
  it('surfaces the position columns to the API shape', () => {
    const out = formatEvent({
      id: 'e1', title: 'T', base_price_cents: 4000,
      card_image_position: '20% 80%',
      hero_image_position: '50% 0%',
      banner_image_position: null,
    });
    expect(out.cardImagePosition).toBe('20% 80%');
    expect(out.heroImagePosition).toBe('50% 0%');
    expect(out.bannerImagePosition).toBe(null);
  });
});
