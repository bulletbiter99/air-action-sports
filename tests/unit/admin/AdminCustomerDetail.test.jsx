// @vitest-environment jsdom

// M8 item-1 backfill — RTL component tests for AdminCustomerDetail (M3 B8b
// detail page + merge / GDPR / business-edit modals). Consumes useAdmin()
// (hasRole gates the GDPR button) + useParams(:id), so it renders inside
// renderWithAdmin with a real <Routes> match so useParams resolves.

import { describe, it, expect } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminCustomerDetail from '../../../src/admin/AdminCustomerDetail.jsx';

const BASE_CUSTOMER = {
    id: 'cus_1', name: 'Sarah Chen', email: 'sarah@example.com', emailNormalized: 'sarah@example.com',
    phone: '555-0100', clientType: 'individual', archivedAt: null, archivedReason: null, mergedInto: null,
    totalBookings: 8, totalAttendees: 14, lifetimeValueCents: 124000, refundCount: 0,
    firstBookingAt: 1_700_000_000_000, lastBookingAt: 1_767_225_600_000,
    emailTransactional: true, emailMarketing: false, smsTransactional: false, smsMarketing: false,
    notes: 'Prefers email contact',
    viewerCanSeeBusinessFields: true, viewerCanWriteBusinessFields: true,
    hasEncryptedTaxId: false, hasEncryptedBillingAddress: false,
};

const INDIVIDUAL = {
    customer: BASE_CUSTOMER,
    bookings: [
        { id: 'bk_1', eventTitle: 'Operation Nightfall', eventId: 'ev_1', status: 'paid', paymentMethod: 'card', totalCents: 12000, createdAt: 1_767_225_600_000 },
    ],
    tags: [{ tagType: 'system', tag: 'vip' }],
    fieldRentals: [],
};

const BUSINESS = {
    ...INDIVIDUAL,
    customer: {
        ...BASE_CUSTOMER,
        clientType: 'business',
        businessName: 'Acme Corp',
        businessWebsite: 'https://acme.example',
        hasEncryptedTaxId: true,
        businessTaxId: '12-3456789',
        hasEncryptedBillingAddress: false,
    },
};

function renderDetail({ route = '/admin/customers/cus_1', admin } = {}) {
    return renderWithAdmin(
        <Routes>
            <Route path="/admin/customers/:id" element={<AdminCustomerDetail />} />
        </Routes>,
        { route, admin },
    );
}

describe('AdminCustomerDetail', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderDetail();
        expect(screen.getByText('Loading customer…')).toBeInTheDocument();
    });

    it('renders a not-found state on 404', async () => {
        installClientFetch([{ match: '/api/admin/customers/cus_1', status: 404, body: { error: 'not found' } }]);
        renderDetail();
        await waitFor(() => expect(screen.getByText('Customer not found.')).toBeInTheDocument());
    });

    it('surfaces a fetch error', async () => {
        installClientFetch([{ match: '/api/admin/customers/cus_1', status: 500, body: { error: 'boom' } }]);
        renderDetail();
        await waitFor(() => expect(screen.getByText(/^Error: HTTP 500/)).toBeInTheDocument());
    });

    it('renders contact, aggregates, comm prefs, bookings + tags', async () => {
        installClientFetch([{ match: '/api/admin/customers/cus_1', body: INDIVIDUAL }]);
        renderDetail();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Sarah Chen' })).toBeInTheDocument());
        expect(screen.getByText('sarah@example.com')).toBeInTheDocument();
        expect(screen.getByText('555-0100')).toBeInTheDocument();
        expect(screen.getByText('Individual')).toBeInTheDocument();
        expect(screen.getByText('LTV')).toBeInTheDocument();
        expect(screen.getByText('Comm preferences')).toBeInTheDocument();
        // bookings section + a row
        expect(screen.getByRole('heading', { name: 'Bookings (1)' })).toBeInTheDocument();
        expect(screen.getByText('Operation Nightfall')).toBeInTheDocument();
        // a tag
        expect(screen.getByText('vip')).toBeInTheDocument();
    });

    it('renders the business profile section with a decrypted EIN for a business customer', async () => {
        installClientFetch([{ match: '/api/admin/customers/cus_1', body: BUSINESS }]);
        renderDetail();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Business profile' })).toBeInTheDocument());
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        expect(screen.getByText('12-3456789')).toBeInTheDocument();
    });

    it('shows the GDPR delete button to owners alongside merge', async () => {
        installClientFetch([{ match: '/api/admin/customers/cus_1', body: INDIVIDUAL }]);
        renderDetail({ admin: { hasRole: () => true } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Merge this customer into…' })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'GDPR / CCPA delete…' })).toBeInTheDocument();
    });

    it('hides the GDPR delete button from non-owners (merge stays)', async () => {
        installClientFetch([{ match: '/api/admin/customers/cus_1', body: INDIVIDUAL }]);
        renderDetail({ admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Merge this customer into…' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'GDPR / CCPA delete…' })).not.toBeInTheDocument();
    });

    it('opens the merge modal', async () => {
        installClientFetch([{ match: '/api/admin/customers/cus_1', body: INDIVIDUAL }]);
        const user = userEvent.setup();
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Merge this customer into…' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Merge this customer into…' }));
        expect(screen.getByRole('heading', { name: 'Merge customer into…' })).toBeInTheDocument();
    });
});
