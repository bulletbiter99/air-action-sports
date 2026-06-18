// @vitest-environment jsdom

// M8 item-1 backfill (batch A4) — RTL tests for AdminFieldRentalDetail. It does
// NOT use useAdmin — caps come from /api/admin/auth/me; it reads :id via
// useParams, so it renders through a <Routes>/<Route>. loadAll() fires 4 parallel
// fetches (detail / documents / payments / me); a non-ok detail renders an error
// card. Lifecycle actions are capability-gated. The cap-gating + modal-open tests
// anchor on "Cancel rental" (gated only by field_rentals.cancel + non-terminal +
// not-archived — no allowedNextStatuses dependency). fireEvent opens the modal
// (A1 lesson — userEvent dismisses the fixed-overlay modal).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithRouter, screen, waitFor, fireEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminFieldRentalDetail from '../../../src/admin/AdminFieldRentalDetail.jsx';

const DETAIL = {
    rental: { id: 'fr_1', status: 'sent', coiStatus: 'pending', coiExpiresAt: null, statusChangedAt: 1_767_225_600_000, createdAt: 1_767_225_600_000, archivedAt: null, requirements: {} },
    contacts: [],
    site: { id: 'site_1', name: 'Ghost Town' },
    customer: { id: 'cus_1', name: 'Acme Corp', email: 'ops@acme.test' },
};

function mocks({ detail = DETAIL, detailStatus = 200, caps = ['field_rentals.cancel'] } = {}) {
    return installClientFetch([
        { match: '/field-rental-documents', body: { documents: [] } },
        { match: '/field-rental-payments', body: { payments: [] } },
        { match: '/api/admin/auth/me', body: { capabilities: caps } },
        { match: '/api/admin/field-rentals/fr_1', status: detailStatus, body: detailStatus === 200 ? detail : { error: 'Field rental not found' } },
    ]);
}

function renderDetail(opts = {}) {
    return renderWithRouter(
        <Routes>
            <Route path="/admin/field-rentals/:id" element={<AdminFieldRentalDetail />} />
        </Routes>,
        { route: '/admin/field-rentals/fr_1', ...opts },
    );
}

afterEach(() => vi.restoreAllMocks());

describe('AdminFieldRentalDetail', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderDetail();
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the rental detail after load', async () => {
        mocks();
        renderDetail();
        await waitFor(() => expect(screen.getByText('fr_1')).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Status & lifecycle' })).toBeInTheDocument();
    });

    it('shows an error card when the detail fetch fails', async () => {
        mocks({ detailStatus: 404 });
        renderDetail();
        await waitFor(() => expect(screen.getByText('Field rental not found')).toBeInTheDocument());
    });

    it('gates lifecycle actions by capability', async () => {
        mocks({ caps: [] });
        const { unmount } = renderDetail();
        await waitFor(() => expect(screen.getByText('fr_1')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Cancel rental' })).not.toBeInTheDocument();
        unmount();

        mocks({ caps: ['field_rentals.cancel'] });
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel rental' })).toBeInTheDocument());
    });

    it('opens the cancel-rental modal', async () => {
        mocks({ caps: ['field_rentals.cancel'] });
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel rental' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Cancel rental' }));
        expect(await screen.findByRole('heading', { name: 'Cancel rental' })).toBeInTheDocument();
    });
});
