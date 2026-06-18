// @vitest-environment jsdom

// M8 item-1 backfill (batch A2) — RTL tests for AdminBookings (the /admin/bookings
// list page). Consumes useAdmin() (manager-gated bulk/export/new) + FilterBar
// (fires /api/admin/saved-views) + router, so it renders via renderWithAdmin.
// The list fetch runs on mount; quick-filter chips + pagination re-fetch with
// new query params. Dates are not asserted (locale-dependent).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminBookings from '../../../src/admin/AdminBookings.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

const BOOKINGS = [
    { id: 'bk_1', createdAt: 1_767_225_600_000, fullName: 'Sarah Chen', email: 'sarah@example.com', playerCount: 2, totalCents: 8000, paymentMethod: 'card', status: 'paid' },
    { id: 'bk_2', createdAt: 1_767_225_600_000, fullName: 'Mike Torres', email: 'mike@example.com', playerCount: 1, totalCents: 4000, paymentMethod: 'cash', status: 'pending' },
];

function mockList(total = 2, bookings = BOOKINGS) {
    return installClientFetch([
        SAVED_VIEWS,
        { match: '/api/admin/bookings', body: { bookings, total } },
    ]);
}

afterEach(() => vi.restoreAllMocks());

describe('AdminBookings', () => {
    it('shows a loading row while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminBookings />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the bookings table, quick filters, and the manager CTA', async () => {
        mockList();
        renderWithAdmin(<AdminBookings />);
        expect(screen.getByRole('heading', { name: 'Bookings' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refund queue' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '+ New Booking' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Sarah Chen')).toBeInTheDocument());
        expect(screen.getByText('mike@example.com')).toBeInTheDocument();
        expect(screen.getByText('paid')).toBeInTheDocument();
    });

    it('renders the empty state when no bookings match', async () => {
        mockList(0, []);
        renderWithAdmin(<AdminBookings />);
        await waitFor(() => expect(screen.getByText('No bookings match the current filter.')).toBeInTheDocument());
    });

    it('hides bulk/export/new-booking affordances for non-managers', async () => {
        mockList();
        renderWithAdmin(<AdminBookings />, { admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByText('Sarah Chen')).toBeInTheDocument());
        expect(screen.queryByRole('link', { name: '+ New Booking' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Export CSV (current filter)' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Select all on page')).not.toBeInTheDocument();
    });

    it('re-fetches with status=pending when the Pending payment chip is clicked', async () => {
        const fetchMock = mockList();
        const user = userEvent.setup();
        renderWithAdmin(<AdminBookings />);
        await waitFor(() => expect(screen.getByText('Sarah Chen')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Pending payment' }));
        await waitFor(() => {
            const hit = fetchMock.mock.calls.some((args) => String(args[0]).includes('status=pending'));
            expect(hit).toBe(true);
        });
    });

    it('paginates and re-fetches with the next offset', async () => {
        const fetchMock = mockList(120);
        const user = userEvent.setup();
        renderWithAdmin(<AdminBookings />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Next →' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Next →' }));
        await waitFor(() => {
            const hit = fetchMock.mock.calls.some((args) => String(args[0]).includes('offset=50'));
            expect(hit).toBe(true);
        });
    });

    it('select-all reveals the bulk toolbar and posts a resend-confirmation', async () => {
        const fetchMock = installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/bookings/bulk/resend-confirmation', body: { sent: 2, skipped: 0, failed: 0 } },
            { match: '/api/admin/bookings', body: { bookings: BOOKINGS, total: 2 } },
        ]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminBookings />);
        await waitFor(() => expect(screen.getByText('Sarah Chen')).toBeInTheDocument());
        await user.click(screen.getByLabelText('Select all on page'));
        await user.click(screen.getByRole('button', { name: 'Resend confirmation' }));
        expect(await screen.findByText(/Sent 2, skipped 0, failed 0/)).toBeInTheDocument();
        const posted = fetchMock.mock.calls.some(
            (args) => String(args[0]).includes('/bulk/resend-confirmation') && args[1]?.method === 'POST',
        );
        expect(posted).toBe(true);
    });
});
