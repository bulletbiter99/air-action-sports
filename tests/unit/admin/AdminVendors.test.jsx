// @vitest-environment jsdom

// M8 item-1 backfill — RTL component tests for AdminVendors (vendor directory
// list + expandable contacts drawer + create/edit modal). Consumes useAdmin()
// (manager/owner gating) + FilterBar (which fires a /api/admin/saved-views GET
// via useSavedViews) + router links, so it renders via renderWithAdmin. The
// list fetch runs on mount; the contacts drawer lazy-fetches on first expand.
// Mock order matters: the /:id detail match is listed BEFORE the list match so
// first-hit-wins routes the expand fetch correctly. Dates/COI math use real
// time but only via always-past/always-future fixtures, so no flake.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminVendors from '../../../src/admin/AdminVendors.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

const VENDORS = [
    { id: 'ven_1', companyName: 'Acme Catering', tags: 'food', coiExpiresOn: '2020-01-01', contacts: [{}, {}], deletedAt: null },
    { id: 'ven_2', companyName: 'Bravo Medics', tags: 'medic', coiExpiresOn: null, contacts: [], deletedAt: null },
];

afterEach(() => vi.restoreAllMocks());

describe('AdminVendors', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminVendors />);
        expect(screen.getByText('Loading vendors…')).toBeInTheDocument();
    });

    it('renders the vendor table after load, with the expired-COI chip', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/vendors', body: { vendors: VENDORS } }]);
        renderWithAdmin(<AdminVendors />);
        expect(screen.getByRole('heading', { name: 'Vendors' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: /Acme Catering/ })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Bravo Medics/ })).toBeInTheDocument();
        // a 2020 COI date is always in the past -> EXPIRED chip
        expect(screen.getByText(/EXPIRED/)).toBeInTheDocument();
    });

    it('renders the empty state when there are no vendors', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/vendors', body: { vendors: [] } }]);
        renderWithAdmin(<AdminVendors />);
        await waitFor(() => expect(screen.getByText('No vendors yet')).toBeInTheDocument());
    });

    it('shows Edit but hides Delete for a manager who is not an owner', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/vendors', body: { vendors: VENDORS } }]);
        renderWithAdmin(<AdminVendors />, { admin: { hasRole: (r) => r !== 'owner' } });
        await waitFor(() => expect(screen.getByRole('button', { name: /Acme Catering/ })).toBeInTheDocument());
        expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('hides + New Vendor for users below manager', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/vendors', body: { vendors: VENDORS } }]);
        renderWithAdmin(<AdminVendors />, { admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByRole('button', { name: /Acme Catering/ })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: '+ New Vendor' })).not.toBeInTheDocument();
    });

    it('lazy-loads contacts when a vendor row is expanded', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/vendors/ven_1', body: { vendor: { contacts: [{ id: 'vc_1', name: 'Dana Reyes', email: 'dana@acme.test', isPrimary: true }] } } },
            { match: '/api/admin/vendors', body: { vendors: VENDORS } },
        ]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminVendors />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Acme Catering/ })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: /Acme Catering/ }));
        expect(await screen.findByText('Dana Reyes')).toBeInTheDocument();
        expect(screen.getByText('PRIMARY')).toBeInTheDocument();
    });

    it('opens the create-vendor modal from + New Vendor', async () => {
        installClientFetch([SAVED_VIEWS, { match: '/api/admin/vendors', body: { vendors: VENDORS } }]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminVendors />);
        await waitFor(() => expect(screen.getByRole('button', { name: '+ New Vendor' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: '+ New Vendor' }));
        expect(await screen.findByRole('heading', { name: 'New Vendor' })).toBeInTheDocument();
    });

    it('issues a DELETE after owner confirmation', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = installClientFetch([SAVED_VIEWS, { match: '/api/admin/vendors', body: { vendors: VENDORS } }]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminVendors />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0));
        await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
        await waitFor(() => {
            const deleted = fetchMock.mock.calls.some(
                (args) => String(args[0]).includes('/api/admin/vendors/ven_1') && args[1]?.method === 'DELETE',
            );
            expect(deleted).toBe(true);
        });
    });
});
