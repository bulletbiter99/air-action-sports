// @vitest-environment jsdom

// M8 item-1 backfill (batch A3) — RTL tests for AdminRoster. Consumes useAdmin()
// + useSearchParams (?event= deep-link) + FilterBar (fires /api/admin/saved-views)
// and renders attendees through VirtualizedList. jsdom reports zero-size boxes and
// never fires ResizeObserver, so a file-level stub gives elements a 600px box and
// an observe() that reports it — otherwise the virtualizer yields no rows (see
// VirtualizedList.test.jsx). On mount it loads events, auto-selects one, then
// loads that event's roster. Dates/times are not asserted (locale-dependent).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminRoster from '../../../src/admin/AdminRoster.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

const EVT = { id: 'evt_1', title: 'Operation Nightfall', displayDate: 'Jun 20', dateIso: '2026-06-20', past: false, attendeesCount: 2 };

const ROSTER = {
    event: { id: 'evt_1', title: 'Operation Nightfall', customQuestions: [] },
    attendees: [
        { id: 'at_1', firstName: 'Sarah', lastName: 'Chen', email: 'sarah@example.com', phone: '555-1212', ticketType: 'GA', waiverSigned: true, checkedInAt: null, buyerName: 'Sarah Chen', bookingId: 'bk_1', bookingStatus: 'paid', isMinor: false, customAnswers: {} },
        { id: 'at_2', firstName: 'Pat', lastName: 'Doe', email: 'pat@example.com', phone: '', ticketType: 'GA', waiverSigned: false, checkedInAt: null, buyerName: 'Sarah Chen', bookingId: 'bk_1', bookingStatus: 'paid', isMinor: false, customAnswers: {} },
    ],
};

// VirtualizedList needs sized elements + a firing ResizeObserver to render rows.
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

describe('AdminRoster', () => {
    it('prompts to pick an event when there are none to auto-select', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/events', body: { events: [] } }]);
        renderWithAdmin(<AdminRoster />);
        await waitFor(() => expect(screen.getByText('Pick an event to load its roster')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: '▼ Export CSV' })).toBeDisabled();
    });

    it('auto-selects an event, loads its roster, and renders attendee rows + stats', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/roster', body: ROSTER },
            { match: '/api/admin/events', body: { events: [EVT] } },
        ]);
        renderWithAdmin(<AdminRoster />);
        await waitFor(() => expect(screen.getByText('Pat Doe')).toBeInTheDocument());
        // stats grid
        expect(screen.getByText('Players')).toBeInTheDocument();
        expect(screen.getByText('Checked in')).toBeInTheDocument();
        // virtualized table is exposed as a labelled role=table
        expect(screen.getByRole('table', { name: 'Event roster table' })).toBeInTheDocument();
    });

    it('honors the ?event= deep-link over the auto-select default', async () => {
        const events = [
            { id: 'evt_1', title: 'Foxtrot', displayDate: 'Jun 14', dateIso: '2026-06-14', past: false, attendeesCount: 1 },
            { id: 'evt_2', title: 'Volga Flank', displayDate: 'Jun 25', dateIso: '2026-06-25', past: false, attendeesCount: 0 },
        ];
        const fetchMock = installClientFetch([
            SAVED_VIEWS,
            { match: '/roster', body: { ...ROSTER, attendees: [] } },
            { match: '/api/admin/events', body: { events } },
        ]);
        renderWithAdmin(<AdminRoster />, { route: '/admin/roster?event=evt_2' });
        // deep-link forces evt_2 even though evt_1 (earlier) would be the auto-pick
        await waitFor(() => {
            const hit = fetchMock.mock.calls.some((args) => String(args[0]).includes('/events/evt_2/roster'));
            expect(hit).toBe(true);
        });
    });

    it('shows the no-players empty state for an event with an empty roster', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/roster', body: { ...ROSTER, attendees: [] } },
            { match: '/api/admin/events', body: { events: [EVT] } },
        ]);
        renderWithAdmin(<AdminRoster />);
        await waitFor(() => expect(screen.getByText('No players signed up yet')).toBeInTheDocument());
    });

    it('checks a player in via the row action', async () => {
        const fetchMock = installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/attendees', body: { ok: true } },
            { match: '/roster', body: ROSTER },
            { match: '/api/admin/events', body: { events: [EVT] } },
        ]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminRoster />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Check In' }).length).toBeGreaterThan(0));
        await user.click(screen.getAllByRole('button', { name: 'Check In' })[0]);
        await waitFor(() => {
            const posted = fetchMock.mock.calls.some(
                (args) => String(args[0]).includes('/check-in') && args[1]?.method === 'POST',
            );
            expect(posted).toBe(true);
        });
    });
});
