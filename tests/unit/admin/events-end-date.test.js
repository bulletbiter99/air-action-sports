import { describe, it, expect } from 'vitest';
import { parseEventBody } from '../../../worker/routes/admin/events.js';
import { formatEvent } from '../../../worker/lib/formatters.js';

// Multi-day events — Phase 1. The optional end_date_iso span column is parsed,
// normalized, and ordering-validated in parseEventBody, and surfaced by
// formatEvent. NULL/absent means single-day (end == start == date_iso).

describe('parseEventBody — multi-day end date', () => {
  it('maps endDateIso → end_date_iso', () => {
    const { patch } = parseEventBody({ endDateIso: '2026-06-21T22:00:00' }, { partial: true });
    expect(patch.end_date_iso).toBe('2026-06-21T22:00:00');
  });

  it("treats '' / null as clearing the span (→ null)", () => {
    expect(parseEventBody({ endDateIso: '' }, { partial: true }).patch.end_date_iso).toBe(null);
    expect(parseEventBody({ endDateIso: null }, { partial: true }).patch.end_date_iso).toBe(null);
  });

  it('omits end_date_iso entirely when absent from the body (partial-update safety)', () => {
    const { patch } = parseEventBody({ title: 'X' }, { partial: true });
    expect('end_date_iso' in patch).toBe(false);
  });

  it('rejects an unparseable end date', () => {
    const { error } = parseEventBody({ endDateIso: 'not-a-date' }, { partial: true });
    expect(error).toMatch(/valid ISO 8601/);
  });

  it('rejects end before start when both are present', () => {
    const { error } = parseEventBody(
      { dateIso: '2026-06-20T16:00:00', endDateIso: '2026-06-19T16:00:00' },
      { partial: true },
    );
    expect(error).toMatch(/on or after/);
  });

  it('accepts end == start and end > start', () => {
    expect(
      parseEventBody({ dateIso: '2026-06-20T16:00:00', endDateIso: '2026-06-20T16:00:00' }, { partial: true }).error,
    ).toBeUndefined();
    expect(
      parseEventBody({ dateIso: '2026-06-20T16:00:00', endDateIso: '2026-06-21T07:00:00' }, { partial: true }).error,
    ).toBeUndefined();
  });

  it('persists the span on a full (create) payload', () => {
    const { patch, error } = parseEventBody(
      {
        title: 'Two-Day Op',
        dateIso: '2026-06-20T16:00:00',
        endDateIso: '2026-06-21T22:00:00',
        basePriceCents: 4000,
        totalSlots: 150,
      },
      { partial: false },
    );
    expect(error).toBeUndefined();
    expect(patch.date_iso).toBe('2026-06-20T16:00:00');
    expect(patch.end_date_iso).toBe('2026-06-21T22:00:00');
  });
});

describe('formatEvent — multi-day end date', () => {
  it('surfaces endDateIso (null when the column is absent → single-day)', () => {
    expect(formatEvent({ id: 'e', title: 'T', base_price_cents: 4000 }).endDateIso).toBe(null);
  });

  it('surfaces the stored span end', () => {
    const out = formatEvent({ id: 'e', title: 'T', base_price_cents: 4000, end_date_iso: '2026-06-21T22:00:00' });
    expect(out.endDateIso).toBe('2026-06-21T22:00:00');
  });
});
