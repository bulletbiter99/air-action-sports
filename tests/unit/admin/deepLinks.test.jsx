// @vitest-environment jsdom
//
// Admin deep-links arriving APPLIED.
//
// The owner dashboard links straight into filtered views —
// /admin/bookings?waiver_status=missing&status=paid, /admin/feedback?status=new
// — and AdminStaffDetail links an incident's event title to
// /admin/events?id=<eventId>. All three target pages held their filters in
// useState seeded from a literal, so every one of those links opened the page
// UNFILTERED. The operator clicked "3 bookings missing waivers" and got all
// bookings, with no indication anything had been dropped.
//
// TWO DIFFERENT MECHANISMS, deliberately:
//   * AdminBookings / AdminFeedback use useFilterState, which reads
//     window.location.search (it also writes back via history.replaceState).
//     MemoryRouter does NOT touch window.location, so these tests set the real
//     URL with history.replaceState before rendering.
//   * AdminEvents uses useSearchParams, which IS router state, so its test
//     passes `route` instead.
// Getting that backwards yields a test that passes for the wrong reason.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminBookings from '../../../src/admin/AdminBookings.jsx';
import AdminFeedback from '../../../src/admin/AdminFeedback.jsx';
import AdminEvents from '../../../src/admin/AdminEvents.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

/** Set the real browser URL — what useFilterState actually reads. */
function setUrl(url) {
    window.history.replaceState({}, '', url);
}

/** Every /api/admin/<name> request URL the component issued. */
function requestsTo(name) {
    return globalThis.fetch.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes(`/api/admin/${name}?`) || u.endsWith(`/api/admin/${name}`));
}

beforeEach(() => setUrl('/'));
afterEach(() => { vi.restoreAllMocks(); setUrl('/'); });

describe('AdminBookings deep-links', () => {
    it('applies ?waiver_status=missing&status=paid from the dashboard action queue', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/bookings', body: { bookings: [], total: 0 } }]);
        setUrl('/admin/bookings?waiver_status=missing&status=paid');

        renderWithAdmin(<AdminBookings />, { route: '/admin/bookings?waiver_status=missing&status=paid' });

        await waitFor(() => expect(requestsTo('bookings').length).toBeGreaterThan(0));
        const url = requestsTo('bookings').at(-1);
        expect(url).toContain('waiver_status=missing');
        expect(url).toContain('status=paid');
    });

    it('applies ?status=refunded — the key the refund widget now links to', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/bookings', body: { bookings: [], total: 0 } }]);
        setUrl('/admin/bookings?status=refunded');

        renderWithAdmin(<AdminBookings />, { route: '/admin/bookings?status=refunded' });

        await waitFor(() => expect(requestsTo('bookings').length).toBeGreaterThan(0));
        expect(requestsTo('bookings').at(-1)).toContain('status=refunded');
    });

    it('ignores a query key that is not in the schema rather than forwarding it', async () => {
        // has_refund is a real API filter but is absent from FILTER_SCHEMA, so
        // the UI cannot represent it — forwarding it would produce a list the
        // visible filter chips do not explain.
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/bookings', body: { bookings: [], total: 0 } }]);
        setUrl('/admin/bookings?has_refund=true');

        renderWithAdmin(<AdminBookings />, { route: '/admin/bookings?has_refund=true' });

        await waitFor(() => expect(requestsTo('bookings').length).toBeGreaterThan(0));
        expect(requestsTo('bookings').at(-1)).not.toContain('has_refund');
    });

    it('still loads unfiltered with no query string', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/bookings', body: { bookings: [], total: 0 } }]);
        setUrl('/admin/bookings');

        renderWithAdmin(<AdminBookings />, { route: '/admin/bookings' });

        await waitFor(() => expect(requestsTo('bookings').length).toBeGreaterThan(0));
        const url = requestsTo('bookings').at(-1);
        expect(url).not.toContain('status=');
        expect(url).not.toContain('waiver_status=');
    });
});

describe('AdminFeedback deep-links', () => {
    it('applies ?status=new from the dashboard feedback widget', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/feedback', body: { items: [], summary: {} } }]);
        setUrl('/admin/feedback?status=new');

        renderWithAdmin(<AdminFeedback />, { route: '/admin/feedback?status=new' });

        await waitFor(() => expect(requestsTo('feedback').length).toBeGreaterThan(0));
        expect(requestsTo('feedback').at(-1)).toContain('status=new');
    });

    it('still loads unfiltered with no query string', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/feedback', body: { items: [], summary: {} } }]);
        setUrl('/admin/feedback');

        renderWithAdmin(<AdminFeedback />, { route: '/admin/feedback' });

        await waitFor(() => expect(requestsTo('feedback').length).toBeGreaterThan(0));
        expect(requestsTo('feedback').at(-1)).not.toContain('status=');
    });
});

describe('AdminEvents deep-link', () => {
    const EVENTS = [{ id: 'evt_ghost', title: 'Operation Last Light', slug: 'oll', dateIso: '2026-07-25T09:00:00', published: 1, past: 0 }];

    it('opens the editor for ?id=<eventId> — there is no other event detail view', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/events/evt_ghost/detail', body: { event: EVENTS[0] } },
            { match: '/api/admin/events', body: { events: EVENTS } },
        ]);

        // useSearchParams is ROUTER state, so `route` is the right lever here.
        renderWithAdmin(<AdminEvents />, { route: '/admin/events?id=evt_ghost' });

        await waitFor(() => {
            const detail = globalThis.fetch.mock.calls.map((c) => String(c[0]))
                .some((u) => u.includes('/api/admin/events/evt_ghost'));
            expect(detail).toBe(true);
        });
    });

    it('does not open an editor with no ?id', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/events', body: { events: EVENTS } }]);

        renderWithAdmin(<AdminEvents />, { route: '/admin/events' });

        // Wait on the LIST fetch, not a rendered row: AdminEvents renders through
        // VirtualizedList, which yields zero rows in jsdom without the sized
        // getBoundingClientRect + ResizeObserver stub.
        await waitFor(() => expect(requestsTo('events').length).toBeGreaterThan(0));
        const detail = globalThis.fetch.mock.calls.map((c) => String(c[0]))
            .some((u) => u.includes('/api/admin/events/evt_ghost'));
        expect(detail).toBe(false);
    });
});
