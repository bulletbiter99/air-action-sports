// @vitest-environment jsdom
//
// The pill is the site's most insistent CTA — it follows the visitor down every
// page. Before this, it promised a booking regardless of whether anything was
// bookable, so with zero upcoming events (the live state in July 2026) every
// page pushed users toward "No events on the books."
//
// Both directions matter: suppressing it when there is nothing to sell, and
// NOT suppressing it when there is. A test that only pinned the first half
// would happily pass with the pill deleted.

import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import { clearEventsCache } from '../../../src/hooks/useEvents.js';
import FloatingBookPill from '../../../src/components/FloatingBookPill.jsx';

// The API shape (worker formatEvent), not the DB row shape — adaptEvent reads
// camelCase and silently produces an event with empty fields from snake_case,
// which is exactly the kind of fixture that makes a test pass for the wrong
// reason.
const upcoming = {
    id: 'ev_1', slug: 'operation-next', title: 'Operation Next',
    dateIso: '2026-09-12T09:00:00', past: false, totalSlots: 100, seatsSold: 0,
    displayDay: '12', displayMonth: 'September 2026', type: 'milsim',
};

// useEvents caches per key at MODULE level, so without this the first test's
// event list would satisfy every later test — including the ones asserting the
// pill is absent, which would then pass while proving nothing.
beforeEach(() => clearEventsCache());

function mockEvents(list) {
    // NOTE: the helper's key is `body`, not `response`. Getting this wrong
    // returns undefined, `data.events || []` yields [], and every
    // assert-absence test passes vacuously while every assert-presence test
    // fails — which is precisely what happened when this file was written.
    installClientFetch([
        { match: '/api/events', body: { events: list } },
    ]);
}

const findPill = () => screen.queryByRole('link', { name: /book now/i });

describe('FloatingBookPill', () => {
    it('renders when an upcoming event exists', async () => {
        mockEvents([upcoming]);
        renderWithRouter(<FloatingBookPill />, { route: '/about' });
        expect(await screen.findByRole('link', { name: /book now/i })).toBeInTheDocument();
    });

    it('renders NOTHING when there are no upcoming events', async () => {
        // The live July-2026 state: every event archived, /api/events empty.
        mockEvents([]);
        renderWithRouter(<FloatingBookPill />, { route: '/about' });
        // Give the fetch a turn to resolve before asserting absence, or this
        // would pass on the loading state and prove nothing.
        await new Promise((r) => setTimeout(r, 0));
        expect(findPill()).toBeNull();
    });

    it('stays hidden on /booking and /waiver even with events available', async () => {
        for (const route of ['/booking', '/waiver']) {
            mockEvents([upcoming]);
            const { unmount } = renderWithRouter(<FloatingBookPill />, { route });
            await new Promise((r) => setTimeout(r, 0));
            expect(findPill(), `pill should be hidden on ${route}`).toBeNull();
            unmount();
        }
    });

    it('carries the event slug into the booking link from an event page', async () => {
        mockEvents([upcoming]);
        renderWithRouter(<FloatingBookPill />, { route: '/events/operation-next' });
        const pill = await screen.findByRole('link', { name: /book now/i });
        expect(pill.getAttribute('href')).toContain('event=operation-next');
    });
});
