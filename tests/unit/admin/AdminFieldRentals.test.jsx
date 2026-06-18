// @vitest-environment jsdom

// RTL tests for AdminFieldRentals (the list). It does NOT use useAdmin — filter
// state is driven by useSearchParams, so it renders via renderWithRouter. On
// mount it fetches the rentals list + the sites dropdown; the shared FilterBar
// (batch 5b migration) also fetches /api/admin/saved-views. fieldRentalsClient.test.js
// covers the pure helpers; this covers the render + the filter/pagination wiring.
//
// Filter assertions are URL-driven (the page reads filters from searchParams and
// FilterBar reflects them as removable chips) — robust against the chip/picker UI
// and free of the status-pill text collision the old <select> test had to dodge.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithRouter, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminFieldRentals from '../../../src/admin/AdminFieldRentals.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };
const SITES = { match: '/api/admin/sites', body: { sites: [{ id: 'site_1', name: 'Ghost Town' }] } };
const RENTAL = { id: 'fr_1', status: 'sent', coiStatus: 'pending', coiExpiresAt: null, scheduledStartsAt: 1_767_225_600_000, scheduledEndsAt: 1_767_232_800_000, totalCents: 50000, requirements: { coiReceived: true }, engagementType: 'private_event', archivedAt: null };
const FR_OK = { match: '/api/admin/field-rentals', body: { rentals: [RENTAL], total: 1, limit: 50, offset: 0 } };

afterEach(() => vi.restoreAllMocks());

describe('AdminFieldRentals', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        expect(screen.getByText('Loading field rentals…')).toBeInTheDocument();
    });

    it('renders the rentals table after load', async () => {
        installClientFetch([SAVED_VIEWS, SITES, FR_OK]);
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        expect(screen.getByRole('heading', { name: 'Field Rentals' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('fr_1')).toBeInTheDocument());
        expect(screen.getByText('$500.00')).toBeInTheDocument();
    });

    it('renders the empty state when no rentals match', async () => {
        installClientFetch([SAVED_VIEWS, SITES, { match: '/api/admin/field-rentals', body: { rentals: [], total: 0, limit: 50, offset: 0 } }]);
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        await waitFor(() => expect(screen.getByText('No field rentals yet')).toBeInTheDocument());
    });

    it('surfaces a fetch error', async () => {
        installClientFetch([SAVED_VIEWS, SITES, { match: '/api/admin/field-rentals', status: 500, body: { error: 'boom' } }]);
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
    });

    it('reflects a URL status filter as an active FilterBar chip + scopes the fetch', async () => {
        const fetchMock = installClientFetch([SAVED_VIEWS, SITES, FR_OK]);
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals?status=sent' });
        await waitFor(() => expect(screen.getByText('fr_1')).toBeInTheDocument());
        // FilterBar renders the active Status chip (its remove button is unambiguous)
        expect(screen.getByRole('button', { name: 'Remove Status filter' })).toBeInTheDocument();
        // and the list fetch was scoped to status=sent
        expect(fetchMock.mock.calls.some((args) => String(args[0]).includes('status=sent'))).toBe(true);
    });

    it('removing the Status chip refetches without the filter', async () => {
        const fetchMock = installClientFetch([SAVED_VIEWS, SITES, FR_OK]);
        const user = userEvent.setup();
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals?status=sent' });
        await waitFor(() => expect(screen.getByText('fr_1')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Remove Status filter' }));
        await waitFor(() => {
            const frCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/admin/field-rentals'));
            expect(frCalls.at(-1).includes('status=sent')).toBe(false);
        });
    });

    it('paginates to the next page', async () => {
        const fetchMock = installClientFetch([SAVED_VIEWS, SITES, { match: '/api/admin/field-rentals', body: { rentals: [RENTAL], total: 120, limit: 50, offset: 0 } }]);
        const user = userEvent.setup();
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Next →' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Next →' }));
        await waitFor(() => {
            const hit = fetchMock.mock.calls.some((args) => String(args[0]).includes('offset=50'));
            expect(hit).toBe(true);
        });
    });
});
