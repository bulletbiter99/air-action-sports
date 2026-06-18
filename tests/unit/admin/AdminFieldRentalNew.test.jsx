// @vitest-environment jsdom

// M8 item-1 backfill (batch A4) — RTL tests for AdminFieldRentalNew (3-step
// wizard). It does NOT use useAdmin — caps come from /api/admin/auth/me, and it
// renders via renderWithRouter (useNavigate only). On mount it fetches /sites +
// /me. Step 1 has a 250ms-debounced customer typeahead hitting /api/admin/
// customers; with real timers a findBy waits out the debounce. The step
// validators are covered by fieldRentalsClient.test.js — this covers the render
// + the typeahead/select wiring.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithRouter, screen, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminFieldRentalNew from '../../../src/admin/AdminFieldRentalNew.jsx';

const BASE = [
    { match: '/api/admin/sites', body: { sites: [{ id: 'site_1', name: 'Ghost Town' }] } },
    { match: '/api/admin/auth/me', body: { capabilities: [] } },
];
const CUSTOMERS = { match: '/api/admin/customers', body: { customers: [{ id: 'cus_1', name: 'Acme Corp', email: 'ops@acme.test' }] } };
const SEARCH_PLACEHOLDER = 'Search customer name or email…';

afterEach(() => vi.restoreAllMocks());

describe('AdminFieldRentalNew', () => {
    it('renders step 1 (customer) of the wizard', () => {
        installClientFetch([...BASE]);
        renderWithRouter(<AdminFieldRentalNew />, { route: '/admin/field-rentals/new' });
        expect(screen.getByRole('heading', { name: 'New field rental' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Step 1: Customer' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    });

    it('runs the debounced customer typeahead and shows results', async () => {
        installClientFetch([...BASE, CUSTOMERS]);
        const user = userEvent.setup();
        renderWithRouter(<AdminFieldRentalNew />, { route: '/admin/field-rentals/new' });
        await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'Ac');
        // the 250ms debounce + fetch resolve within findBy's timeout
        expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    });

    it('selecting a customer shows the selected box, and Change resets it', async () => {
        installClientFetch([...BASE, CUSTOMERS]);
        const user = userEvent.setup();
        renderWithRouter(<AdminFieldRentalNew />, { route: '/admin/field-rentals/new' });
        await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'Ac');
        await user.click(await screen.findByText('Acme Corp'));
        // the chosen-customer summary box exposes a Change button
        expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Change' }));
        expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    });
});
