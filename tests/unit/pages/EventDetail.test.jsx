// @vitest-environment jsdom

// Multi-day events — Phase 5. Locks the public EventDetail rendering for a
// multi-day event: the operator's free-text date RANGE shows as the date
// label, and the Operation Timeline groups rows under "Day N" headings when
// schedule rows carry a `day`. A single-day event (no end_date_iso, flat
// schedule) renders the spelled-out single date + a flat timeline (unchanged).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithRouter, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import { clearEventsCache } from '../../../src/hooks/useEvents.js';
import EventDetail from '../../../src/pages/EventDetail.jsx';

// Raw API event shape (what /api/events/:slug returns under `event`), which
// fetchEventBySlug runs through adaptEvent.
const MULTIDAY = {
  id: 'ghost-town-2day', slug: 'ghost-town-2day', title: 'Ghost Town: King Coal',
  dateIso: '2026-06-20T16:00:00', endDateIso: '2026-06-21T22:00:00',
  displayDate: '20-21 June 2026', displayDay: '20', displayMonth: 'June 2026',
  location: 'Hiawatha, UT', type: 'milsim',
  basePriceCents: 4000, basePriceDisplay: '$40/head', totalSlots: 150,
  checkIn: '08:00 AM', firstGame: '10:00 AM', endTime: '06:00 PM', timeRange: '8am-6pm',
  details: {
    schedule: [
      { day: 1, time: '08:00', label: 'Check-in + chrono' },
      { day: 1, time: '10:00', label: 'Skills lanes' },
      { day: 2, time: '06:00', label: 'Dawn final push' },
    ],
  },
};

beforeEach(() => {
  clearEventsCache();
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});

function renderDetail(ev) {
  installClientFetch([
    { match: `/api/events/${ev.slug}`, body: { event: ev } },
    { match: '/api/events', body: { events: [] } }, // useEvents related-events list
  ]);
  renderWithRouter(
    <Routes><Route path="/events/:slug" element={<EventDetail />} /></Routes>,
    { route: `/events/${ev.slug}` },
  );
}

describe('EventDetail — multi-day rendering', () => {
  it('shows the operator date range + per-day schedule headings', async () => {
    renderDetail(MULTIDAY);
    // The free-text range is the date label (hero + info card → 2 occurrences).
    await waitFor(() => expect(screen.getAllByText('20-21 June 2026').length).toBeGreaterThan(0));
    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByText('Day 2')).toBeInTheDocument();
    expect(screen.getByText('Skills lanes')).toBeInTheDocument();
    expect(screen.getByText('Dawn final push')).toBeInTheDocument();
  });

  it('single-day event shows the spelled-out date + a flat timeline (no Day headings)', async () => {
    const single = {
      ...MULTIDAY, slug: 'single-day', endDateIso: null, displayDate: '',
      details: { schedule: [{ time: '10:00', label: 'Game on' }] },
    };
    renderDetail(single);
    await waitFor(() => expect(screen.getByText('Game on')).toBeInTheDocument());
    expect(screen.queryByText('Day 1')).not.toBeInTheDocument();
    // dateFull (spelled-out) drives single-day, not the range.
    expect(screen.getAllByText(/June 20, 2026/).length).toBeGreaterThan(0);
  });
});
