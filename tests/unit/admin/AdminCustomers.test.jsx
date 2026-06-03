// @vitest-environment jsdom

// M8 item-1 backfill — RTL component tests for AdminCustomers (M3 B8b list
// page). Uses <Link> (router) + FilterBar (which fires a /api/admin/saved-views
// GET via useSavedViews — mocked here; apiList swallows errors anyway). The
// page debounces its initial fetch 250ms, so assertions waitFor the rows.

import { describe, it, expect } from 'vitest';
import { renderWithRouter, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminCustomers from '../../../src/admin/AdminCustomers.jsx';

const CUSTOMERS = [
    {
        id: 'cus_1', name: 'Sarah Chen', email: 'sarah@example.com', totalBookings: 8,
        totalAttendees: 14, lifetimeValueCents: 124000, refundCount: 0,
        lastBookingAt: 1_767_225_600_000, archivedAt: null, archivedReason: null,
    },
    {
        id: 'cus_2', name: 'Mike Torres', email: 'mike@example.com', totalBookings: 1,
        totalAttendees: 1, lifetimeValueCents: 8500, refundCount: 1,
        lastBookingAt: 1_767_225_600_000, archivedAt: 1_767_225_600_000, archivedReason: 'merged',
    },
];

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

describe('AdminCustomers', () => {
    it('shows a loading row while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithRouter(<AdminCustomers />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the customers table with aggregates + status pills', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/customers', body: { total: 2, customers: CUSTOMERS } },
        ]);
        renderWithRouter(<AdminCustomers />);
        await waitFor(() => expect(screen.getByText('Sarah Chen')).toBeInTheDocument());
        expect(screen.getByText('mike@example.com')).toBeInTheDocument();
        // header count
        expect(screen.getByText('2 customers')).toBeInTheDocument();
        // active vs archived pills
        expect(screen.getByText('active')).toBeInTheDocument();
        expect(screen.getByText('merged')).toBeInTheDocument();
        // name links to the detail route
        expect(screen.getByRole('link', { name: 'Sarah Chen' })).toHaveAttribute('href', '/admin/customers/cus_1');
    });

    it('renders the empty state when no customers match', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/customers', body: { total: 0, customers: [] } },
        ]);
        renderWithRouter(<AdminCustomers />);
        await waitFor(() => expect(screen.getByText('No customers match.')).toBeInTheDocument());
    });

    it('surfaces a fetch error', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/customers', status: 500, body: { error: 'boom' } },
        ]);
        renderWithRouter(<AdminCustomers />);
        await waitFor(() => expect(screen.getByText(/^Error: HTTP 500/)).toBeInTheDocument());
    });

    it('paginates and re-fetches with the next offset', async () => {
        const fetchMock = installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/customers', body: { total: 120, customers: CUSTOMERS } },
        ]);
        const user = userEvent.setup();
        renderWithRouter(<AdminCustomers />);
        await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Next →' }));
        await waitFor(() => {
            const hitOffset = fetchMock.mock.calls.some((args) => String(args[0]).includes('offset=50'));
            expect(hitOffset).toBe(true);
        });
    });
});
