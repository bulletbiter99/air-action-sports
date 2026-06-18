// @vitest-environment jsdom

// M8 item-1 backfill (batch A2) — RTL tests for AdminBookingsDetail (the
// /admin/bookings/:id workspace). Consumes useParams() + useAdmin(), so it
// renders through a <Routes>/<Route> at a matching route. The detail fetch runs
// on mount; manager-gated actions + the reschedule modal lazy-load. The
// reschedule modal open uses fireEvent (A1 lesson: userEvent's pointer sequence
// dismisses the fixed-overlay modal). Dates are not asserted (locale-dependent).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithAdmin, screen, waitFor, userEvent, fireEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminBookingsDetail from '../../../src/admin/AdminBookingsDetail.jsx';

const DETAIL = {
    viewerCanSeePII: true,
    booking: {
        id: 'bk_1', status: 'paid', totalCents: 8000, subtotalCents: 8000, taxCents: 0, feeCents: 0,
        paymentMethod: 'card', fullName: 'Sarah Chen', email: 'sarah@example.com', phone: '555-1212',
        createdAt: 1_767_225_600_000, paidAt: 1_767_225_600_000, refundedAt: null,
        stripePaymentIntent: 'pi_123', eventId: 'evt_1',
        lineItems: [{ type: 'ticket', name: 'GA Ticket', qty: 2, line_total_cents: 8000, unitPriceCents: 4000 }],
    },
    event: { id: 'evt_1', title: 'Operation Nightfall', displayDate: 'Jun 20' },
    attendees: [
        { id: 'at_1', firstName: 'Sarah', lastName: 'Chen', email: 'sarah@example.com', phone: '555-1212', waiverSigned: true, checkedIn: false },
        { id: 'at_2', firstName: 'Pat', lastName: 'Doe', email: 'pat@example.com', phone: '', waiverSigned: false, checkedIn: false },
    ],
    customer: { id: 'cus_1', name: 'Sarah Chen', email: 'sarah@example.com', phone: '555-1212', lifetimeValueCents: 12400, totalBookings: 3, priorBookingCount: 2, refundCount: 0 },
    activityLog: [{ id: 1, createdAt: 1_767_225_600_000, action: 'booking.paid', userId: null, meta: null }],
};

function renderDetail(opts = {}) {
    return renderWithAdmin(
        <Routes>
            <Route path="/admin/bookings/:id" element={<AdminBookingsDetail />} />
        </Routes>,
        { route: '/admin/bookings/bk_1', ...opts },
    );
}

afterEach(() => vi.restoreAllMocks());

describe('AdminBookingsDetail', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderDetail();
        expect(screen.getByText('Loading booking…')).toBeInTheDocument();
    });

    it('renders the booking detail after load', async () => {
        installClientFetch([{ match: '/api/admin/bookings', body: DETAIL }]);
        renderDetail();
        await waitFor(() => expect(screen.getByText('bk_1')).toBeInTheDocument());
        // subtitle is "Operation Nightfall · Jun 20" — match by substring
        expect(screen.getByText(/Operation Nightfall/)).toBeInTheDocument();
        expect(screen.getByText('paid')).toBeInTheDocument();
        // customer card + line item are present
        expect(screen.getByRole('heading', { name: 'Customer' })).toBeInTheDocument();
        expect(screen.getByText('GA Ticket')).toBeInTheDocument();
    });

    it('renders a not-found error on 404', async () => {
        installClientFetch([{ match: '/api/admin/bookings', status: 404, body: {} }]);
        renderDetail();
        await waitFor(() => expect(screen.getByText('Booking not found')).toBeInTheDocument());
        expect(screen.getByText("Couldn't load booking")).toBeInTheDocument();
    });

    it('masks PII and shows the banner when viewerCanSeePII is false', async () => {
        installClientFetch([{ match: '/api/admin/bookings', body: { ...DETAIL, viewerCanSeePII: false } }]);
        renderDetail();
        await waitFor(() => expect(screen.getByText('bk_1')).toBeInTheDocument());
        expect(screen.getByText(/masked for your role/)).toBeInTheDocument();
        expect(screen.getAllByText('masked').length).toBeGreaterThan(0);
    });

    it('renders the attendees panel with waiver status', async () => {
        installClientFetch([{ match: '/api/admin/bookings', body: DETAIL }]);
        renderDetail();
        await waitFor(() => expect(screen.getByText('Pat Doe')).toBeInTheDocument());
        expect(screen.getByText('✓ Signed')).toBeInTheDocument();
        expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('shows the Actions card to managers but not below', async () => {
        installClientFetch([{ match: '/api/admin/bookings', body: DETAIL }]);
        const { unmount } = renderDetail({ admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByText('bk_1')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: '✉ Resend confirmation' })).not.toBeInTheDocument();
        unmount();

        installClientFetch([{ match: '/api/admin/bookings', body: DETAIL }]);
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: '✉ Resend confirmation' })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Issue Stripe refund' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '↪ Move to another event' })).toBeInTheDocument();
    });

    it('posts a resend-confirmation and flashes the result', async () => {
        const fetchMock = installClientFetch([
            { match: '/resend-confirmation', body: { sentTo: 'sarah@example.com' } },
            { match: '/api/admin/bookings', body: DETAIL },
        ]);
        const user = userEvent.setup();
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: '✉ Resend confirmation' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: '✉ Resend confirmation' }));
        expect(await screen.findByText(/Confirmation re-sent to sarah@example.com/)).toBeInTheDocument();
        const posted = fetchMock.mock.calls.some(
            (args) => String(args[0]).includes('/resend-confirmation') && args[1]?.method === 'POST',
        );
        expect(posted).toBe(true);
    });

    it('opens the move-to-another-event modal and lists target events', async () => {
        installClientFetch([
            { match: '/api/admin/events', body: { events: [{ id: 'evt_2', title: 'Volga Flank', ticketTypes: [{ id: 'tt_1', name: 'GA', priceCents: 4000 }] }] } },
            { match: '/api/admin/bookings', body: DETAIL },
        ]);
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: '↪ Move to another event' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: '↪ Move to another event' }));
        expect(await screen.findByRole('heading', { name: 'Move to another event' })).toBeInTheDocument();
        expect(await screen.findByRole('option', { name: 'Volga Flank' })).toBeInTheDocument();
    });
});
