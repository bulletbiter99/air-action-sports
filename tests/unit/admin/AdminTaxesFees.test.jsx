// @vitest-environment jsdom

// M8 item-1 backfill — RTL component tests for AdminTaxesFees (taxes/fees CRUD).
// Consumes useAdmin() (isAuthenticated/loading/hasRole + a manager-gate redirect)
// + useNavigate, so it renders via renderWithAdmin. Plain <table> (not
// virtualized), so rows render without a ResizeObserver stub.

import { describe, it, expect } from 'vitest';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminTaxesFees from '../../../src/admin/AdminTaxesFees.jsx';

const ROWS = [
    { id: 'tf_1', name: 'Utah Sales Tax', shortLabel: 'Tax', category: 'tax', percentDisplay: '7.25%', fixedDisplay: null, perUnit: 'booking', appliesTo: 'all', active: true },
    { id: 'tf_2', name: 'Booking Fee', category: 'fee', percentDisplay: null, fixedDisplay: '$2.00', perUnit: 'ticket', appliesTo: 'tickets', active: true },
];

describe('AdminTaxesFees', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminTaxesFees />);
        expect(screen.getByText('Loading taxes & fees…')).toBeInTheDocument();
    });

    it('renders the taxes + fees groups with rows', async () => {
        installClientFetch([{ match: '/api/admin/taxes-fees', body: { taxesFees: ROWS } }]);
        renderWithAdmin(<AdminTaxesFees />);
        await waitFor(() => expect(screen.getByText('Utah Sales Tax')).toBeInTheDocument());
        expect(screen.getByText('Booking Fee')).toBeInTheDocument();
        expect(screen.getByText('7.25%')).toBeInTheDocument();
        expect(screen.getByText('$2.00')).toBeInTheDocument();
        // group section headings
        expect(screen.getByRole('heading', { name: 'Taxes' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Fees' })).toBeInTheDocument();
    });

    it('renders empty-group states when nothing is configured', async () => {
        installClientFetch([{ match: '/api/admin/taxes-fees', body: { taxesFees: [] } }]);
        renderWithAdmin(<AdminTaxesFees />);
        await waitFor(() => expect(screen.getByText('No taxes configured')).toBeInTheDocument());
        expect(screen.getByText('No fees configured')).toBeInTheDocument();
    });

    it('opens the add modal', async () => {
        installClientFetch([{ match: '/api/admin/taxes-fees', body: { taxesFees: [] } }]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminTaxesFees />);
        await waitFor(() => expect(screen.getByRole('button', { name: '+ Add New' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: '+ Add New' }));
        expect(screen.getByRole('heading', { name: 'Add Tax or Fee' })).toBeInTheDocument();
    });

    it('shows Delete to owners and hides it from a manager', async () => {
        // owner (default hasRole → true)
        installClientFetch([{ match: '/api/admin/taxes-fees', body: { taxesFees: ROWS } }]);
        const { unmount } = renderWithAdmin(<AdminTaxesFees />);
        await waitFor(() => expect(screen.getByText('Utah Sales Tax')).toBeInTheDocument());
        expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0);
        unmount();

        // manager-but-not-owner: no manager-gate redirect, but Delete is hidden
        installClientFetch([{ match: '/api/admin/taxes-fees', body: { taxesFees: ROWS } }]);
        renderWithAdmin(<AdminTaxesFees />, { admin: { hasRole: (r) => r === 'manager' } });
        await waitFor(() => expect(screen.getByText('Utah Sales Tax')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
    });

    it('toggles a row active state via PUT', async () => {
        const fetchMock = installClientFetch([{ match: '/api/admin/taxes-fees', body: { taxesFees: ROWS } }]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminTaxesFees />);
        await waitFor(() => expect(screen.getByText('Utah Sales Tax')).toBeInTheDocument());
        await user.click(screen.getAllByRole('button', { name: 'ON' })[0]);
        await waitFor(() => {
            const toggled = fetchMock.mock.calls.some(
                (args) => args[1]?.method === 'PUT' && String(args[0]).includes('/api/admin/taxes-fees/tf_1'),
            );
            expect(toggled).toBe(true);
        });
    });
});
