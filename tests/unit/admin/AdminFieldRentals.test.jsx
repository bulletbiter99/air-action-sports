// @vitest-environment jsdom

// M8 item-1 backfill (batch A4) — RTL tests for AdminFieldRentals (the list).
// It does NOT use useAdmin — filter state is driven by useSearchParams, so it
// renders via renderWithRouter. On mount it fetches the rentals list + the sites
// dropdown. fieldRentalsClient.test.js covers the pure helpers; this covers the
// render + the filter/pagination wiring. Status/COI pill text collides with the
// filter <select> options, so tests anchor on the unique rental id + total.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithRouter, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminFieldRentals from '../../../src/admin/AdminFieldRentals.jsx';

const SITES = { match: '/api/admin/sites', body: { sites: [{ id: 'site_1', name: 'Ghost Town' }] } };
const RENTAL = { id: 'fr_1', status: 'sent', coiStatus: 'pending', coiExpiresAt: null, scheduledStartsAt: 1_767_225_600_000, scheduledEndsAt: 1_767_232_800_000, totalCents: 50000, requirements: { coiReceived: true }, engagementType: 'private_event', archivedAt: null };

afterEach(() => vi.restoreAllMocks());

describe('AdminFieldRentals', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the rentals table after load', async () => {
        installClientFetch([SITES, { match: '/api/admin/field-rentals', body: { rentals: [RENTAL], total: 1, limit: 50, offset: 0 } }]);
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        expect(screen.getByRole('heading', { name: 'Field Rentals' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('fr_1')).toBeInTheDocument());
        expect(screen.getByText('$500.00')).toBeInTheDocument();
    });

    it('renders the empty state when no rentals match', async () => {
        installClientFetch([SITES, { match: '/api/admin/field-rentals', body: { rentals: [], total: 0, limit: 50, offset: 0 } }]);
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        await waitFor(() => expect(screen.getByText(/No field rentals match this view/)).toBeInTheDocument());
    });

    it('surfaces a fetch error', async () => {
        installClientFetch([SITES, { match: '/api/admin/field-rentals', status: 500, body: { error: 'boom' } }]);
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
    });

    it('re-fetches with a status filter from the Status select', async () => {
        const fetchMock = installClientFetch([SITES, { match: '/api/admin/field-rentals', body: { rentals: [RENTAL], total: 1, limit: 50, offset: 0 } }]);
        const user = userEvent.setup();
        renderWithRouter(<AdminFieldRentals />, { route: '/admin/field-rentals' });
        await waitFor(() => expect(screen.getByText('fr_1')).toBeInTheDocument());
        await user.selectOptions(screen.getByLabelText('Status'), 'sent');
        await waitFor(() => {
            const hit = fetchMock.mock.calls.some((args) => String(args[0]).includes('status=sent'));
            expect(hit).toBe(true);
        });
    });

    it('paginates to the next page', async () => {
        const fetchMock = installClientFetch([SITES, { match: '/api/admin/field-rentals', body: { rentals: [RENTAL], total: 120, limit: 50, offset: 0 } }]);
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
