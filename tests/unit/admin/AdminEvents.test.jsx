// @vitest-environment jsdom

// M8 item-1 backfill (batch A3) — RTL tests for AdminEvents. Consumes useAdmin()
// (manager/owner gating) + FilterBar (fires /api/admin/saved-views) and renders
// rows through VirtualizedList, so a file-level getBoundingClientRect +
// ResizeObserver stub gives the virtualizer a real viewport (jsdom otherwise
// renders zero rows — see VirtualizedList.test.jsx). The EventEditor modal opens
// from + New Event (isNew, no fetch) or Edit (GET /:id/detail). Row-action clicks
// use fireEvent (A1 lesson — userEvent dismisses the fixed-overlay editor).
// window.prompt/confirm are stubbed. Status pills aren't asserted (they collide
// with the FilterBar status options); titles are unique anchors.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, fireEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminEvents from '../../../src/admin/AdminEvents.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

const EVENTS = [
    { id: 'evt_1', title: 'Operation Nightfall', displayDate: 'Jun 20', dateIso: '2026-06-20', location: 'Ghost Town', ticketTypes: [{ id: 'tt_1' }], attendeesCount: 12, grossCents: 96000, published: true, past: false },
    { id: 'evt_2', title: 'Volga Flank', displayDate: 'Jul 04', dateIso: '2026-07-04', location: 'Foxtrot', ticketTypes: [], attendeesCount: 0, grossCents: 0, published: false, past: false },
];

const EVT_DETAIL = { event: { id: 'evt_1', title: 'Operation Nightfall', slug: 'operation-nightfall', published: true }, ticketTypes: [] };

let rectSpy;
let prevResizeObserver;
beforeEach(() => {
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
        width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0, toJSON() {},
    }));
    prevResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        constructor(cb) { this._cb = cb; }
        observe(el) {
            this._cb([{ target: el, contentRect: { width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0 }, borderBoxSize: [{ inlineSize: 600, blockSize: 600 }], contentBoxSize: [{ inlineSize: 600, blockSize: 600 }] }], this);
        }
        unobserve() {}
        disconnect() {}
    };
});
afterEach(() => {
    rectSpy.mockRestore();
    globalThis.ResizeObserver = prevResizeObserver;
    vi.restoreAllMocks();
});

function mockList(extra = []) {
    return installClientFetch([SAVED_VIEWS, ...extra, { match: '/api/admin/events', body: { events: EVENTS } }]);
}

describe('AdminEvents', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminEvents />);
        expect(screen.getByText('Loading events…')).toBeInTheDocument();
    });

    it('renders the events table with row data', async () => {
        mockList();
        renderWithAdmin(<AdminEvents />);
        expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Operation Nightfall')).toBeInTheDocument());
        expect(screen.getByText('Volga Flank')).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'Events table' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ New Event' })).toBeInTheDocument();
    });

    it('renders the empty state when there are no events', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/events', body: { events: [] } }]);
        renderWithAdmin(<AdminEvents />);
        await waitFor(() => expect(screen.getByText('No events yet')).toBeInTheDocument());
    });

    it('gates create/duplicate/delete by role (Edit always available)', async () => {
        mockList();
        const { unmount } = renderWithAdmin(<AdminEvents />, { admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByText('Operation Nightfall')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: '+ New Event' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
        unmount();

        mockList();
        renderWithAdmin(<AdminEvents />);
        await waitFor(() => expect(screen.getByText('Operation Nightfall')).toBeInTheDocument());
        expect(screen.getAllByRole('button', { name: 'Duplicate' }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0);
    });

    it('opens the New event editor from + New Event', async () => {
        mockList();
        renderWithAdmin(<AdminEvents />);
        await waitFor(() => expect(screen.getByRole('button', { name: '+ New Event' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: '+ New Event' }));
        expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
    });

    it('exposes the multi-day end-date input + helper in the editor', async () => {
        mockList();
        renderWithAdmin(<AdminEvents />);
        await waitFor(() => expect(screen.getByRole('button', { name: '+ New Event' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: '+ New Event' }));
        expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
        expect(screen.getByText(/End date & time/)).toBeInTheDocument();
        expect(screen.getByText(/Leave blank for a single-day event/)).toBeInTheDocument();
    });

    it('opens the editor for an existing event via the detail endpoint', async () => {
        mockList([{ match: '/detail', body: EVT_DETAIL }]);
        renderWithAdmin(<AdminEvents />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
        expect(await screen.findByRole('heading', { name: 'Edit: Operation Nightfall' })).toBeInTheDocument();
    });

    it('duplicates an event after the title prompt', async () => {
        vi.spyOn(window, 'prompt').mockReturnValue('Operation Nightfall (copy)');
        const fetchMock = mockList([
            { match: '/duplicate', body: { event: { id: 'evt_dup' } } },
            { match: '/detail', body: { ...EVT_DETAIL, event: { ...EVT_DETAIL.event, id: 'evt_dup' } } },
        ]);
        renderWithAdmin(<AdminEvents />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Duplicate' }).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate' })[0]);
        await waitFor(() => {
            const posted = fetchMock.mock.calls.some(
                (args) => String(args[0]).includes('/duplicate') && args[1]?.method === 'POST',
            );
            expect(posted).toBe(true);
        });
        // a successful duplicate opens the editor on the new event — await it so
        // the cascading /detail fetch resolves inside this test (no trailing fetch)
        expect(await screen.findByRole('heading', { name: 'Edit: Operation Nightfall' })).toBeInTheDocument();
    });

    it('deletes an event after confirmation (owner)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = mockList();
        renderWithAdmin(<AdminEvents />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
        await waitFor(() => {
            const deleted = fetchMock.mock.calls.some(
                (args) => String(args[0]).includes('/api/admin/events/evt_1') && args[1]?.method === 'DELETE',
            );
            expect(deleted).toBe(true);
        });
    });
});
